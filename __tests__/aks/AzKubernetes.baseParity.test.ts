import { aksClusterOf, aksStackHooks, Captured, previewAks } from '../testUtils/pulumiMocks';

/**
 * DRK-2546 — AKS Automatic by default for new prd clusters: a cluster whose SKU name resolves to `Base` keeps
 * exactly what the previous package version sends (spec §3 "Must stay true").
 *
 * Every expected value below is a literal captured from the component at `2ec1c9e` (the commit before this
 * change), with the Gherkin's own names: cluster `aks-payments`, one system pool in `snet-aks-nodes`.
 * MaintenanceConfiguration inputs are left out of the comparison: their `startDate` is tomorrow's date.
 */

// Each case reloads the AKS module graph through `withStack` and builds a cluster.
jest.setTimeout(30000);

const NODE_SUBNET_ID =
  '/subscriptions/sub/resourceGroups/rg-net/providers/Microsoft.Network/virtualNetworks/vnet-prd-hub/subnets/snet-aks-nodes';

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg-aks', location: 'southeastasia' },
  sku: { name: 'Base' },
  features: { enablePrivateCluster: false },
  agentPoolProfiles: [
    { name: 'system', vnetSubnetID: NODE_SUBNET_ID, enableEncryptionAtHost: true, osDiskSizeGB: 128 },
  ],
};

/** The ManagedCluster inputs the component sends at `2ec1c9e`; only the env-dependent values differ. */
const clusterSettingsAt2ec1c9e = (env: 'prd' | 'dev') => ({
  addonProfiles: {
    aciConnectorLinux: { enabled: false },
    azureKeyvaultSecretsProvider: { enabled: false },
    azurePolicy: { enabled: env === 'prd' },
    httpApplicationRouting: { enabled: false },
    kubeDashboard: { enabled: false },
    omsAgent: { enabled: false },
  },
  agentPoolProfiles: [
    {
      ...(env === 'prd' ? { availabilityZones: ['1', '2', '3'] } : {}),
      enableEncryptionAtHost: true,
      name: 'system',
      osDiskSizeGB: 128,
      securityProfile: { enableSecureBoot: true, enableVTPM: true },
      vmSize: 'Standard_D4ps_v6',
      vnetSubnetID: NODE_SUBNET_ID,
    },
  ],
  apiServerAccessProfile: {
    authorizedIPRanges: [],
    disableRunCommand: true,
    enablePrivateCluster: false,
    enablePrivateClusterPublicFQDN: true,
  },
  autoUpgradeProfile: { nodeOSUpgradeChannel: 'NodeImage', upgradeChannel: 'stable' },
  disableLocalAccounts: true,
  dnsPrefix: `${env}-aks-payments`,
  enableRBAC: true,
  linuxProfile: { adminUsername: 'aks-payments-admin-undefined', ssh: { publicKeys: [{}] } },
  location: 'southeastasia',
  networkProfile: {
    dnsServiceIP: '10.0.0.10',
    loadBalancerSku: 'standard',
    networkDataplane: 'cilium',
    networkPlugin: 'azure',
    networkPluginMode: 'overlay',
    networkPolicy: 'cilium',
    outboundType: 'userDefinedRouting',
    podCidr: '10.244.0.0/16',
    serviceCidr: '10.0.0.0/16',
  },
  nodeProvisioningProfile: { defaultNodePools: 'None', mode: 'Auto' },
  nodeResourceGroup: 'rg-aks-nodes',
  oidcIssuerProfile: { enabled: false },
  resourceGroupName: 'rg-aks',
  securityProfile: { imageCleaner: { enabled: true, intervalHours: 24 }, workloadIdentity: { enabled: false } },
  servicePrincipalProfile: {},
  sku: { name: 'Base', tier: env === 'prd' ? 'Standard' : 'Free' },
  workloadAutoScalerProfile: { keda: { enabled: false }, verticalPodAutoscaler: { enabled: false } },
});

/** The child resources (type, name) the component registers at `2ec1c9e`, sorted. */
const childSetAt2ec1c9e = (env: 'prd' | 'dev') => [
  ['azure-native:authorization:RoleAssignment', 'aks-payments-identity-Reader'],
  ['azure-native:containerservice:MaintenanceConfiguration', 'aks-payments-AutoUpgradeSchedule'],
  ['azure-native:containerservice:MaintenanceConfiguration', 'aks-payments-MaintenanceConfiguration'],
  ['azure-native:containerservice:MaintenanceConfiguration', 'aks-payments-NodeOSUpgradeSchedule'],
  ['azure-native:containerservice:ManagedCluster', 'aks-payments'],
  ['azuread:index/application:Application', `${env}-aks-payments-identity`],
  ['azuread:index/applicationPassword:ApplicationPassword', 'aks-payments-identity-client-secret'],
  ['azuread:index/group:Group', 'rol-aks-payments-admin'],
  ['azuread:index/servicePrincipal:ServicePrincipal', 'aks-payments-identity-sp'],
  ['azuread:index/servicePrincipalPassword:ServicePrincipalPassword', 'aks-payments-identity-sp-pass'],
  ['drunk:azure:AppRegistration', 'aks-payments-identity'],
  ['drunk:azure:AzKubernetes', 'aks-payments'],
  ['drunk:azure:AzRole', 'rol-aks-payments-admin'],
  ['drunk:azure:RandomPassword', 'aks-payments'],
  ['drunk:azure:RandomString', 'aks-payments'],
  ['drunk:azure:RoleAssignment', 'aks-payments-identity-Reader'],
  ['drunk:azure:SshGenerator', 'aks-payments-ssh'],
  ['pulumi-nodejs:dynamic:Resource', 'csp:SshGenerator:aks-payments-ssh'],
  ['random:index/randomPassword:RandomPassword', 'aks-payments'],
  ['random:index/randomString:RandomString', 'aks-payments'],
];

/** The providers the `2ec1c9e` Base preview needs (component `drunk:` types are not providers). */
const PROVIDERS_AT_2EC1C9E = ['azure-native', 'azuread', 'pulumi-nodejs', 'random'];

const childSet = (captured: Captured[]) => captured.map((c) => [c.type, c.name]).sort();
const providersOf = (captured: Captured[]) =>
  [...new Set(captured.map((c) => c.type.split(':')[0]).filter((p) => p !== 'drunk'))].sort();

aksStackHooks();

describe("A Base cluster keeps today's settings in every environment", () => {
  test.each(['prd', 'dev'] as const)(
    'a %s Base cluster with one system node pool sends the settings and resource type of 2ec1c9e',
    async (env) => {
      const { captured } = await previewAks(env, 'aks-payments', baseArgs);

      const cluster = aksClusterOf(captured);
      expect(cluster.type).toBe('azure-native:containerservice:ManagedCluster');
      expect(cluster.inputs).toEqual(clusterSettingsAt2ec1c9e(env));
      expect(captured.some((c) => c.type === 'azure-native:resources:Resource')).toBe(false);
    },
  );

  // Brief §3 row 4: the three new `network` keys are Automatic-only and never reach a Base `networkProfile`.
  test('a prd Base cluster given the three Automatic subnet inputs still sends the settings of 2ec1c9e', async () => {
    const vnet = '/subscriptions/sub/resourceGroups/rg-net/providers/Microsoft.Network/virtualNetworks/vnet-prd-hub';
    const { captured } = await previewAks('prd', 'aks-payments', {
      ...baseArgs,
      network: {
        apiServerSubnetId: `${vnet}/subnets/snet-aks-api`,
        systemNodeSubnetId: `${vnet}/subnets/snet-aks-system`,
        workloadNodeSubnetId: `${vnet}/subnets/snet-aks-workload`,
      },
    });

    expect(aksClusterOf(captured).inputs).toEqual(clusterSettingsAt2ec1c9e('prd'));
  });
});

describe('A Base cluster gets no new identity or role assignment', () => {
  test('a prd Base cluster registers the child set, providers and outputs of 2ec1c9e', async () => {
    const { pulumi, aks, captured } = await previewAks('prd', 'aks-payments', baseArgs);

    expect(childSet(captured)).toEqual(childSetAt2ec1c9e('prd'));
    expect(providersOf(captured)).toEqual(PROVIDERS_AT_2EC1C9E);
    expect(await pulumi.output(aks.getOutputs()).promise()).toEqual({
      id: 'aks-payments_id',
      resourceName: 'aks-payments',
      resourceGroupName: 'rg-aks',
      namespaces: {},
      azAppIdentity: {
        tenantId: '',
        servicePrincipalId: 'aks-payments-identity-sp_id',
        vaultSecrets: {},
        applicationId: 'prd-aks-payments-identity_id',
      },
      kubeletIdentity: { id: 'kubelet_id', clientId: 'kubelet_client', objectId: 'kubelet_object' },
      systemIdentityId: 'aks-payments_principal',
    });
  });

  test('a dev Base cluster registers the child set of 2ec1c9e', async () => {
    const { captured } = await previewAks('dev', 'aks-payments', baseArgs);
    expect(childSet(captured)).toEqual(childSetAt2ec1c9e('dev'));
  });
});

describe('A Base cluster sends an empty node-pool list as today', () => {
  test('a prd Base cluster given an empty node-pool list previews and sends an empty list', async () => {
    const { captured } = await previewAks('prd', 'aks-payments', { ...baseArgs, agentPoolProfiles: [] });
    expect(aksClusterOf(captured).inputs.agentPoolProfiles).toEqual([]);
  });
});

describe('The tier rule does not change — Base rows', () => {
  test.each([
    ['prd', 'Standard'],
    ['dev', 'Free'],
  ] as const)('a %s Base cluster with no tier runs on %s', async (env, tier) => {
    const { captured } = await previewAks(env, 'aks-payments', baseArgs);
    expect(aksClusterOf(captured).inputs.sku).toEqual({ name: 'Base', tier });
  });
});
