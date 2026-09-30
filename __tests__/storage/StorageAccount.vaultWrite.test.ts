import { restoreStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1864 acceptance test S7: StorageAccount reads its account keys inside
 * `listStorageAccountKeysOutput(...).apply`, which hands the key values over as plain strings, and writes
 * them to Key Vault through `VaultSecrets`. Every key value must reach the `drunk:azure:VaultSecrets` and
 * `drunk:azure:VaultSecret` component registrations secret-marked, never bare.
 */

const STORAGE_KEYS_TOKEN = 'azure-native:storage:listStorageAccountKeys';
const VAULT_SECRETS_COMPONENT_TYPE = 'drunk:azure:VaultSecrets';
const VAULT_SECRET_COMPONENT_TYPE = 'drunk:azure:VaultSecret';

// Pulumi's wire envelope for a secret-marked value; a plain value would arrive as the bare string.
const asSecret = (value: unknown) => ({
  '4dabf18193072939515e22adb298388d': '1b47061264138c4ac30d75fd1eb44270',
  value,
});

const vaultInfo = { resourceGroupName: 'rg-vault', resourceName: 'kv1', id: 'kv1_id' };

async function deployAndSettle() {
  process.env.PULUMI_NODEJS_STACK = 'dev';
  jest.resetModules();
  const pulumi: typeof import('@pulumi/pulumi') = require('@pulumi/pulumi');

  const components: { type: string; name: string; inputs: any }[] = [];
  pulumi.runtime.setMocks({
    newResource: (args: any) => {
      if (args.type === VAULT_SECRETS_COMPONENT_TYPE || args.type === VAULT_SECRET_COMPONENT_TYPE)
        components.push({ type: args.type, name: args.name, inputs: args.inputs });
      return { id: `${args.name}_id`, state: { ...args.inputs, name: args.name } };
    },
    call: (args: any) => {
      if (args.token !== STORAGE_KEYS_TOKEN) return args.inputs;
      return {
        keys: [
          { keyName: 'key1', value: 'STG-KEY-SECRET-1' },
          { keyName: 'key2', value: 'STG-KEY-SECRET-2' },
        ],
      };
    },
  });

  const {
    StorageAccount,
  }: typeof import('../../src/storage/StorageAccount') = require('../../src/storage/StorageAccount');
  const sa = new StorageAccount('sa1', { rsGroup: { resourceGroupName: 'rg' }, vaultInfo } as any);
  await pulumi.output(sa.id).promise();
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));
  return components;
}

function inputsOf(components: { type: string; name: string; inputs: any }[], type: string, name: string) {
  const found = components.filter((c) => c.type === type && c.name === name);
  expect(found).toHaveLength(1);
  return found[0].inputs;
}

describe('StorageAccount — account key vault write (DRK-1864)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    restoreStack(ORIGINAL_STACK);
  });

  test('S7 — storage account key values reach the VaultSecrets and VaultSecret registrations secret-marked', async () => {
    const components = await deployAndSettle();

    expect(inputsOf(components, VAULT_SECRETS_COMPONENT_TYPE, 'sa1').secrets).toEqual(
      asSecret({
        'sa1-key1': { value: 'STG-KEY-SECRET-1', contentType: 'StorageAccount key1' },
        'sa1-key2': { value: 'STG-KEY-SECRET-2', contentType: 'StorageAccount key2' },
      }),
    );
    expect(inputsOf(components, VAULT_SECRET_COMPONENT_TYPE, 'sa1-key1').value).toEqual(asSecret('STG-KEY-SECRET-1'));
    expect(inputsOf(components, VAULT_SECRET_COMPONENT_TYPE, 'sa1-key2').value).toEqual(asSecret('STG-KEY-SECRET-2'));
  }, 30000);
});
