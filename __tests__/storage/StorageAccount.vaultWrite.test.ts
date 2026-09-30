import { asSecret, registrationOf as inputsOf, quietStackHooks, settle, withStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1864 acceptance test S7: StorageAccount reads its account keys inside
 * `listStorageAccountKeysOutput(...).apply`, which hands the key values over as plain strings, and writes
 * them to Key Vault through `VaultSecrets`. Every key value must reach the `drunk:azure:VaultSecrets` and
 * `drunk:azure:VaultSecret` component registrations secret-marked, never bare.
 */

const STORAGE_KEYS_TOKEN = 'azure-native:storage:listStorageAccountKeys';
const VAULT_SECRETS_COMPONENT_TYPE = 'drunk:azure:VaultSecrets';
const VAULT_SECRET_COMPONENT_TYPE = 'drunk:azure:VaultSecret';

const vaultInfo = { resourceGroupName: 'rg-vault', resourceName: 'kv1', id: 'kv1_id' };

async function deployAndSettle() {
  const { pulumi, sa, captured } = withStack(
    'dev',
    (pulumi) => {
      const {
        StorageAccount,
      }: typeof import('../../src/storage/StorageAccount') = require('../../src/storage/StorageAccount');
      const sa = new StorageAccount('sa1', { rsGroup: { resourceGroupName: 'rg' }, vaultInfo } as any);
      return { pulumi, sa };
    },
    undefined,
    (args) =>
      args.token === STORAGE_KEYS_TOKEN
        ? {
            keys: [
              { keyName: 'key1', value: 'STG-KEY-SECRET-1' },
              { keyName: 'key2', value: 'STG-KEY-SECRET-2' },
            ],
          }
        : undefined,
  );
  await settle(pulumi, sa.id);
  return captured.filter((c) => c.type === VAULT_SECRETS_COMPONENT_TYPE || c.type === VAULT_SECRET_COMPONENT_TYPE);
}

describe('StorageAccount — account key vault write (DRK-1864)', () => {
  quietStackHooks();

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
