import { withStack, restoreStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1822 S3 Build-stage additions next to the frozen ATs in AppConfig.tiering.test.ts: pin the
 * private endpoint and the connection-string vault write, so the touched AppConfig class meets the
 * coverage and mutation bar.
 */

jest.setTimeout(30_000);

const STORE_TYPE = 'azure-native:appconfiguration:ConfigurationStore';
const PRIVATE_ENDPOINT_TYPE = 'drunk:azure:PrivateEndpoint';
const VAULT_SECRETS_TYPE = 'drunk:azure:VaultSecrets';
const LIST_KEYS_TOKEN = 'azure-native:appconfiguration:listConfigurationStoreKeys';

const vaultInfo = { resourceGroupName: 'rg-vault', resourceName: 'kv1', id: 'kv1_id' };

async function deploy(extra: Record<string, unknown>) {
  const listKeyCalls: any[] = [];
  const { pulumi, AppConfig, captured } = withStack(
    'dev',
    (p) => ({ pulumi: p, AppConfig: require('../../src/app/AppConfig').AppConfig }),
    // PrivateEndpoint reads customDnsConfigs[].ipAddresses back off its own resource state.
    (args) =>
      args.type === 'azure-native:network:PrivateEndpoint' ? { customDnsConfigs: [{ ipAddresses: ['10.0.0.4'] }] } : {},
    (args) => {
      if (args.token !== LIST_KEYS_TOKEN) return undefined;
      listKeyCalls.push(args.inputs);
      return { value: [{ value: 'primary-conn' }, { value: 'secondary-conn' }] };
    },
  );

  const store = new AppConfig('appcfg1', { rsGroup: { resourceGroupName: 'rg', location: 'eastus' }, ...extra });
  const outputs = store.getOutputs();
  await pulumi.output(outputs).promise();
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));

  const byType = (type: string) => captured.filter((c) => c.type === type);
  return { pulumi, outputs, byType, listKeyCalls };
}

describe('AppConfig — private endpoint and vault secrets (DRK-1822 Build)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    restoreStack(ORIGINAL_STACK);
  });

  test('outputs carry the store id, name and resource group', async () => {
    const { pulumi, outputs } = await deploy({});

    expect(await pulumi.output(outputs.id).promise()).toBe('appcfg1_id');
    expect(await pulumi.output(outputs.resourceName).promise()).toBe('appcfg1');
    expect(await pulumi.output(outputs.resourceGroupName).promise()).toBe('rg');
  });

  test('no privateLink means no private endpoint', async () => {
    const { byType } = await deploy({});

    expect(byType(PRIVATE_ENDPOINT_TYPE)).toHaveLength(0);
  });

  test('privateLink adds one azConfig private endpoint', async () => {
    const { byType } = await deploy({ network: { privateLink: { subnetInfo: { subnetId: 'pe-subnet' } } } });

    const endpoints = byType(PRIVATE_ENDPOINT_TYPE);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].inputs.type).toBe('azConfig');
  });

  test('vaultInfo writes the primary and secondary connection strings from the store keys', async () => {
    const { byType, listKeyCalls } = await deploy({ vaultInfo });

    expect(listKeyCalls).toEqual([{ configStoreName: 'appcfg1', resourceGroupName: 'rg' }]);
    const vaultSecrets = byType(VAULT_SECRETS_TYPE);
    expect(vaultSecrets).toHaveLength(1);
    expect(Object.keys(vaultSecrets[0].inputs.secrets)).toEqual(['appcfg1-primary-conn', 'appcfg1-secondary-conn']);
    expect(vaultSecrets[0].inputs.secrets['appcfg1-primary-conn'].contentType).toBe(
      'AppConfig primary connectionString',
    );
    expect(vaultSecrets[0].inputs.secrets['appcfg1-secondary-conn'].contentType).toBe(
      'AppConfig secondary connectionString',
    );
  });

  test('disableLocalAuth skips the vault write', async () => {
    const { byType, listKeyCalls } = await deploy({ vaultInfo, disableLocalAuth: true });

    expect(listKeyCalls).toHaveLength(0);
    expect(byType(VAULT_SECRETS_TYPE)).toHaveLength(0);
  });

  test('no vaultInfo skips the vault write', async () => {
    const { byType, listKeyCalls } = await deploy({});

    expect(listKeyCalls).toHaveLength(0);
    expect(byType(VAULT_SECRETS_TYPE)).toHaveLength(0);
    expect(byType(STORE_TYPE)).toHaveLength(1);
  });
});
