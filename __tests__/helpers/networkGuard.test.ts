import { withStack, restoreStack } from '../testUtils/pulumiMocks';

type Guard = typeof import('../../src/helpers/networkGuard');

const loadGuard = (stackName: string): Guard =>
  withStack(stackName, () => ({ guard: require('../../src/helpers/networkGuard') as Guard })).guard;

const privateLink = { subnetInfo: { subnetId: 'snet' } };
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

/** The thrown message, compared whole with `toBe` — `toThrow('text')` would only match a substring. */
const messageOf = (act: () => unknown): string | undefined => {
  try {
    act();
  } catch (err) {
    return (err as Error).message;
  }
  return undefined;
};

describe('networkGuard.assertPrdNetworkRestricted', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('prd with no network throws the rules-or-private-link message', () => {
    const { assertPrdNetworkRestricted } = loadGuard('prd');
    expect(messageOf(() => assertPrdNetworkRestricted('KeyVault', 'kv1', undefined))).toBe(
      "KeyVault 'kv1' is open to the internet, which is not allowed in prd. " +
        'Use `network.privateLink` without `publicNetworkAccess: true`, or `network.ipRules` / `network.vnetRules`.',
    );
  });

  test('prd privateLinkOnly with ipRules and no privateLink throws the private-link-only message', () => {
    const { assertPrdNetworkRestricted } = loadGuard('prd');
    expect(
      messageOf(() =>
        assertPrdNetworkRestricted('AppConfig', 'ac1', { ipRules: ['1.2.3.4'] }, { privateLinkOnly: true }),
      ),
    ).toBe(
      "AppConfig 'ac1' is open to the internet, which is not allowed in prd. " +
        'Use `network.privateLink` without `publicNetworkAccess: true`.',
    );
  });

  test('prd privateLinkOnly with privateLink is accepted', () => {
    const { assertPrdNetworkRestricted } = loadGuard('prd');
    expect(() =>
      assertPrdNetworkRestricted('AppConfig', 'ac2', { privateLink }, { privateLinkOnly: true }),
    ).not.toThrow();
  });

  test('prd with vnetRules only is accepted', () => {
    const { assertPrdNetworkRestricted } = loadGuard('prd');
    expect(() => assertPrdNetworkRestricted('ServiceBus', 'sb1', { vnetRules: [{ subnetId: 'snet' }] })).not.toThrow();
  });

  test('non-prd with no network does not throw', () => {
    const { assertPrdNetworkRestricted } = loadGuard('dev');
    expect(() => assertPrdNetworkRestricted('KeyVault', 'kv2', undefined)).not.toThrow();
  });

  test('prd AppConfig component with ipRules and no privateLink throws, because App Configuration has no IP firewall', async () => {
    const { AppConfig } = withStack('prd', () => ({ AppConfig: require('../../src/app/AppConfig').AppConfig }));
    expect(
      messageOf(
        () =>
          new AppConfig('ac-prd-ip', {
            rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
            network: { ipRules: ['1.2.3.4'] },
          } as any),
      ),
    ).toBe(
      "AppConfig 'ac-prd-ip' is open to the internet, which is not allowed in prd. " +
        'Use `network.privateLink` without `publicNetworkAccess: true`.',
    );
    // The component registered itself before the guard threw; let that finish before the next withStack.
    await settle();
  });
});

describe('prd ServiceBus without a real restriction throws (DRK-1842 I1, N1)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  const rsGroup = { resourceGroupName: 'rg', location: 'eastus' };
  const sku = { name: 'Premium', tier: 'Premium', capacity: 1 };
  const message = (name: string) =>
    `ServiceBus '${name}' is open to the internet, which is not allowed in prd. ` +
    'Use `network.privateLink` without `publicNetworkAccess: true`, or `network.ipRules` / `network.vnetRules`.';

  test.each([
    ['sb-prd-empty-ip', { ipRules: [] }],
    ['sb-prd-empty-vnet', { vnetRules: [] }],
    ['sb-prd-deny-only', { defaultAction: 'Deny' }],
  ])('%s with %j throws', async (name, network) => {
    const { ServiceBus } = withStack('prd', () => ({
      ServiceBus: require('../../src/services/ServiceBus').ServiceBus,
    }));
    expect(messageOf(() => new ServiceBus(name, { rsGroup, sku, disableLocalAuth: true, network } as any))).toBe(
      message(name),
    );
    await settle();
  });

  test('prd guard counts an unresolved Output of ipRules as a restriction', () => {
    const { pulumi, guard } = withStack('prd', (p) => ({
      pulumi: p,
      guard: require('../../src/helpers/networkGuard') as Guard,
    }));
    expect(() =>
      guard.assertPrdNetworkRestricted('ServiceBus', 'sb-out', { ipRules: pulumi.output(['1.2.3.4']) }),
    ).not.toThrow();
  });
});

describe('networkGuard.hasNetworkRules', () => {
  test.each([
    [undefined, false],
    [{}, false],
    [{ ipRules: ['1.2.3.4'] }, true],
    [{ vnetRules: [{ subnetId: 'snet' }] }, true],
  ])('%j gives %s', (network, expected) => {
    expect(loadGuard('dev').hasNetworkRules(network as any)).toBe(expected);
  });
});
