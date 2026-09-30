import { restoreStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1814 Build-stage additions next to the frozen ATs in AzSearch.test.ts: pin the invoke inputs,
 * the fixed contentType, and the skip when the service name is not yet known.
 */

const SEARCH_QUERY_KEYS_TOKEN = 'azure-native:search:listQueryKeyBySearchService';
const SEARCH_SERVICE_TYPE = 'azure-native:search:Service';
const VAULT_SECRET_RESOURCE_TYPE = 'drunk-pulumi:vault:VaultSecretResourceMock';

const vaultInfo = { resourceGroupName: 'rg-vault', resourceName: 'kv1', id: 'kv1_id' };

async function deployAndSettle(opts: { serviceName?: string }) {
  process.env.PULUMI_NODEJS_STACK = 'dev';
  jest.resetModules();
  const pulumi: typeof import('@pulumi/pulumi') = require('@pulumi/pulumi');

  const secrets: any[] = [];
  const queryKeyCalls: any[] = [];
  pulumi.runtime.setMocks({
    newResource: (args: any) => {
      if (args.type === VAULT_SECRET_RESOURCE_TYPE) secrets.push(args.inputs);
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
  return { secrets, queryKeyCalls };
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

  test('service name not known: the query keys are not read and no secret is created', async () => {
    const { secrets, queryKeyCalls } = await deployAndSettle({ serviceName: undefined });

    expect(queryKeyCalls).toHaveLength(0);
    expect(secrets).toHaveLength(0);
  });
});
