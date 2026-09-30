import { restoreStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1814 Build-stage additions next to the frozen ATs in AzSearch.test.ts: pin the invoke inputs,
 * the fixed contentType, the skip when the service name is not yet known, and the secret marking of
 * the query key on every component registration that carries it.
 */

const SEARCH_QUERY_KEYS_TOKEN = 'azure-native:search:listQueryKeyBySearchService';
const SEARCH_SERVICE_TYPE = 'azure-native:search:Service';
const VAULT_SECRET_RESOURCE_TYPE = 'drunk-pulumi:vault:VaultSecretResourceMock';
const VAULT_SECRETS_COMPONENT_TYPE = 'drunk:azure:VaultSecrets';
const VAULT_SECRET_COMPONENT_TYPE = 'drunk:azure:VaultSecret';

// Pulumi's wire envelope for a secret-marked value; a plain value would arrive as the bare string.
const asSecret = (value: unknown) => ({
  '4dabf18193072939515e22adb298388d': '1b47061264138c4ac30d75fd1eb44270',
  value,
});

const vaultInfo = { resourceGroupName: 'rg-vault', resourceName: 'kv1', id: 'kv1_id' };

async function deployAndSettle(opts: { serviceName?: string }) {
  process.env.PULUMI_NODEJS_STACK = 'dev';
  jest.resetModules();
  const pulumi: typeof import('@pulumi/pulumi') = require('@pulumi/pulumi');

  const secrets: any[] = [];
  const components: { type: string; inputs: any }[] = [];
  const queryKeyCalls: any[] = [];
  pulumi.runtime.setMocks({
    newResource: (args: any) => {
      if (args.type === VAULT_SECRET_RESOURCE_TYPE) secrets.push(args.inputs);
      if (args.type === VAULT_SECRETS_COMPONENT_TYPE || args.type === VAULT_SECRET_COMPONENT_TYPE)
        components.push({ type: args.type, inputs: args.inputs });
      const name = args.type === SEARCH_SERVICE_TYPE ? opts.serviceName : args.name;
      return { id: `${args.name}_id`, state: { ...args.inputs, name } };
    },
    call: (args: any) => {
      if (args.token !== SEARCH_QUERY_KEYS_TOKEN) return args.inputs;
      queryKeyCalls.push(args.inputs);
      return { value: [{ key: 'QK-SECRET-0', name: 'label-0' }] };
    },
  });

  const { AzSearch }: typeof import('../../src/services/AzSearch') = require('../../src/services/AzSearch');
  const az = new AzSearch('az1', { rsGroup: { resourceGroupName: 'rg' }, sku: 'basic', vaultInfo } as any);
  await pulumi.output(az.id).promise();
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));
  return { secrets, components, queryKeyCalls };
}

describe('AzSearch — query key vault write details (DRK-1814)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    restoreStack(ORIGINAL_STACK);
  });

  test('query keys are read from the created service in its resource group', async () => {
    const { queryKeyCalls } = await deployAndSettle({ serviceName: 'az-search-svc' });

    expect(queryKeyCalls).toEqual([{ searchServiceName: 'az-search-svc', resourceGroupName: 'rg' }]);
  });

  test('each secret carries the fixed contentType "AzSearch query key"', async () => {
    const { secrets } = await deployAndSettle({ serviceName: 'az-search-svc' });

    expect(secrets.map((s) => s.contentType)).toEqual(['AzSearch query key']);
  });

  test('the query key reaches the VaultSecrets and VaultSecret component inputs secret-marked, never plain', async () => {
    const { components } = await deployAndSettle({ serviceName: 'az-search-svc' });

    const byType = Object.fromEntries(components.map((c) => [c.type, c.inputs]));

    // A secret nested in the VaultSecrets `secrets` map marks the whole map secret on the wire.
    expect(byType[VAULT_SECRETS_COMPONENT_TYPE].secrets).toEqual(
      asSecret({ 'az1-query-key-0': { contentType: 'AzSearch query key', value: 'QK-SECRET-0' } }),
    );
    expect(byType[VAULT_SECRET_COMPONENT_TYPE].value).toEqual(asSecret('QK-SECRET-0'));
  });

  test('service name not known: the query keys are not read and no secret is created', async () => {
    const { secrets, queryKeyCalls } = await deployAndSettle({ serviceName: undefined });

    expect(queryKeyCalls).toHaveLength(0);
    expect(secrets).toHaveLength(0);
  });
});
