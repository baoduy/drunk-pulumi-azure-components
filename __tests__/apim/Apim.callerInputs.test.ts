import { withStack, restoreStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1821 row 7 / rule R5: `network.vnetRules` makes Apim VNet-injected. One or more rules →
 * `External` with the first rule's subnet; `network.internal: true` → `Internal`; no `network` or an
 * empty `vnetRules` → `None` with no configuration and no throw.
 *
 * Runs on a non-prd stack (`withStack('dev')`). `disableSignIn: true` keeps the Entra ID app
 * registration out of the graph; only the ApiManagementService inputs are asserted.
 */

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
  sku: { name: 'Developer', capacity: 1 },
  disableSignIn: true,
  publisherName: 'drunkcoding',
};

function loadApim() {
  return withStack('dev', (p) => {
    const mod: typeof import('../../src/apim/Apim') = require('../../src/apim/Apim');
    return { pulumi: p, Apim: mod.Apim };
  });
}

async function apimServiceInputs(props: any) {
  const { pulumi, Apim, captured } = loadApim();
  const apim = new Apim('apim1', { ...baseArgs, ...props } as any);
  await pulumi.output(apim.id).promise();
  const service = captured.find((c) => c.type === 'azure-native:apimanagement:ApiManagementService');
  expect(service).toBeDefined();
  return service!.inputs;
}

describe('Apim — VNet injection from network.vnetRules (DRK-1821 R5)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('S7 — vnetRules with one subnet makes the service External on that subnet', async () => {
    const inputs = await apimServiceInputs({ network: { vnetRules: [{ subnetId: '/sub/s1' }] } });
    expect(inputs.virtualNetworkType).toBe('External');
    expect(inputs.virtualNetworkConfiguration).toEqual({ subnetResourceId: '/sub/s1' });
  });

  test('S8 — vnetRules with internal: true makes the service Internal on that subnet', async () => {
    const inputs = await apimServiceInputs({ network: { vnetRules: [{ subnetId: '/sub/s1' }], internal: true } });
    expect(inputs.virtualNetworkType).toBe('Internal');
    expect(inputs.virtualNetworkConfiguration).toEqual({ subnetResourceId: '/sub/s1' });
  });

  test('S9 — no network leaves the service outside any VNet', async () => {
    const inputs = await apimServiceInputs({});
    expect(inputs.virtualNetworkType).toBe('None');
    expect(inputs.virtualNetworkConfiguration).toBeUndefined();
  });

  test('S9 — an empty vnetRules list leaves the service outside any VNet and does not throw', async () => {
    const inputs = await apimServiceInputs({ network: { vnetRules: [] } });
    expect(inputs.virtualNetworkType).toBe('None');
    expect(inputs.virtualNetworkConfiguration).toBeUndefined();
  });
});
