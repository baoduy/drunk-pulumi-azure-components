import { aksClusterOf, aksStackHooks, previewAks, previewAksFailure } from '../testUtils/pulumiMocks';
import { RegisteredResource } from '../testUtils/pulumiParentSpy';

/**
 * DRK-2548 Build additions to the frozen DRK-2546 ATs (`AzKubernetes.automatic.test.ts`).
 *
 * R13 (amended): on an Automatic cluster the upgrade channels and an extra pool's `enableAutoScaling` must be literal
 * values. An Output or a Promise is refused before any child registers, even when its value would be allowed.
 * A channel left out takes the Automatic default while the other one is given.
 */

jest.setTimeout(30000);

const SUBNETS =
  '/subscriptions/sub/resourceGroups/rg-net/providers/Microsoft.Network/virtualNetworks/vnet-prd-hub/subnets';
const automaticArgs = {
  rsGroup: { resourceGroupName: 'rg-aks', location: 'southeastasia' },
  features: { enablePrivateCluster: false },
  network: {
    apiServerSubnetId: `${SUBNETS}/snet-aks-api`,
    systemNodeSubnetId: `${SUBNETS}/snet-aks-system`,
    workloadNodeSubnetId: `${SUBNETS}/snet-aks-workload`,
  },
};

const expectNoChildRegistered = (registered: RegisteredResource[]) =>
  expect(registered.filter((r) => r.type !== 'drunk:azure:AzKubernetes').map((r) => r.type)).toEqual([]);

aksStackHooks();

describe('An Automatic cluster refuses a non-literal value it must check before creating anything', () => {
  test.each([
    [
      'an upgrade channel given as an Output of "stable"',
      'autoUpgradeProfile.upgradeChannel',
      (p: typeof import('@pulumi/pulumi')) => ({
        ...automaticArgs,
        autoUpgradeProfile: { upgradeChannel: p.output('stable') },
      }),
    ],
    [
      'a node OS upgrade channel given as a Promise of "NodeImage"',
      'autoUpgradeProfile.nodeOSUpgradeChannel',
      () => ({ ...automaticArgs, autoUpgradeProfile: { nodeOSUpgradeChannel: Promise.resolve('NodeImage') } }),
    ],
    [
      'a whole upgrade profile given as an Output',
      'autoUpgradeProfile.upgradeChannel',
      (p: typeof import('@pulumi/pulumi')) => ({
        ...automaticArgs,
        autoUpgradeProfile: p.output({ upgradeChannel: 'stable', nodeOSUpgradeChannel: 'NodeImage' }),
      }),
    ],
    [
      'an extra node pool "batch" whose enableAutoScaling is an Output of false',
      'extraAgentPoolProfiles',
      (p: typeof import('@pulumi/pulumi')) => ({
        ...automaticArgs,
        extraAgentPoolProfiles: [
          {
            name: 'batch',
            vnetSubnetID: `${SUBNETS}/snet-aks-workload`,
            enableEncryptionAtHost: true,
            osDiskSizeGB: 128,
            enableAutoScaling: p.output(false),
          },
        ],
      }),
    ],
  ] as const)('%s is refused at once and names `%s`', async (_case, inputPath, buildArgs) => {
    const { error, registered } = await previewAksFailure('prd', 'aks-orders', buildArgs);

    expect(error.message).toBe(
      `AzKubernetes 'aks-orders' is an AKS Automatic cluster: \`${inputPath}\` must be a literal value, not an Output or a Promise.`,
    );
    expectNoChildRegistered(registered);
  });
});

describe('An Automatic cluster fills the upgrade channel the stack leaves out', () => {
  test.each([
    ['only the upgrade channel "stable"', { upgradeChannel: 'stable' }],
    ['only the node OS upgrade channel "NodeImage"', { nodeOSUpgradeChannel: 'NodeImage' }],
  ])('a stack giving %s runs on stable / NodeImage', async (_case, autoUpgradeProfile) => {
    const { captured } = await previewAks('prd', 'aks-orders', { ...automaticArgs, autoUpgradeProfile });

    expect(aksClusterOf(captured).inputs.properties.autoUpgradeProfile).toEqual({
      upgradeChannel: 'stable',
      nodeOSUpgradeChannel: 'NodeImage',
    });
  });
});
