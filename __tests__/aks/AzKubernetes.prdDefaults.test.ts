import { withStack, aksState, aksStackHooks, settleAks } from '../testUtils/pulumiMocks';

// Each case reloads the AKS module graph through `withStack` and builds a cluster; under a parallel
// full-suite run one case can exceed Jest's 5 s default.
jest.setTimeout(30000);

/**
 * DRK-1815 (PULUMI-SEC-010): PRD AKS clusters default to Defender for Containers (when a log
 * workspace is given), the Azure Policy add-on and the `Standard` SKU tier; non-PRD defaults to
 * `Free` with policy and Defender off. Every explicit caller value still wins (DRK-770).
 *
 * `isPrd` is read once at module load, so every case reloads AzKubernetes under an explicit stack
 * name through `withStack`.
 */

const WORKSPACE_ID =
  '/subscriptions/sub/resourceGroups/rg-logs/providers/Microsoft.OperationalInsights/workspaces/logs';
const logWorkspace = { id: WORKSPACE_ID, resourceName: 'logs', resourceGroupName: 'rg-logs' };

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
  sku: { name: 'Base' },
  features: { enablePrivateCluster: false },
  agentPoolProfiles: [{ name: 'system', vnetSubnetID: 'subnet_id', enableEncryptionAtHost: false, osDiskSizeGB: 128 }],
};

async function clusterInputs(stackName: 'prd' | 'dev', props: Record<string, unknown> = {}) {
  const { pulumi, AzKubernetes, captured } = withStack(
    stackName,
    (p) => ({ pulumi: p, AzKubernetes: require('../../src/aks/AzKubernetes').AzKubernetes }),
    aksState,
  );

  const aks = new AzKubernetes('prd-defaults', { ...baseArgs, ...props } as any);
  await settleAks(pulumi, aks);
  return captured.find((c: any) => c.type === 'azure-native:containerservice:ManagedCluster')!.inputs;
}

aksStackHooks();

describe('DRK-1815 Enforcement — PRD security and SLA defaults', () => {
  test('a prd cluster that sets none of these values gets Defender, Azure Policy and the Standard tier', async () => {
    const inputs = await clusterInputs('prd', { logWorkspace });
    expect(inputs.securityProfile.defender.securityMonitoring.enabled).toBe(true);
    expect(inputs.addonProfiles.azurePolicy.enabled).toBe(true);
    expect(inputs.sku.tier).toBe('Standard');
  });

  test('a dev cluster that sets none of these values gets the Free tier, no Azure Policy and no Defender', async () => {
    const inputs = await clusterInputs('dev', { logWorkspace });
    expect(inputs.sku.tier).toBe('Free');
    expect(inputs.addonProfiles.azurePolicy.enabled).toBe(false);
    expect(inputs.securityProfile.defender).toBeUndefined();
  });
});

describe('R1 — SKU tier defaults by environment, explicit tier wins', () => {
  test('a prd cluster without a tier runs on Standard', async () => {
    expect((await clusterInputs('prd')).sku).toEqual({ name: 'Base', tier: 'Standard' });
  });

  test('a dev cluster without a tier runs on Free', async () => {
    expect((await clusterInputs('dev')).sku).toEqual({ name: 'Base', tier: 'Free' });
  });

  test('a prd cluster keeps the Free tier the engineer chose', async () => {
    expect((await clusterInputs('prd', { sku: { name: 'Base', tier: 'Free' } })).sku).toEqual({
      name: 'Base',
      tier: 'Free',
    });
  });

  test('a dev cluster keeps the Standard tier the engineer chose', async () => {
    expect((await clusterInputs('dev', { sku: { name: 'Base', tier: 'Standard' } })).sku).toEqual({
      name: 'Base',
      tier: 'Standard',
    });
  });

  test('a dev Automatic cluster without a tier runs on Standard, the tier Azure preconfigures for Automatic', async () => {
    expect((await clusterInputs('dev', { sku: { name: 'Automatic' } })).sku).toEqual({
      name: 'Automatic',
      tier: 'Standard',
    });
  });
});

describe('R2 — Azure Policy add-on defaults by environment, explicit flag wins', () => {
  test('a prd cluster without the policy flag gets the Azure Policy add-on', async () => {
    expect((await clusterInputs('prd')).addonProfiles.azurePolicy).toEqual({ enabled: true });
  });

  test('a dev cluster without the policy flag has the Azure Policy add-on off', async () => {
    expect((await clusterInputs('dev')).addonProfiles.azurePolicy).toEqual({ enabled: false });
  });

  test('a prd cluster keeps the Azure Policy add-on off when the engineer turned it off', async () => {
    const inputs = await clusterInputs('prd', { features: { enablePrivateCluster: false, enableAzurePolicy: false } });
    expect(inputs.addonProfiles.azurePolicy).toEqual({ enabled: false });
  });

  test('a dev cluster keeps the Azure Policy add-on on when the engineer turned it on', async () => {
    const inputs = await clusterInputs('dev', { features: { enablePrivateCluster: false, enableAzurePolicy: true } });
    expect(inputs.addonProfiles.azurePolicy).toEqual({ enabled: true });
  });
});

describe('R3 — Defender for Containers defaults on in prd when a log workspace is given, explicit flag wins', () => {
  const defenderOn = { logAnalyticsWorkspaceResourceId: WORKSPACE_ID, securityMonitoring: { enabled: true } };

  test('a prd cluster with a log workspace and no Defender flag sends Defender to that workspace', async () => {
    expect((await clusterInputs('prd', { logWorkspace })).securityProfile.defender).toEqual(defenderOn);
  });

  test('a prd cluster keeps Defender off when the engineer turned it off', async () => {
    const inputs = await clusterInputs('prd', { logWorkspace: { ...logWorkspace, defenderEnabled: false } });
    expect(inputs.securityProfile.defender).toBeUndefined();
  });

  test('a dev cluster with a log workspace and no Defender flag has Defender off', async () => {
    expect((await clusterInputs('dev', { logWorkspace })).securityProfile.defender).toBeUndefined();
  });

  test('a prd cluster without a log workspace has Defender off', async () => {
    expect((await clusterInputs('prd')).securityProfile.defender).toBeUndefined();
  });

  test('a dev cluster keeps Defender on when the engineer turned it on', async () => {
    const inputs = await clusterInputs('dev', { logWorkspace: { ...logWorkspace, defenderEnabled: true } });
    expect(inputs.securityProfile.defender).toEqual(defenderOn);
  });
});
