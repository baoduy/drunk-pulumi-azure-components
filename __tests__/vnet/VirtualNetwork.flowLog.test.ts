import type { VnetArgs } from '../../src/vnet/VirtualNetwork';
import { withStack, restoreStack, settle } from '../testUtils/pulumiMocks';

/**
 * DRK-1922 row 7 — opt-in VNet flow logs (acceptance tests, DRK-1986).
 *
 * `flowLog` creates one `network.FlowLog` on the VNet: logs go to the caller's storage account, retention is
 * on for `retentionDays` (default 90), the watcher defaults to Azure's auto-created `NetworkWatcher_<location>`
 * in `NetworkWatcherRG` (brief §9 Q1) unless the caller names one, and traffic analytics is on only when a
 * workspace is given (interval default 60). Without the input no flow log is created in any env (R1); in prd
 * that writes one warning and the VNet is still created (R2); outside prd nothing is written (R3).
 *
 * `isPrd` is read once at module load, so every case reloads Vnet under an explicit stack name through
 * `withStack`.
 */

jest.setTimeout(30_000);

const VNET_TYPE = 'azure-native:network:VirtualNetwork';
const FLOW_LOG_TYPE = 'azure-native:network:FlowLog';
const STORAGE_ID = '/subscriptions/sub/resourceGroups/rg-logs/providers/Microsoft.Storage/storageAccounts/stgflowlogs';
const WORKSPACE = {
  id: '/subscriptions/sub/resourceGroups/rg-logs/providers/Microsoft.OperationalInsights/workspaces/logs',
  resourceName: 'logs',
  resourceGroupName: 'rg-logs',
  customerId: '00000000-0000-0000-0000-000000000001',
};

async function deploy(stackName: string, flowLog?: VnetArgs['flowLog']) {
  const { pulumi, Vnet, captured } = withStack(stackName, (p) => ({
    pulumi: p,
    Vnet: require('../../src/vnet/VirtualNetwork').Vnet,
  }));
  const warn = jest.spyOn(pulumi.log, 'warn').mockImplementation(() => undefined);

  const args: VnetArgs = {
    rsGroup: { resourceGroupName: 'rg-net', location: 'southeastasia' },
    vnet: { subnets: [{ subnetName: 'app', addressPrefix: '10.0.1.0/24' }] },
    ...(flowLog ? { flowLog } : {}),
  };
  const vnet = new Vnet('hub', args);
  await settle(pulumi, vnet.vnet.id);

  const byType = (type: string) => captured.filter((c) => c.type === type);
  // Warnings that name this VNet and the flowLog input.
  const flowLogWarnings = warn.mock.calls
    .map((call) => String(call[0]))
    .filter((m) => m.includes('Vnet') && m.includes('hub') && m.includes('flowLog'));
  return { byType, flowLogWarnings };
}

describe('Vnet — opt-in VNet flow logs', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  let logSpy: jest.SpyInstance;
  // Each fresh `@pulumi/pulumi` copy that `withStack` loads adds a process `exit` listener; drop the ones a
  // case added so the reloads don't pile up past Node's 10-listener limit.
  let exitListeners: Function[] = [];
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    exitListeners = process.listeners('exit');
  });
  afterEach(() => {
    logSpy.mockRestore();
    restoreStack(ORIGINAL_STACK);
    for (const listener of process.listeners('exit')) {
      if (!exitListeners.includes(listener)) process.removeListener('exit', listener as (code: number) => void);
    }
  });

  describe('flowLog creates one flow log on the VNet', () => {
    test.each(['prd', 'dev'])(
      '%s: flowLog with a storage account logs the VNet into it through the default watcher',
      async (stack) => {
        const { byType } = await deploy(stack, { storageAccountId: STORAGE_ID });

        const flowLogs = byType(FLOW_LOG_TYPE);
        expect(flowLogs).toHaveLength(1);
        const inputs = flowLogs[0].inputs;
        expect(inputs.targetResourceId).toBe('hub-vnet_id');
        expect(inputs.storageId).toBe(STORAGE_ID);
        expect(inputs.enabled).toBe(true);
        expect(inputs.location).toBe('southeastasia');
        expect(inputs.networkWatcherName).toBe('NetworkWatcher_southeastasia');
        expect(inputs.resourceGroupName).toBe('NetworkWatcherRG');
        expect(inputs.retentionPolicy).toEqual({ enabled: true, days: 90 });
        expect(inputs.flowAnalyticsConfiguration).toBeUndefined();
      },
    );

    test('retentionDays the engineer set wins over the 90-day default (R6)', async () => {
      const { byType } = await deploy('dev', { storageAccountId: STORAGE_ID, retentionDays: 30 });

      expect(byType(FLOW_LOG_TYPE)[0].inputs.retentionPolicy).toEqual({ enabled: true, days: 30 });
    });

    test('a network watcher the engineer named wins over the default (R6)', async () => {
      const { byType } = await deploy('dev', {
        storageAccountId: STORAGE_ID,
        networkWatcher: { name: 'nw-hub', resourceGroupName: 'rg-watchers' },
      });

      const inputs = byType(FLOW_LOG_TYPE)[0].inputs;
      expect(inputs.networkWatcherName).toBe('nw-hub');
      expect(inputs.resourceGroupName).toBe('rg-watchers');
    });

    test('a traffic analytics workspace turns analytics on into that workspace every 60 minutes', async () => {
      const { byType } = await deploy('dev', {
        storageAccountId: STORAGE_ID,
        trafficAnalytics: { workspace: WORKSPACE },
      });

      const analytics =
        byType(FLOW_LOG_TYPE)[0].inputs.flowAnalyticsConfiguration.networkWatcherFlowAnalyticsConfiguration;
      expect(analytics.enabled).toBe(true);
      expect(analytics.workspaceResourceId).toBe(WORKSPACE.id);
      expect(analytics.trafficAnalyticsInterval).toBe(60);
    });

    test('the traffic analytics interval the engineer set wins over 60 (R6)', async () => {
      const { byType } = await deploy('dev', {
        storageAccountId: STORAGE_ID,
        trafficAnalytics: { workspace: WORKSPACE, intervalInMinutes: 10 },
      });

      const analytics =
        byType(FLOW_LOG_TYPE)[0].inputs.flowAnalyticsConfiguration.networkWatcherFlowAnalyticsConfiguration;
      expect(analytics.trafficAnalyticsInterval).toBe(10);
    });
  });

  describe('no flow log without the input (R1)', () => {
    test.each(['prd', 'dev'])('%s: no flowLog input means no FlowLog', async (stack) => {
      const { byType } = await deploy(stack);

      expect(byType(VNET_TYPE)).toHaveLength(1);
      expect(byType(FLOW_LOG_TYPE)).toHaveLength(0);
    });
  });

  describe('prd warns when flow logs are left off, the VNet is still created (R2)', () => {
    test('prd without flowLog writes one warning naming the VNet and the flowLog input', async () => {
      const { byType, flowLogWarnings } = await deploy('prd');

      expect(flowLogWarnings).toHaveLength(1);
      expect(byType(VNET_TYPE)).toHaveLength(1);
    });

    test('prd with flowLog writes no flow-log warning', async () => {
      const { flowLogWarnings } = await deploy('prd', { storageAccountId: STORAGE_ID });

      expect(flowLogWarnings).toHaveLength(0);
    });
  });

  describe('outside prd nothing is written (R3)', () => {
    test('dev without flowLog writes no flow-log warning', async () => {
      const { flowLogWarnings } = await deploy('dev');

      expect(flowLogWarnings).toHaveLength(0);
    });
  });
});
