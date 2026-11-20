import * as fs from 'fs';
import * as path from 'path';
import {
  AksPreview,
  aksClusterOf,
  aksStackHooks,
  Captured,
  previewAks,
  previewAksFailure,
} from '../testUtils/pulumiMocks';
import { RegisteredResource } from '../testUtils/pulumiParentSpy';

/**
 * DRK-2546 — AKS Automatic by default for new prd clusters (spec §5, revision 33).
 *
 * A prd stack with no SKU name gets an AKS Automatic cluster: created through the generic
 * `azure-native:resources:Resource` on Azure API 2026-02-01 or later, in the caller's three subnets, signed in with
 * a dedicated user-assigned identity that holds `Network Contributor` on the VNet of the API server subnet.
 * Every contradicting caller setting fails the preview and names its input.
 *
 * `isPrd` is read once at module load, so every preview reloads AzKubernetes under an explicit stack name.
 */

// Each preview reloads the AKS module graph through `withStack` and builds a cluster.
jest.setTimeout(30000);

const VNET_ID = '/subscriptions/sub/resourceGroups/rg-net/providers/Microsoft.Network/virtualNetworks/vnet-prd-hub';
const API_SUBNET_ID =
  '/subscriptions/sub/resourceGroups/rg-net/providers/Microsoft.Network/virtualNetworks/vnet-prd-hub/subnets/snet-aks-api';
const SYSTEM_SUBNET_ID =
  '/subscriptions/sub/resourceGroups/rg-net/providers/Microsoft.Network/virtualNetworks/vnet-prd-hub/subnets/snet-aks-system';
const WORKLOAD_SUBNET_ID =
  '/subscriptions/sub/resourceGroups/rg-net/providers/Microsoft.Network/virtualNetworks/vnet-prd-hub/subnets/snet-aks-workload';
const NODE_SUBNET_ID =
  '/subscriptions/sub/resourceGroups/rg-net/providers/Microsoft.Network/virtualNetworks/vnet-prd-hub/subnets/snet-aks-nodes';

// Azure built-in role `Network Contributor`.
const NETWORK_CONTRIBUTOR_ROLE =
  '/providers/Microsoft.Authorization/roleDefinitions/4d97b98b-1d4f-4787-a291-c67834d212e7';

const DEDICATED_IDENTITY_NAME = 'aks-orders-cluster-identity';
const DEDICATED_IDENTITY_ID = 'aks-orders-cluster-identity_id';
const DEDICATED_PRINCIPAL_ID = 'aks-orders-cluster-identity_principal';
const SHARED_PRINCIPAL_ID = 'uid-prd-shared-principal';

const rsGroup = { resourceGroupName: 'rg-aks', location: 'southeastasia' };
const systemPool = { name: 'system', vnetSubnetID: NODE_SUBNET_ID, enableEncryptionAtHost: true, osDiskSizeGB: 128 };
const threeSubnets = {
  apiServerSubnetId: API_SUBNET_ID,
  systemNodeSubnetId: SYSTEM_SUBNET_ID,
  workloadNodeSubnetId: WORKLOAD_SUBNET_ID,
};

/** A stack with no SKU name, no node-pool list and all three subnets — an Automatic cluster in prd. */
const automaticArgs = {
  rsGroup,
  features: { enablePrivateCluster: false },
  network: { ...threeSubnets },
};

/** A stack with no SKU name and one system node pool — a Base cluster outside prd. */
const baseArgs = {
  rsGroup,
  features: { enablePrivateCluster: false },
  agentPoolProfiles: [systemPool],
};

const withFeatures = (features: Record<string, unknown>) => ({
  ...automaticArgs,
  features: { ...automaticArgs.features, ...features },
});

/** The Automatic cluster's `properties`; fails the test when the cluster is not the generic Automatic resource. */
const automaticProperties = (captured: Captured[]) => {
  const cluster = aksClusterOf(captured);
  expect(cluster.type).toBe('azure-native:resources:Resource');
  return cluster.inputs.properties;
};

/** Role assignments (the `azure-native` resource, resolved inputs) granted to `principalId`. */
const grantsTo = (captured: Captured[], principalId: string) =>
  captured.filter(
    (c) => c.type === 'azure-native:authorization:RoleAssignment' && c.inputs.principalId === principalId,
  );

/** The resources `entry` waits for through `opts.dependsOn`, resolved and flattened. */
async function dependsOnOf(pulumi: typeof import('@pulumi/pulumi'), entry: RegisteredResource) {
  const deps = await pulumi.output(entry.opts.dependsOn as any).promise();
  return ([] as unknown[]).concat(deps ?? []).flat(Infinity);
}

/** A refusal that a literal input triggers runs before any child resource registers (R7). */
const expectNoChildRegistered = (registered: RegisteredResource[]) =>
  expect(registered.filter((r) => r.type !== 'drunk:azure:AzKubernetes').map((r) => `${r.type}::${r.name}`)).toEqual(
    [],
  );

const sharedPreviews = new Map<string, Map<object, Promise<AksPreview>>>();

/**
 * One preview per stack, cluster name and args object, shared by the scenarios that only read it: each fresh AKS
 * module graph costs the Jest worker ~250 MB it never frees, so a preview per case exhausts it.
 */
function sharedPreview(env: string, name: string, args: object) {
  const key = `${env}|${name}`;
  const byArgs = sharedPreviews.get(key) ?? new Map<object, Promise<AksPreview>>();
  sharedPreviews.set(key, byArgs);
  if (!byArgs.has(args)) byArgs.set(args, previewAks(env, name, args));
  return byArgs.get(args)!;
}

/** The Gherkin's dev stack that names the SKU `Automatic`. */
const devAutomaticArgs = { ...automaticArgs, sku: { name: 'Automatic' } };

aksStackHooks();

describe("The SKU name resolves from the caller's value and the environment", () => {
  test.each([
    ['prd', '(none)', 'Automatic', automaticArgs],
    ['dev', '(none)', 'Base', baseArgs],
    ['prd', 'Base', 'Base', { ...baseArgs, sku: { name: 'Base' } }],
    ['dev', 'Automatic', 'Automatic', devAutomaticArgs],
    // §6a D1: an empty `sku` object resolves like a missing one.
    ['prd', '{} (empty sku)', 'Automatic', { ...automaticArgs, sku: {} }],
    ['dev', '{} (empty sku)', 'Base', { ...baseArgs, sku: {} }],
  ] as const)('a %s stack given the SKU name %s resolves to %s', async (env, _given, resolved, args) => {
    const { captured } = await sharedPreview(env, 'aks-payments', args);
    expect(aksClusterOf(captured).inputs.sku.name).toBe(resolved);
  });
});

describe('A Base cluster with no node-pool list is refused', () => {
  test('a dev stack with no SKU name and no node-pool list fails and names `agentPoolProfiles`', async () => {
    const { error, registered } = await previewAksFailure('dev', 'aks-sandbox', {
      rsGroup,
      features: { enablePrivateCluster: false },
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('agentPoolProfiles');
    expectNoChildRegistered(registered);
  });
});

describe('The tier rule does not change — Automatic rows', () => {
  test.each([
    ['prd', '(none)', '(none)', 'Standard', automaticArgs],
    ['dev', 'Automatic', '(none)', 'Standard', devAutomaticArgs],
    // §6a D1: a `sku` holding only a tier still resolves the name.
    ['prd', '(none)', 'Premium', 'Premium', { ...automaticArgs, sku: { tier: 'Premium' } }],
  ] as const)(
    'a %s cluster with the SKU name %s and the tier %s runs on %s',
    async (env, _name, _given, tier, args) => {
      const { captured } = await sharedPreview(env, 'aks-payments', args);
      expect(aksClusterOf(captured).inputs.sku).toEqual({ name: 'Automatic', tier });
    },
  );
});

describe("A new prd Automatic cluster uses the caller's three subnets", () => {
  test('the API server, the system nodes and the workload nodes join snet-aks-api, snet-aks-system and snet-aks-workload', async () => {
    const { captured } = await sharedPreview('prd', 'aks-orders', automaticArgs);
    const properties = automaticProperties(captured);

    expect(properties.apiServerAccessProfile).toMatchObject({ enableVnetIntegration: true, subnetId: API_SUBNET_ID });
    expect(properties.hostedSystemProfile).toEqual({
      enabled: true,
      systemNodeSubnetID: SYSTEM_SUBNET_ID,
      nodeSubnetID: WORKLOAD_SUBNET_ID,
    });
  });

  // §6a D2: an empty node-pool list is no node pool.
  test('an Automatic cluster given an empty node-pool list previews and sends no node pool', async () => {
    const { captured } = await previewAks('prd', 'aks-orders', { ...automaticArgs, agentPoolProfiles: [] });
    expect(automaticProperties(captured).agentPoolProfiles).toBeUndefined();
  });
});

describe('An Automatic cluster is created through Azure API 2026-02-01 or later', () => {
  test('the cluster is a managedClusters resource on a GA API version no older than 2026-02-01', async () => {
    const { captured } = await sharedPreview('prd', 'aks-orders', automaticArgs);
    const cluster = aksClusterOf(captured);

    expect(cluster.type).toBe('azure-native:resources:Resource');
    expect(cluster.inputs.resourceProviderNamespace).toBe('Microsoft.ContainerService');
    expect(cluster.inputs.resourceType).toBe('managedClusters');
    expect(cluster.inputs.parentResourcePath).toBe('');
    expect(cluster.inputs.apiVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(cluster.inputs.apiVersion >= '2026-02-01').toBe(true);
    expect(captured.some((c) => c.type === 'azure-native:containerservice:ManagedCluster')).toBe(false);
  });
});

describe('An Automatic cluster with a missing subnet is refused', () => {
  test.each([
    ['API server subnet', 'left out', 'network.apiServerSubnetId', 'apiServerSubnetId', undefined],
    ['API server subnet', 'empty', 'network.apiServerSubnetId', 'apiServerSubnetId', ''],
    ['system-node subnet', 'left out', 'network.systemNodeSubnetId', 'systemNodeSubnetId', undefined],
    ['system-node subnet', 'empty', 'network.systemNodeSubnetId', 'systemNodeSubnetId', ''],
    ['workload-node subnet', 'left out', 'network.workloadNodeSubnetId', 'workloadNodeSubnetId', undefined],
    ['workload-node subnet', 'empty', 'network.workloadNodeSubnetId', 'workloadNodeSubnetId', ''],
  ] as const)(
    'a prd stack with the %s %s fails, names `%s` and suggests the Base SKU name',
    async (_subnet, _how, inputPath, key, value) => {
      const network: Record<string, unknown> = { ...threeSubnets };
      if (value === undefined) delete network[key];
      else network[key] = value;

      const { error, registered } = await previewAksFailure('prd', 'aks-orders', { ...automaticArgs, network });

      expect(error.message).toContain(inputPath);
      expect(error.message).toContain("sku.name: 'Base'");
      expectNoChildRegistered(registered);
    },
  );

  // §6a D9: the VNet is read from the API server subnet ID, so an ID with no subnets segment is refused.
  test('an API server subnet ID with no subnets segment fails and names `network.apiServerSubnetId`', async () => {
    const { error } = await previewAksFailure('prd', 'aks-orders', {
      ...automaticArgs,
      network: { ...threeSubnets, apiServerSubnetId: VNET_ID },
    });
    expect(error.message).toContain('network.apiServerSubnetId');
  });
});

describe('An Automatic cluster gets a dedicated identity with network rights on its VNet', () => {
  const sharedIdentity = {
    id: '/subscriptions/sub/resourceGroups/rg-shared/providers/Microsoft.ManagedIdentity/userAssignedIdentities/uid-prd-shared',
    clientId: 'uid-prd-shared-client',
    principalId: SHARED_PRINCIPAL_ID,
    resourceName: 'uid-prd-shared',
    resourceGroupName: 'rg-shared',
  };

  test('aks-orders gets its own identity holding only Network Contributor on vnet-prd-hub, granted before the cluster', async () => {
    const { pulumi, captured, registered } = await previewAks('prd', 'aks-orders', {
      ...automaticArgs,
      defaultUAssignedId: sharedIdentity,
    });

    const identities = captured.filter(
      (c) => c.type === 'azure-native:managedidentity:UserAssignedIdentity' && c.name === DEDICATED_IDENTITY_NAME,
    );
    expect(identities).toHaveLength(1);

    const grants = grantsTo(captured, DEDICATED_PRINCIPAL_ID);
    expect(grants).toHaveLength(1);
    expect(grants[0].inputs).toMatchObject({ principalType: 'ServicePrincipal', scope: VNET_ID });
    expect(grants[0].inputs.roleDefinitionId.endsWith(NETWORK_CONTRIBUTOR_ROLE)).toBe(true);

    expect(grantsTo(captured, SHARED_PRINCIPAL_ID)).toEqual([]);

    // The cluster waits on the grant: its `dependsOn` holds the grant (or the component that wraps it).
    const grantResources = registered.filter((r) => r.name === grants[0].name).map((r) => r.res);
    expect(grantResources.length).toBeGreaterThan(0);
    const cluster = registered.filter((r) => r.type === 'azure-native:resources:Resource' && r.name === 'aks-orders');
    expect(cluster).toHaveLength(1);
    const deps = await dependsOnOf(pulumi, cluster[0]);
    expect(deps.some((d) => grantResources.includes(d as any))).toBe(true);
  });

  // §6a D8: the subnets segment is matched without regard to case, and an Output subnet ID is read once known.
  test.each([
    ['a /Subnets/ segment', () => `${VNET_ID}/Subnets/snet-aks-api`],
    ['an Output subnet ID', (p: typeof import('@pulumi/pulumi')) => p.output(API_SUBNET_ID)],
  ] as const)('the grant scope is vnet-prd-hub for %s', async (_case, apiSubnet) => {
    const { captured } = await previewAks('prd', 'aks-orders', (p) => ({
      ...automaticArgs,
      network: { ...threeSubnets, apiServerSubnetId: apiSubnet(p) },
    }));

    const grants = grantsTo(captured, DEDICATED_PRINCIPAL_ID);
    expect(grants).toHaveLength(1);
    expect(grants[0].inputs.scope).toBe(VNET_ID);
  });
});

describe('An Automatic cluster signs in with its dedicated identity', () => {
  test('aks-orders signs in with its own identity, keeps its Entra app and returns the identity principal', async () => {
    const { pulumi, aks, captured } = await sharedPreview('prd', 'aks-orders', automaticArgs);
    const cluster = aksClusterOf(captured);

    expect(cluster.inputs.identity).toEqual({ type: 'UserAssigned', userAssignedIdentities: [DEDICATED_IDENTITY_ID] });
    expect(cluster.inputs.properties.servicePrincipalProfile).toBeUndefined();

    expect(captured.filter((c) => c.type === 'azuread:index/application:Application').map((c) => c.name)).toEqual([
      'prd-aks-orders-identity',
    ]);
    const outputs = await pulumi.output(aks.getOutputs()).promise();
    expect(outputs.azAppIdentity.applicationId).toBe('prd-aks-orders-identity_id');
    expect(outputs.systemIdentityId).toBe(DEDICATED_PRINCIPAL_ID);
  });
});

describe('An Automatic cluster with its own node pool is refused', () => {
  test('a prd Automatic stack with the node pool "system" fails and names `agentPoolProfiles`', async () => {
    const { error, registered } = await previewAksFailure('prd', 'aks-orders', {
      ...automaticArgs,
      agentPoolProfiles: [systemPool],
    });

    expect(error.message).toContain('agentPoolProfiles');
    expectNoChildRegistered(registered);
  });
});

describe('An Automatic cluster turns on its managed settings', () => {
  test('with those settings unset, workload identity, OIDC, Azure RBAC, KEDA, VPA and NAP are on, on Stable/NodeImage', async () => {
    const { pulumi, aks, captured } = await sharedPreview('prd', 'aks-orders', automaticArgs);
    const properties = automaticProperties(captured);

    expect(properties.securityProfile.workloadIdentity).toEqual({ enabled: true });
    expect(properties.oidcIssuerProfile).toEqual({ enabled: true });
    expect(properties.aadProfile).toMatchObject({ managed: true, enableAzureRBAC: true });
    expect(properties.workloadAutoScalerProfile).toEqual({
      keda: { enabled: true },
      verticalPodAutoscaler: { enabled: true },
    });
    expect(properties.nodeProvisioningProfile).toMatchObject({ mode: 'Auto' });
    expect(properties.autoUpgradeProfile).toEqual({ upgradeChannel: 'stable', nodeOSUpgradeChannel: 'NodeImage' });

    expect(await pulumi.output(aks.oidcIssuerUrl).promise()).toBe('https://issuer.example.com');
  });

  // §6a D4/D7: a caller value that agrees with Automatic is accepted and sent.
  test('a stack that sets every managed setting to the value Automatic uses previews with those values', async () => {
    const { captured } = await previewAks('prd', 'aks-orders', {
      ...withFeatures({
        enableWorkloadIdentity: true,
        enableKeda: true,
        enableVerticalPodAutoscaler: true,
        enableNodeAutoProvisioning: true,
        enablePodIdentity: false,
      }),
      enableResourceIdentity: false,
      enableEncryption: false,
      autoUpgradeProfile: { upgradeChannel: 'stable', nodeOSUpgradeChannel: 'NodeImage' },
    });
    const properties = automaticProperties(captured);

    expect(properties.securityProfile.workloadIdentity).toEqual({ enabled: true });
    expect(properties.workloadAutoScalerProfile).toEqual({
      keda: { enabled: true },
      verticalPodAutoscaler: { enabled: true },
    });
    expect(properties.autoUpgradeProfile).toEqual({ upgradeChannel: 'stable', nodeOSUpgradeChannel: 'NodeImage' });
  });
});

describe('An Automatic cluster refuses a contradicting setting', () => {
  const batchPool = (enableAutoScaling: unknown) => ({
    name: 'batch',
    vnetSubnetID: WORKLOAD_SUBNET_ID,
    enableEncryptionAtHost: true,
    osDiskSizeGB: 128,
    ...(enableAutoScaling === undefined ? {} : { enableAutoScaling }),
  });

  test.each([
    [
      'workload identity turned off',
      'features.enableWorkloadIdentity',
      withFeatures({ enableWorkloadIdentity: false }),
    ],
    ['KEDA turned off', 'features.enableKeda', withFeatures({ enableKeda: false })],
    ['VPA turned off', 'features.enableVerticalPodAutoscaler', withFeatures({ enableVerticalPodAutoscaler: false })],
    [
      'node auto-provisioning turned off',
      'features.enableNodeAutoProvisioning',
      withFeatures({ enableNodeAutoProvisioning: false }),
    ],
    ['pod identity turned on', 'features.enablePodIdentity', withFeatures({ enablePodIdentity: true })],
    [
      'virtual nodes in the subnet "snet-aci"',
      'network.virtualHostSubnetName',
      { ...automaticArgs, network: { ...threeSubnets, virtualHostSubnetName: 'snet-aci' } },
    ],
    [
      'the upgrade channel "Rapid"',
      'autoUpgradeProfile.upgradeChannel',
      { ...automaticArgs, autoUpgradeProfile: { upgradeChannel: 'rapid' } },
    ],
    [
      'the node OS upgrade channel "SecurityPatch"',
      'autoUpgradeProfile.nodeOSUpgradeChannel',
      { ...automaticArgs, autoUpgradeProfile: { nodeOSUpgradeChannel: 'SecurityPatch' } },
    ],
    [
      'an extra node pool "batch" that autoscales',
      'extraAgentPoolProfiles',
      { ...automaticArgs, extraAgentPoolProfiles: [batchPool(true)] },
    ],
    ['resource identity turned on', 'enableResourceIdentity', { ...automaticArgs, enableResourceIdentity: true }],
  ] as const)('a prd Automatic stack with %s fails and names `%s`', async (_setting, inputPath, args) => {
    const { error, registered } = await previewAksFailure('prd', 'aks-orders', args);

    expect(error.message).toContain(inputPath);
    expectNoChildRegistered(registered);
  });

  // §6a D5: every member of both channel enums; only Stable / NodeImage pass.
  test.each(['rapid', 'patch', 'node-image', 'none'])(
    'the upgrade channel %p is refused and names `autoUpgradeProfile.upgradeChannel`',
    async (upgradeChannel) => {
      const { error } = await previewAksFailure('prd', 'aks-orders', {
        ...automaticArgs,
        autoUpgradeProfile: { upgradeChannel, nodeOSUpgradeChannel: 'NodeImage' },
      });
      expect(error.message).toContain('autoUpgradeProfile.upgradeChannel');
    },
  );

  test.each(['None', 'Unmanaged', 'SecurityPatch'])(
    'the node OS upgrade channel %p is refused and names `autoUpgradeProfile.nodeOSUpgradeChannel`',
    async (nodeOSUpgradeChannel) => {
      const { error } = await previewAksFailure('prd', 'aks-orders', {
        ...automaticArgs,
        autoUpgradeProfile: { upgradeChannel: 'stable', nodeOSUpgradeChannel },
      });
      expect(error.message).toContain('autoUpgradeProfile.nodeOSUpgradeChannel');
    },
  );

  // §6a D6: an extra pool that does not autoscale is accepted.
  test.each([
    ['enableAutoScaling unset', undefined],
    ['enableAutoScaling false', false],
  ])('an extra node pool "batch" with %s previews', async (_case, enableAutoScaling) => {
    const { captured } = await previewAks('prd', 'aks-orders', {
      ...automaticArgs,
      extraAgentPoolProfiles: [batchPool(enableAutoScaling)],
    });
    expect(captured.filter((c) => c.type === 'azure-native:containerservice:AgentPool').map((c) => c.name)).toEqual([
      'aks-orders-batch',
    ]);
  });

  // §6a D6 / R13: an Output flag is checked once known and fails the preview there.
  test.each([
    [
      'an extra node pool "batch" whose enableAutoScaling is an Output of true',
      'extraAgentPoolProfiles',
      (p: typeof import('@pulumi/pulumi')) => ({
        ...automaticArgs,
        extraAgentPoolProfiles: [batchPool(p.output(true))],
      }),
    ],
    [
      'an upgrade channel given as an Output of "rapid"',
      'autoUpgradeProfile.upgradeChannel',
      (p: typeof import('@pulumi/pulumi')) => ({
        ...automaticArgs,
        autoUpgradeProfile: { upgradeChannel: p.output('rapid'), nodeOSUpgradeChannel: 'NodeImage' },
      }),
    ],
  ] as const)('%s is refused and names `%s`', async (_case, inputPath, buildArgs) => {
    const { error } = await previewAksFailure('prd', 'aks-orders', buildArgs);
    expect(error.message).toContain(inputPath);
  });
});

describe('An Automatic cluster refuses customer-key disk encryption', () => {
  test.each([
    ['disk encryption by the component', 'enableEncryption', { ...automaticArgs, enableEncryption: true }],
    [
      'its own disk encryption set "des-prd-orders"',
      'diskEncryptionSet',
      {
        ...automaticArgs,
        diskEncryptionSet: {
          id: '/subscriptions/sub/resourceGroups/rg-sec/providers/Microsoft.Compute/diskEncryptionSets/des-prd-orders',
        },
      },
    ],
  ] as const)(
    'a prd Automatic stack asking for %s fails, names `%s` and suggests the Base SKU name',
    async (_e, inputPath, args) => {
      const { error, registered } = await previewAksFailure('prd', 'aks-orders', args);

      expect(error.message).toContain(inputPath);
      expect(error.message).toContain("sku.name: 'Base'");
      expectNoChildRegistered(registered);
    },
  );
});

describe('An Automatic stack needs no setup beyond installing the package', () => {
  const repoRoot = path.resolve(__dirname, '../..');

  test('the package ships no generated SDK and declares no Pulumi package to generate', () => {
    expect(fs.existsSync(path.join(repoRoot, 'sdks'))).toBe(false);
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    expect(pkg.packages).toBeUndefined();
    expect(fs.readFileSync(path.join(repoRoot, 'PulumiPlugin.yaml'), 'utf8')).not.toMatch(/^packages:/m);
  });

  test('a prd Automatic cluster "aks-orders" previews with only the providers a Base cluster already needs', async () => {
    const { captured } = await sharedPreview('prd', 'aks-orders', automaticArgs);
    expect(aksClusterOf(captured).inputs.sku.name).toBe('Automatic');

    const providers = [...new Set(captured.map((c) => c.type.split(':')[0]).filter((p) => p !== 'drunk'))];
    // The provider set of a Base preview at 2ec1c9e (`pulumi-nodejs` is the built-in dynamic provider of SshGenerator).
    providers.forEach((p) => expect(['azure-native', 'azuread', 'pulumi-nodejs', 'random']).toContain(p));
  });
});

describe('The docs warn that removing the SKU name from a prd stack requests Automatic', () => {
  const repoRoot = path.resolve(__dirname, '../..');
  // Lowercased, backticks dropped, whitespace and JSDoc `*` gutters collapsed to one space.
  const normalise = (text: string) =>
    text
      .replace(/^\s*\*\s?/gm, ' ')
      .replace(/`/g, '')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  const warnsRemovalRequestsAutomatic =
    /remov\w*[^.]{0,40}\bsku(\.name| name)\b[^.]{0,60}\bprd\b[^.]{0,60}\bautomatic\b/;
  const saysAzureCannotMigrate = /\bazure cannot migrate\b[^.]{0,40}\bbase\b[^.]{0,40}\bautomatic\b/;

  test('the help text of `sku.name` carries both warnings', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'src/aks/AzKubernetes.ts'), 'utf8');
    const doc = source.match(/\bsku\??:\s*\{\s*(\/\*\*[\s\S]*?\*\/)\s*name\??:/);
    expect(doc).not.toBeNull();
    const helpText = normalise(doc![1]);

    expect(helpText).toMatch(warnsRemovalRequestsAutomatic);
    expect(helpText).toMatch(saysAzureCannotMigrate);
  });

  test('the component docs carry both warnings in a "SKU name" section', () => {
    const docs = fs.readFileSync(path.join(repoRoot, 'doc/aks/AzKubernetes.md'), 'utf8');
    const section = docs.match(/^#+ SKU name\s*$([\s\S]*?)(?=^#+ |(?![\s\S]))/im);
    expect(section).not.toBeNull();
    const text = normalise(section![1]);

    expect(text).toMatch(warnsRemovalRequestsAutomatic);
    expect(text).toMatch(saysAzureCannotMigrate);
  });
});
