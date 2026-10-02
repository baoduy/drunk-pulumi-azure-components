import type { VnetArgs } from '../../src/vnet/VirtualNetwork';
import { withStack, restoreStack, settle } from '../testUtils/pulumiMocks';

// DRK-1922 Build addition (brief §9 Q4): traffic analytics takes `workspaceId` from the workspace's
// `customerId` when given, and `workspaceRegion` from the VNet's resource group location.
const STORAGE_ID = '/subscriptions/sub/resourceGroups/rg-logs/providers/Microsoft.Storage/storageAccounts/stgflowlogs';
const WORKSPACE_ID =
  '/subscriptions/sub/resourceGroups/rg-logs/providers/Microsoft.OperationalInsights/workspaces/logs';

async function analyticsOf(workspace: NonNullable<VnetArgs['flowLog']>['trafficAnalytics']) {
  const { pulumi, Vnet, captured } = withStack('dev', (p) => ({
    pulumi: p,
    Vnet: require('../../src/vnet/VirtualNetwork').Vnet,
  }));
  const vnet = new Vnet('hub', {
    rsGroup: { resourceGroupName: 'rg-net', location: 'southeastasia' },
    vnet: { subnets: [{ subnetName: 'app', addressPrefix: '10.0.1.0/24' }] },
    flowLog: { storageAccountId: STORAGE_ID, trafficAnalytics: workspace },
  });
  await settle(pulumi, vnet.vnet.id);
  const flowLog = captured.find((c) => c.type === 'azure-native:network:FlowLog')!;
  return flowLog.inputs.flowAnalyticsConfiguration.networkWatcherFlowAnalyticsConfiguration;
}

describe('Vnet — traffic analytics workspace id and region', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('a workspace with a customerId sends it as workspaceId and the VNet location as workspaceRegion', async () => {
    const analytics = await analyticsOf({
      workspace: {
        id: WORKSPACE_ID,
        resourceName: 'logs',
        resourceGroupName: 'rg-logs',
        customerId: '00000000-0000-0000-0000-000000000001',
      },
    });

    expect(analytics.workspaceId).toBe('00000000-0000-0000-0000-000000000001');
    expect(analytics.workspaceRegion).toBe('southeastasia');
  });

  test('a workspace without a customerId sends no workspaceId', async () => {
    const analytics = await analyticsOf({
      workspace: { id: WORKSPACE_ID, resourceName: 'logs', resourceGroupName: 'rg-logs' },
    });

    expect(analytics.workspaceId).toBeUndefined();
    expect(analytics.workspaceResourceId).toBe(WORKSPACE_ID);
  });
});
