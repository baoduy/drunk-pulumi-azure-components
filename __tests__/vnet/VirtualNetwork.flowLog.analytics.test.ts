import type { VnetArgs } from '../../src/vnet/VirtualNetwork';
import { withStack, settle, quietStackHooks } from '../testUtils/pulumiMocks';

/**
 * DRK-1922 Build additions. The flow log's region is the VNet's own location as an Azure region code, so a
 * display name such as `Southeast Asia` still finds `NetworkWatcher_southeastasia` (review B1). Traffic
 * analytics takes `workspaceId` from the workspace's `customerId` (brief §9 Q4), and `workspaceRegion` from
 * the workspace's `location`, else the VNet's region (review S1).
 */
const STORAGE_ID = '/subscriptions/sub/resourceGroups/rg-logs/providers/Microsoft.Storage/storageAccounts/stgflowlogs';
const WORKSPACE = {
  id: '/subscriptions/sub/resourceGroups/rg-logs/providers/Microsoft.OperationalInsights/workspaces/logs',
  resourceName: 'logs',
  resourceGroupName: 'rg-logs',
};

async function flowLogOf(location: string | undefined, flowLog: Partial<NonNullable<VnetArgs['flowLog']>> = {}) {
  const { pulumi, Vnet, captured } = withStack('dev', (p) => ({
    pulumi: p,
    Vnet: require('../../src/vnet/VirtualNetwork').Vnet,
  }));
  const vnet = new Vnet('hub', {
    rsGroup: { resourceGroupName: 'rg-net', location },
    vnet: { subnets: [{ subnetName: 'app', addressPrefix: '10.0.1.0/24' }] },
    flowLog: { storageAccountId: STORAGE_ID, ...flowLog },
  });
  await settle(pulumi, vnet.vnet.id);
  return captured.find((c) => c.type === 'azure-native:network:FlowLog')!.inputs;
}

describe('Vnet — flow log region and traffic analytics workspace', () => {
  quietStackHooks();

  test('a VNet in "Southeast Asia" uses the NetworkWatcher_southeastasia watcher and region', async () => {
    const flowLog = await flowLogOf('Southeast Asia');

    expect(flowLog.networkWatcherName).toBe('NetworkWatcher_southeastasia');
    expect(flowLog.location).toBe('southeastasia');
  });

  test('a VNet without a location falls back to the stack region (SoutheastAsia when unset)', async () => {
    const flowLog = await flowLogOf(undefined);

    expect(flowLog.networkWatcherName).toBe('NetworkWatcher_southeastasia');
    expect(flowLog.location).toBe('southeastasia');
  });

  test('a workspace with a customerId sends it as workspaceId', async () => {
    const flowLog = await flowLogOf('southeastasia', {
      trafficAnalytics: { workspace: { ...WORKSPACE, customerId: '00000000-0000-0000-0000-000000000001' } },
    });

    const analytics = flowLog.flowAnalyticsConfiguration.networkWatcherFlowAnalyticsConfiguration;
    expect(analytics.workspaceId).toBe('00000000-0000-0000-0000-000000000001');
  });

  test('a workspace without a customerId sends no workspaceId', async () => {
    const flowLog = await flowLogOf('southeastasia', { trafficAnalytics: { workspace: WORKSPACE } });

    const analytics = flowLog.flowAnalyticsConfiguration.networkWatcherFlowAnalyticsConfiguration;
    expect(analytics.workspaceId).toBeUndefined();
    expect(analytics.workspaceResourceId).toBe(WORKSPACE.id);
  });

  test('a workspace without a location takes the VNet region as workspaceRegion', async () => {
    const flowLog = await flowLogOf('Southeast Asia', { trafficAnalytics: { workspace: WORKSPACE } });

    const analytics = flowLog.flowAnalyticsConfiguration.networkWatcherFlowAnalyticsConfiguration;
    expect(analytics.workspaceRegion).toBe('southeastasia');
  });

  test('a workspace in "East US" sends eastus as workspaceRegion', async () => {
    const flowLog = await flowLogOf('Southeast Asia', {
      trafficAnalytics: { workspace: { ...WORKSPACE, location: 'East US' } },
    });

    const analytics = flowLog.flowAnalyticsConfiguration.networkWatcherFlowAnalyticsConfiguration;
    expect(analytics.workspaceRegion).toBe('eastus');
  });
});
