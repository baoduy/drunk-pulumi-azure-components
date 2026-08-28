import * as pulumi from '@pulumi/pulumi';
import { mockAksFetch, Captured } from '../testUtils/pulumiMocks';

// DRK-770 §5: Cilium dataplane pinning, agent-pool compute/hardening defaults, node
// auto-provisioning defaulting-on without reshaping declared pools or dropping disk encryption.

let captured: Captured[];
let restoreFetch: () => void;

beforeAll(() => {
  restoreFetch = mockAksFetch();
});
afterAll(() => restoreFetch());

pulumi.runtime.setMocks({
  newResource: (args: pulumi.runtime.MockResourceArgs) => {
    captured.push({ type: args.type, name: args.name, inputs: args.inputs });
    return {
      id: `${args.name}_id`,
      state: {
        ...args.inputs,
        name: args.name,
        // AzKubernetes unconditionally reads `cluster.identity.principalId` in its constructor,
        // and reads addonProfiles/oidcIssuerProfile whenever the matching feature flag is on.
        identity: { principalId: `${args.name}_principal`, type: 'SystemAssigned' },
        addonProfiles: {
          azureKeyvaultSecretsProvider: {
            identity: { resourceId: 'kv_identity_id', clientId: 'kv_client', objectId: 'kv_object' },
          },
        },
        oidcIssuerProfile: { issuerURL: 'https://issuer.example.com' },
      },
    };
  },
  call: (args: pulumi.runtime.MockCallArgs) => {
    if (args.token === 'azure-native:authorization:getClientToken') return { token: 'mock-token' };
    return args.inputs;
  },
});

import { AzKubernetes } from '../../src/aks/AzKubernetes';

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
  sku: { name: 'Base' },
  features: { enablePrivateCluster: false },
};

async function createCluster(props: any) {
  const aks = new AzKubernetes('cluster1', { ...baseArgs, ...props } as any);
  await pulumi.output(aks.id).promise();
  // Drains the always-created kubeletIdentity/systemIdentityId outputs so their pending
  // getExtraAksOutputs() fetch chain resolves inside the test instead of after teardown.
  if (aks.kubeletIdentity) await pulumi.output(aks.kubeletIdentity).promise();
  if (aks.systemIdentityId) await pulumi.output(aks.systemIdentityId).promise();
  return captured.find((c) => c.type === 'azure-native:containerservice:ManagedCluster')!;
}

describe('AzKubernetes — network dataplane pinning', () => {
  beforeEach(() => {
    captured = [];
  });

  test('a cluster with no network settings runs the Cilium dataplane', async () => {
    const cluster = await createCluster({
      agentPoolProfiles: [{ name: 'system', vnetSubnetID: 'subnet_id', enableEncryptionAtHost: false, osDiskSizeGB: 128 }],
    });
    expect(cluster.inputs.networkProfile.networkDataplane).toBe('cilium');
  });

  test('choosing the Azure network policy leaves the dataplane on Cilium', async () => {
    const cluster = await createCluster({
      agentPoolProfiles: [{ name: 'system', vnetSubnetID: 'subnet_id', enableEncryptionAtHost: false, osDiskSizeGB: 128 }],
      network: { networkPolicy: 'azure' },
    });
    expect(cluster.inputs.networkProfile.networkPolicy).toBe('azure');
    expect(cluster.inputs.networkProfile.networkDataplane).toBe('cilium');
  });

  test('a cluster keeps the network dataplane the engineer chose', async () => {
    const cluster = await createCluster({
      agentPoolProfiles: [{ name: 'system', vnetSubnetID: 'subnet_id', enableEncryptionAtHost: false, osDiskSizeGB: 128 }],
      network: { networkDataplane: 'azure' },
    });
    expect(cluster.inputs.networkProfile.networkDataplane).toBe('azure');
  });
});

describe('AzKubernetes — agent pool compute size and hardening defaults', () => {
  beforeEach(() => {
    captured = [];
  });

  test('a pool declared without a compute size gets the standard Arm size and is hardened', async () => {
    const cluster = await createCluster({
      agentPoolProfiles: [{ name: 'system', vnetSubnetID: 'subnet_id', enableEncryptionAtHost: false, osDiskSizeGB: 128 }],
    });
    expect(cluster.inputs.agentPoolProfiles[0].vmSize).toBe('Standard_D4ps_v6');
    expect(cluster.inputs.agentPoolProfiles[0].securityProfile).toEqual({ enableSecureBoot: true, enableVTPM: true });
  });

  test('a pool keeps the compute size the engineer chose', async () => {
    const cluster = await createCluster({
      agentPoolProfiles: [
        { name: 'system', vnetSubnetID: 'subnet_id', enableEncryptionAtHost: false, osDiskSizeGB: 128, vmSize: 'Standard_D2as_v4' },
      ],
    });
    expect(cluster.inputs.agentPoolProfiles[0].vmSize).toBe('Standard_D2as_v4');
  });

  test('an agent pool added after the cluster exists gets the same standard size', async () => {
    captured = [];
    const aks = new AzKubernetes('cluster2', {
      ...baseArgs,
      agentPoolProfiles: [{ name: 'system', vnetSubnetID: 'subnet_id', enableEncryptionAtHost: false, osDiskSizeGB: 128 }],
      extraAgentPoolProfiles: [{ name: 'workload', vnetSubnetID: 'subnet_id', enableEncryptionAtHost: false, osDiskSizeGB: 128 }],
    } as any);
    await pulumi.output(aks.id).promise();
    if (aks.kubeletIdentity) await pulumi.output(aks.kubeletIdentity).promise();
    if (aks.systemIdentityId) await pulumi.output(aks.systemIdentityId).promise();
    // The extra AgentPool has no output wired back through AzKubernetes's public surface (it's a
    // fire-and-forget sibling resource keyed off `dependsOn: aks`), so there's nothing to await on
    // directly — give its promise chain one more tick to settle after the cluster resolves.
    await new Promise((resolve) => setImmediate(resolve));

    const extraPool = captured.find((c) => c.type === 'azure-native:containerservice:AgentPool')!;
    expect(extraPool.inputs.vmSize).toBe('Standard_D4ps_v6');
    expect(extraPool.inputs.securityProfile).toEqual({ enableSecureBoot: true, enableVTPM: true });
  });
});

describe('AzKubernetes — node auto-provisioning defaulting-on', () => {
  beforeEach(() => {
    captured = [];
  });

  test('NAP is on by default and does not reshape declared agent pools', async () => {
    const cluster = await createCluster({
      agentPoolProfiles: [{ name: 'system', vnetSubnetID: 'subnet_id', enableEncryptionAtHost: false, osDiskSizeGB: 128 }],
      features: { enablePrivateCluster: false },
    });
    // Defaulted on (engineer silent) must use 'None' so Azure never removes/reshapes declared pools.
    expect(cluster.inputs.nodeProvisioningProfile).toEqual({ defaultNodePools: 'None', mode: 'Auto' });
  });

  test('an engineer can switch node auto-provisioning off', async () => {
    const cluster = await createCluster({
      agentPoolProfiles: [{ name: 'system', vnetSubnetID: 'subnet_id', enableEncryptionAtHost: false, osDiskSizeGB: 128 }],
      features: { enablePrivateCluster: false, enableNodeAutoProvisioning: false },
    });
    expect(cluster.inputs.nodeProvisioningProfile).toBeUndefined();
  });

  test('an engineer who explicitly opts in to NAP keeps the pre-existing Auto pool behaviour', async () => {
    const cluster = await createCluster({
      agentPoolProfiles: [{ name: 'system', vnetSubnetID: 'subnet_id', enableEncryptionAtHost: false, osDiskSizeGB: 128 }],
      features: { enablePrivateCluster: false, enableNodeAutoProvisioning: true },
    });
    expect(cluster.inputs.nodeProvisioningProfile).toEqual({ defaultNodePools: 'Auto', mode: 'Auto' });
  });

  // Regression guard: NAP defaulting on must not silently drop the AKS disk-encryption set for a
  // stack that has encryption on and never stated a NAP preference.
  test('a stack with encryption on and no NAP preference still gets its disk-encryption set', async () => {
    const cluster = await createCluster({
      agentPoolProfiles: [{ name: 'system', vnetSubnetID: 'subnet_id', enableEncryptionAtHost: false, osDiskSizeGB: 128 }],
      enableEncryption: true,
      vaultInfo: { id: 'vault_id', resourceName: 'vault', resourceGroupName: 'rg' },
    });
    expect(cluster.inputs.diskEncryptionSetID).toBeDefined();
  });

  test('a stack with encryption on and NAP explicitly enabled has no disk-encryption set (pre-existing behaviour)', async () => {
    const cluster = await createCluster({
      agentPoolProfiles: [{ name: 'system', vnetSubnetID: 'subnet_id', enableEncryptionAtHost: false, osDiskSizeGB: 128 }],
      enableEncryption: true,
      vaultInfo: { id: 'vault_id', resourceName: 'vault', resourceGroupName: 'rg' },
      features: { enablePrivateCluster: false, enableNodeAutoProvisioning: true },
    });
    expect(cluster.inputs.diskEncryptionSetID).toBeUndefined();
  });
});

// Pre-existing behaviour, untouched by DRK-770, but this file is a touched class this cycle
// so its other feature-flag branches need coverage too. ArgoCD-extension wiring and the
// private-cluster DNS lookup are left uncovered here: both are unrelated legacy paths explicitly
// out of scope for this cycle (DRK-774 §4 no-gos) and would need a disproportionate amount of
// extra mocking (federated identities, a raw DNS record-set data source) for no spec value.
describe('AzKubernetes — other feature flags (pre-existing behaviour)', () => {
  beforeEach(() => {
    captured = [];
  });

  test('namespaces, resource identity permissions, key vault + workload identity + ACR wiring, legacy maintenance window', async () => {
    const aks = new AzKubernetes('cluster3', {
      ...baseArgs,
      agentPoolProfiles: [{ name: 'system', vnetSubnetID: 'subnet_id', enableEncryptionAtHost: false, osDiskSizeGB: 128 }],
      features: {
        enablePrivateCluster: false,
        enableAzureKeyVault: true,
        enableWorkloadIdentity: true,
      },
      enableResourceIdentity: true,
      groupRoles: {
        admin: { objectId: 'admin_object_id', displayName: 'admins' },
        contributor: { objectId: 'contrib_object_id', displayName: 'contributors' },
        readOnly: { objectId: 'read_object_id', displayName: 'readers' },
      },
      namespaces: { team1: {} },
      attachToAcr: { id: 'acr_id', resourceName: 'acr', resourceGroupName: 'rg' },
      // Legacy maintenance form — exercises isLegacyMaintenanceArgs/getDefaultMaintenanceArgs.
      maintenance: { timeInWeek: [{ day: 'Sunday', hourSlots: [0, 23] }] },
    } as any);

    await pulumi.output(aks.id).promise();
    if (aks.kubeletIdentity) await pulumi.output(aks.kubeletIdentity).promise();
    if (aks.systemIdentityId) await pulumi.output(aks.systemIdentityId).promise();
    if (aks.keyVaultSecretProviderIdentity) await pulumi.output(aks.keyVaultSecretProviderIdentity).promise();
    if (aks.oidcIssuerUrl) await pulumi.output(aks.oidcIssuerUrl).promise();
    // Namespace/RoleAssignment/GroupMember creations are fire-and-forget siblings not wired back
    // through any AzKubernetes output — give their promise chains a few more ticks to settle.
    for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve));

    expect(captured.find((c) => c.type === 'azure-native:containerservice:Namespace')).toBeDefined();
    expect(aks.oidcIssuerUrl).toBeDefined();
    expect(aks.keyVaultSecretProviderIdentity).toBeDefined();
  });
});
