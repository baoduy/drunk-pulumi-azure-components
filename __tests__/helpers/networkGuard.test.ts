import { withStack, restoreStack } from '../testUtils/pulumiMocks';

type Guard = typeof import('../../src/helpers/networkGuard');

const loadGuard = (stackName: string): Guard =>
  withStack(stackName, () => ({ guard: require('../../src/helpers/networkGuard') as Guard })).guard;

const privateLink = { subnetInfo: { subnetId: 'snet' } };

describe('networkGuard.assertPrdNetworkRestricted', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('prd with no network throws the rules-or-private-link message', () => {
    const { assertPrdNetworkRestricted } = loadGuard('prd');
    expect(() => assertPrdNetworkRestricted('KeyVault', 'kv1', undefined)).toThrow(
      "KeyVault 'kv1' is open to the internet, which is not allowed in prd. " +
        'Use `network.privateLink` without `publicNetworkAccess: true`, or `network.ipRules` / `network.vnetRules`.',
    );
  });

  test('prd privateLinkOnly with ipRules and no privateLink throws the private-link-only message', () => {
    const { assertPrdNetworkRestricted } = loadGuard('prd');
    expect(() =>
      assertPrdNetworkRestricted('AppConfig', 'ac1', { ipRules: ['1.2.3.4'] }, { privateLinkOnly: true }),
    ).toThrow(
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

  test('prd AppConfig component with ipRules and no privateLink throws, because App Configuration has no IP firewall', () => {
    const { AppConfig } = withStack('prd', () => ({ AppConfig: require('../../src/app/AppConfig').AppConfig }));
    expect(
      () =>
        new AppConfig('ac-prd-ip', {
          rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
          network: { ipRules: ['1.2.3.4'] },
        } as any),
    ).toThrow("AppConfig 'ac-prd-ip' is open to the internet");
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
