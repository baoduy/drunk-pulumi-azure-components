import { withStack, restoreStack, Captured } from '../testUtils/pulumiMocks';

/**
 * Acceptance tests for DRK-1817 (PULUMI-SEC-006): configured network restrictions take effect in
 * every environment, and in prd an AppConfig, KeyVault or ServiceBus can no longer be deployed
 * open to the internet — it is private-link-only or IP/vnet-restricted, or construction throws.
 *
 * Rules (brief DRK-1843 §6):
 * - R1 KeyVault/ServiceBus: `ipRules` or `vnetRules` supplied => `defaultAction` is `Deny`.
 * - R2 KeyVault/ServiceBus: no rules => caller `defaultAction`, else `Allow`.
 * - R3 AppConfig: `privateLink` set and `publicNetworkAccess` not `true` => `Disabled`.
 * - R4 prd KeyVault/ServiceBus: accepted only with rules, or `privateLink` without `publicNetworkAccess: true`.
 * - R5 prd AppConfig: accepted only with `privateLink` without `publicNetworkAccess: true`.
 * - R6 the thrown message names the component type, the resource name and the accepted shapes.
 * - R7 non-prd: no guard throws.
 *
 * `azureEnv.isPrd` is read once at module load, so every case reloads the component under an
 * explicit stack name through `withStack`, as `prdDatabaseDefaults.test.ts` does.
 */

type Kind = 'AppConfig' | 'KeyVault' | 'ServiceBus';

const modulePaths: Record<Kind, string> = {
  AppConfig: '../../src/app/AppConfig',
  KeyVault: '../../src/vault/KeyVault',
  ServiceBus: '../../src/services/ServiceBus',
};

const SUBNET_ID = '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet/subnets/snet';
const privateLink = { subnetInfo: { subnetId: SUBNET_ID } };

const baseArgs: Record<Kind, object> = {
  AppConfig: { rsGroup: { resourceGroupName: 'rg', location: 'eastus' } },
  KeyVault: { rsGroup: { resourceGroupName: 'rg', location: 'eastus' } },
  ServiceBus: {
    rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
    disableLocalAuth: true,
    sku: { name: 'Premium', tier: 'Premium', capacity: 1 },
  },
};

// PrivateEndpoint reads customDnsConfigs[].ipAddresses back off its own resource state.
const privateEndpointState = (args: { type: string }) =>
  args.type === 'azure-native:network:PrivateEndpoint' ? { customDnsConfigs: [{ ipAddresses: ['10.0.0.4'] }] } : {};

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

async function build(kind: Kind, stackName: string, name: string, network?: object) {
  const { pulumi, Component, captured } = withStack(
    stackName,
    (p) => ({
      pulumi: p,
      Component: require(modulePaths[kind])[kind],
    }),
    privateEndpointState,
  );
  try {
    const component = new Component(name, { ...baseArgs[kind], network } as any);
    await pulumi.output(component.id).promise();
  } finally {
    // Let fire-and-forget children (network rule sets, private endpoints) settle before the next
    // `withStack` swaps the mock monitor out from under them — also when construction threw.
    await settle();
  }
  return captured;
}

/** Constructs the component and returns what it threw, or `undefined` when it did not throw. */
async function thrownBy(kind: Kind, stackName: string, name: string, network?: object): Promise<Error | undefined> {
  const { pulumi, Component } = withStack(
    stackName,
    (p) => ({
      pulumi: p,
      Component: require(modulePaths[kind])[kind],
    }),
    privateEndpointState,
  );
  let thrown: Error | undefined;
  try {
    const component = new Component(name, { ...baseArgs[kind], network } as any);
    await pulumi.output(component.id).promise();
  } catch (err) {
    thrown = err as Error;
  }
  // Whether or not construction threw, let registrations already in flight finish against this
  // mock monitor before the next `withStack` replaces it.
  await settle();
  return thrown;
}

const inputsOf = (captured: Captured[], type: string) => captured.find((c) => c.type === type)?.inputs;
const appConfigStore = (c: Captured[]) => inputsOf(c, 'azure-native:appconfiguration:ConfigurationStore');
const vault = (c: Captured[]) => inputsOf(c, 'azure-native:keyvault:Vault');
const busRuleSet = (c: Captured[]) => inputsOf(c, 'azure-native:servicebus:NamespaceNetworkRuleSet');
const busNamespace = (c: Captured[]) => inputsOf(c, 'azure-native:servicebus:Namespace');

describe('DRK-1817 non-prd — configured network restrictions take effect', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('AppConfig with privateLink gets publicNetworkAccess Disabled', async () => {
    const captured = await build('AppConfig', 'dev', 'ac-dev-pl', { privateLink });
    expect(appConfigStore(captured).publicNetworkAccess).toBe('Disabled');
  });

  test('AppConfig with publicNetworkAccess true and privateLink gets publicNetworkAccess Enabled', async () => {
    const captured = await build('AppConfig', 'dev', 'ac-dev-public-pl', { publicNetworkAccess: true, privateLink });
    expect(appConfigStore(captured).publicNetworkAccess).toBe('Enabled');
  });

  test('KeyVault with ipRules gets networkAcls defaultAction Deny', async () => {
    const captured = await build('KeyVault', 'dev', 'kv-dev-ip', { ipRules: ['1.2.3.4'] });
    expect(vault(captured).properties.networkAcls.defaultAction).toBe('Deny');
    expect(vault(captured).properties.networkAcls.ipRules).toEqual([{ value: '1.2.3.4' }]);
  });

  test('KeyVault with vnetRules gets networkAcls defaultAction Deny', async () => {
    const captured = await build('KeyVault', 'dev', 'kv-dev-vnet', { vnetRules: [{ subnetId: SUBNET_ID }] });
    expect(vault(captured).properties.networkAcls.defaultAction).toBe('Deny');
    expect(vault(captured).properties.networkAcls.virtualNetworkRules).toEqual([{ id: SUBNET_ID }]);
  });

  test('KeyVault with no rules and no defaultAction gets networkAcls defaultAction Allow', async () => {
    const captured = await build('KeyVault', 'dev', 'kv-dev-open', {});
    expect(vault(captured).properties.networkAcls.defaultAction).toBe('Allow');
  });

  test('ServiceBus with ipRules gets network rule set defaultAction Deny', async () => {
    const captured = await build('ServiceBus', 'dev', 'sb-dev-ip', { ipRules: ['1.2.3.4'] });
    expect(busRuleSet(captured).defaultAction).toBe('Deny');
    expect(busRuleSet(captured).ipRules).toEqual([{ ipMask: '1.2.3.4', action: 'Allow' }]);
  });

  test('ServiceBus with defaultAction Deny and no rules gets network rule set defaultAction Deny', async () => {
    const captured = await build('ServiceBus', 'dev', 'sb-dev-deny', { defaultAction: 'Deny' });
    expect(busRuleSet(captured).defaultAction).toBe('Deny');
  });

  test('ServiceBus with no network does not throw and creates the namespace', async () => {
    expect(await thrownBy('ServiceBus', 'dev', 'sb-dev-none-throw')).toBeUndefined();
    const captured = await build('ServiceBus', 'dev', 'sb-dev-none');
    expect(busNamespace(captured)).toBeDefined();
  });
});

describe('DRK-1817 prd — a private-link-only or IP/vnet-restricted resource is accepted', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('prd KeyVault with privateLink is accepted with publicNetworkAccess Disabled', async () => {
    const captured = await build('KeyVault', 'prd', 'kv-prd-pl', { privateLink });
    expect(vault(captured).properties.publicNetworkAccess).toBe('Disabled');
  });

  test('prd KeyVault with ipRules is accepted with networkAcls defaultAction Deny', async () => {
    const captured = await build('KeyVault', 'prd', 'kv-prd-ip', { ipRules: ['1.2.3.4'] });
    expect(vault(captured).properties.networkAcls.defaultAction).toBe('Deny');
  });

  test('prd ServiceBus with vnetRules is accepted with network rule set defaultAction Deny', async () => {
    const captured = await build('ServiceBus', 'prd', 'sb-prd-vnet', { vnetRules: [{ subnetId: SUBNET_ID }] });
    expect(busRuleSet(captured).defaultAction).toBe('Deny');
  });

  test('prd AppConfig with privateLink is accepted with publicNetworkAccess Disabled', async () => {
    const captured = await build('AppConfig', 'prd', 'ac-prd-pl', { privateLink });
    expect(appConfigStore(captured).publicNetworkAccess).toBe('Disabled');
  });
});

describe('DRK-1817 prd — an open resource throws at construction', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  /** R6: the message names the component type, the resource name and the accepted shapes. */
  function expectPrdNetworkError(err: Error | undefined, kind: Kind, name: string) {
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toContain(kind);
    expect(err!.message).toContain(name);
    expect(err!.message).toContain('privateLink');
    if (kind !== 'AppConfig') {
      expect(err!.message).toContain('ipRules');
      expect(err!.message).toContain('vnetRules');
    }
  }

  test.each(['AppConfig', 'KeyVault', 'ServiceBus'] as Kind[])('prd %s with no network throws', async (kind) => {
    const name = `${kind.toLowerCase()}-prd-no-network`;
    expectPrdNetworkError(await thrownBy(kind, 'prd', name), kind, name);
  });

  test.each(['KeyVault', 'ServiceBus'] as Kind[])(
    'prd %s with publicNetworkAccess true and privateLink and no rules throws',
    async (kind) => {
      const name = `${kind.toLowerCase()}-prd-public-pl`;
      expectPrdNetworkError(await thrownBy(kind, 'prd', name, { publicNetworkAccess: true, privateLink }), kind, name);
    },
  );

  test('prd KeyVault with defaultAction Allow and no rules throws', async () => {
    const name = 'keyvault-prd-allow';
    expectPrdNetworkError(await thrownBy('KeyVault', 'prd', name, { defaultAction: 'Allow' }), 'KeyVault', name);
  });

  test('prd AppConfig with publicNetworkAccess true and privateLink throws', async () => {
    const name = 'appconfig-prd-public-pl';
    expectPrdNetworkError(
      await thrownBy('AppConfig', 'prd', name, { publicNetworkAccess: true, privateLink }),
      'AppConfig',
      name,
    );
  });
});
