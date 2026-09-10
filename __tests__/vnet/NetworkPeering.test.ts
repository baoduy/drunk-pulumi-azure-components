import { withStack, restoreStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1047 / PULUMI-PKG-002 — NetworkPeering must call `registerOutputs({})` as the last
 * constructor statement. Unlike the Base*Component classes, NetworkPeering extends
 * `pulumi.ComponentResource` directly, so there is no `getOutputs()` to lean on — the empty
 * object is the whole payload.
 *
 * Pulumi's own ComponentResource base class also calls `registerOutputs()` itself,
 * asynchronously, once the component's `initialize()` resolves — a guarded no-op if the
 * component already registered, but a spy still counts it. So the assertion that matters —
 * "the constructor calls registerOutputs()" — must run synchronously, right after
 * `new NetworkPeering(...)` and before any await (see CustomRoles.test.ts for the same note).
 */
const rg = 'rg';
const vnet = (short: string) => ({
  resourceGroupName: rg,
  resourceName: `org-proj-stack-${short}`,
  id: `/subscriptions/sub/resourceGroups/${rg}/providers/Microsoft.Network/virtualNetworks/org-proj-stack-${short}`,
});

// createPeering runs inside `pulumi.all([...]).apply(...)`, which resolves on a later tick even
// though registerOutputs({}) itself is called synchronously outside that `.apply()` — give it one
// tick to settle before asserting on `captured` (mirrors __tests__/storage/StorageAccount.test.ts).
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('NetworkPeering — registerOutputs (PULUMI-PKG-002)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('unidirectional peering registers outputs and creates exactly one VirtualNetworkPeering', async () => {
    const { pulumi, NetworkPeering, captured } = withStack('dev', (p) => {
      const mod: typeof import('../../src/vnet/NetworkPeering') = require('../../src/vnet/NetworkPeering');
      return { pulumi: p, NetworkPeering: mod.NetworkPeering };
    });
    const spy = jest.spyOn(pulumi.ComponentResource.prototype, 'registerOutputs');

    const peering = new NetworkPeering('peer1', {
      firstVnet: vnet('first'),
      secondVnet: vnet('second'),
      direction: 'Unidirectional',
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.instances[0]).toBe(peering);
    expect(spy.mock.calls[0][0]).toEqual({});

    await settle();
    const peerings = captured.filter((c) => c.type === 'azure-native:network:VirtualNetworkPeering');
    expect(peerings).toHaveLength(1);
    expect(peerings[0].inputs.virtualNetworkName).toBe('org-proj-stack-first');
    expect(peerings[0].inputs.remoteVirtualNetwork).toEqual({ id: vnet('second').id });

    spy.mockRestore();
  });

  test('bidirectional peering registers outputs and creates a peering in both directions', async () => {
    const { pulumi, NetworkPeering, captured } = withStack('dev', (p) => {
      const mod: typeof import('../../src/vnet/NetworkPeering') = require('../../src/vnet/NetworkPeering');
      return { pulumi: p, NetworkPeering: mod.NetworkPeering };
    });
    const spy = jest.spyOn(pulumi.ComponentResource.prototype, 'registerOutputs');

    new NetworkPeering('peer2', {
      firstVnet: vnet('first'),
      secondVnet: vnet('second'),
      direction: 'Bidirectional',
    });
    expect(spy).toHaveBeenCalledTimes(1);

    await settle();
    const peerings = captured.filter((c) => c.type === 'azure-native:network:VirtualNetworkPeering');
    expect(peerings).toHaveLength(2);
    expect(peerings.map((p) => p.inputs.virtualNetworkName).sort()).toEqual(
      ['org-proj-stack-first', 'org-proj-stack-second'].sort(),
    );

    spy.mockRestore();
  });
});
