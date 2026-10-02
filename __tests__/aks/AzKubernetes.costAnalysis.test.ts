import { withStack, restoreStack, mockAksFetch } from '../testUtils/pulumiMocks';

/**
 * DRK-1922 row 4 — opt-in AKS cost analysis (acceptance tests, DRK-1986).
 *
 * `features.enableCostAnalysis: true` sends `metricsProfile.costAnalysis.enabled: true` when the resolved
 * SKU tier is not `Free`. On `Free` Azure rejects it, so it is omitted with a warning in any env (R5, brief
 * §9 Q3). Without the flag no metrics profile is sent in any env (R1); in prd that writes one warning and the
 * cluster is still created (R2); outside prd nothing is written (R3). The DRK-1815 tier default is untouched:
 * prd resolves to Standard, dev to Free, an explicit tier wins (R6).
 *
 * `isPrd` is read once at module load, so every case reloads AzKubernetes under an explicit stack name
 * through `withStack`.
 */

// Each case reloads the AKS module graph and builds a cluster; under a parallel full run that can exceed 5 s.
jest.setTimeout(30000);

const CLUSTER_NAME = 'aks-cost';

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
  sku: { name: 'Base' },
  agentPoolProfiles: [{ name: 'system', vnetSubnetID: 'subnet_id', enableEncryptionAtHost: false, osDiskSizeGB: 128 }],
};

// Same extra state the existing AKS tests return, so the addon/OIDC reads resolve.
const aksState = () => ({
  addonProfiles: {
    azureKeyvaultSecretsProvider: {
      identity: { resourceId: 'kv_identity_id', clientId: 'kv_client', objectId: 'kv_object' },
    },
  },
  oidcIssuerProfile: { issuerURL: 'https://issuer.example.com' },
});

async function deploy(stackName: 'prd' | 'dev', props: { enableCostAnalysis?: boolean; tier?: string } = {}) {
  const { pulumi, AzKubernetes, captured } = withStack(
    stackName,
    (p) => ({ pulumi: p, AzKubernetes: require('../../src/aks/AzKubernetes').AzKubernetes }),
    aksState,
  );
  const warn = jest.spyOn(pulumi.log, 'warn').mockImplementation(() => undefined);

  const features: Record<string, unknown> = { enablePrivateCluster: false };
  if ('enableCostAnalysis' in props) features.enableCostAnalysis = props.enableCostAnalysis;
  const sku = props.tier ? { name: 'Base', tier: props.tier } : baseArgs.sku;

  const aks = new AzKubernetes(CLUSTER_NAME, { ...baseArgs, sku, features } as any);
  await pulumi.output(aks.id).promise();
  if (aks.kubeletIdentity) await pulumi.output(aks.kubeletIdentity).promise();
  if (aks.systemIdentityId) await pulumi.output(aks.systemIdentityId).promise();
  // Let fire-and-forget children settle before the next `withStack` swaps the mock monitor.
  await new Promise((resolve) => setTimeout(resolve, 50));

  const cluster = captured.find((c: any) => c.type === 'azure-native:containerservice:ManagedCluster')!.inputs;
  // Warnings that name this cluster and the cost-analysis input.
  const costWarnings = warn.mock.calls
    .map((call) => String(call[0]))
    .filter((m) => m.includes('AzKubernetes') && m.includes(CLUSTER_NAME) && m.includes('features.enableCostAnalysis'));
  return { cluster, costWarnings };
}

const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
let restoreFetch: () => void;
beforeAll(() => {
  restoreFetch = mockAksFetch();
});
afterAll(() => restoreFetch());
// Each fresh `@pulumi/pulumi` copy that `withStack` loads adds a process `exit` listener; drop the ones a
// case added so the reloads don't pile up past Node's 10-listener limit.
let exitListeners: Function[] = [];
beforeEach(() => {
  exitListeners = process.listeners('exit');
});
afterEach(() => {
  restoreStack(ORIGINAL_STACK);
  for (const listener of process.listeners('exit')) {
    if (!exitListeners.includes(listener)) process.removeListener('exit', listener as (code: number) => void);
  }
});

describe('cost analysis is sent when asked for on a paid tier', () => {
  test('a prd cluster (Standard by default) with cost analysis on sends metricsProfile.costAnalysis enabled', async () => {
    const { cluster, costWarnings } = await deploy('prd', { enableCostAnalysis: true });

    expect(cluster.sku.tier).toBe('Standard');
    expect(cluster.metricsProfile).toEqual({ costAnalysis: { enabled: true } });
    expect(costWarnings).toHaveLength(0);
  });

  test('a dev cluster on the Standard tier the engineer chose, with cost analysis on, sends it', async () => {
    const { cluster, costWarnings } = await deploy('dev', { enableCostAnalysis: true, tier: 'Standard' });

    expect(cluster.metricsProfile).toEqual({ costAnalysis: { enabled: true } });
    expect(costWarnings).toHaveLength(0);
  });

  test('a dev cluster on the Premium tier the engineer chose, with cost analysis on, sends it', async () => {
    const { cluster } = await deploy('dev', { enableCostAnalysis: true, tier: 'Premium' });

    expect(cluster.metricsProfile).toEqual({ costAnalysis: { enabled: true } });
  });
});

describe('cost analysis is never sent on the Free tier (R5)', () => {
  test('a dev cluster (Free by default) with cost analysis on omits it and writes one warning', async () => {
    const { cluster, costWarnings } = await deploy('dev', { enableCostAnalysis: true });

    expect(cluster.sku.tier).toBe('Free');
    expect(cluster.metricsProfile).toBeUndefined();
    expect(costWarnings).toHaveLength(1);
  });

  test('a prd cluster on the Free tier the engineer chose, with cost analysis on, omits it and writes one warning', async () => {
    const { cluster, costWarnings } = await deploy('prd', { enableCostAnalysis: true, tier: 'Free' });

    expect(cluster.sku.tier).toBe('Free');
    expect(cluster.metricsProfile).toBeUndefined();
    expect(costWarnings).toHaveLength(1);
  });
});

describe('no metrics profile without the flag (R1)', () => {
  test.each(['prd', 'dev'] as const)('a %s cluster without the flag sends no metricsProfile', async (stack) => {
    const { cluster } = await deploy(stack);

    expect(cluster.metricsProfile).toBeUndefined();
  });

  test('a prd cluster with cost analysis turned off sends no metricsProfile', async () => {
    const { cluster } = await deploy('prd', { enableCostAnalysis: false });

    expect(cluster.metricsProfile).toBeUndefined();
  });
});

describe('prd warns when cost analysis is left off, the cluster is still created (R2)', () => {
  test('a prd cluster without the flag writes one warning naming the cluster and features.enableCostAnalysis', async () => {
    const { cluster, costWarnings } = await deploy('prd');

    expect(cluster).toBeDefined();
    expect(costWarnings).toHaveLength(1);
  });

  test('a prd cluster with cost analysis turned off writes the same warning', async () => {
    const { costWarnings } = await deploy('prd', { enableCostAnalysis: false });

    expect(costWarnings).toHaveLength(1);
  });
});

describe('outside prd nothing is written when the flag is absent (R3)', () => {
  test('a dev cluster without the flag writes no cost-analysis warning', async () => {
    const { costWarnings } = await deploy('dev');

    expect(costWarnings).toHaveLength(0);
  });
});
