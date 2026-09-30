import * as pulumi from '@pulumi/pulumi';
import { mockAksFetch, Captured } from '../testUtils/pulumiMocks';

// DRK-1821 row 3 / rule R1: a caller-supplied `autoUpgradeProfile` (on the public Args `Pick`) reaches
// the ManagedCluster verbatim; with none supplied the component default { NodeImage, stable } applies.

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
        // AzKubernetes unconditionally reads `cluster.identity.principalId` in its constructor.
        identity: { principalId: `${args.name}_principal`, type: 'SystemAssigned' },
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
  agentPoolProfiles: [{ name: 'system', vnetSubnetID: 'subnet_id', enableEncryptionAtHost: false, osDiskSizeGB: 128 }],
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

describe('AzKubernetes — caller-supplied autoUpgradeProfile (DRK-1821 R1)', () => {
  beforeEach(() => {
    captured = [];
  });

  test('S1 — a caller autoUpgradeProfile reaches the cluster verbatim', async () => {
    const cluster = await createCluster({
      autoUpgradeProfile: { upgradeChannel: 'none', nodeOSUpgradeChannel: 'None' },
    });
    expect(cluster).toBeDefined();
    expect(cluster.inputs.autoUpgradeProfile).toEqual({ upgradeChannel: 'none', nodeOSUpgradeChannel: 'None' });
  });

  test('S2 — no autoUpgradeProfile keeps the NodeImage / stable default', async () => {
    const cluster = await createCluster({});
    expect(cluster).toBeDefined();
    expect(cluster.inputs.autoUpgradeProfile).toEqual({ nodeOSUpgradeChannel: 'NodeImage', upgradeChannel: 'stable' });
  });
});
