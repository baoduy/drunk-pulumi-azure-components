import { asSecret, registrationOf as inputsOf, quietStackHooks, settle, withStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1864 acceptance test S6: ServiceBus reads its namespace connection strings with the promise-form
 * `listNamespaceKeys` invoke, which returns plain strings, and writes them to Key Vault through
 * `VaultSecrets`. Both connection strings must reach every `drunk:azure:VaultSecrets` and
 * `drunk:azure:VaultSecret` component registration secret-marked, never bare.
 */

const NAMESPACE_KEYS_TOKEN = 'azure-native:servicebus:listNamespaceKeys';
const VAULT_SECRETS_COMPONENT_TYPE = 'drunk:azure:VaultSecrets';
const VAULT_SECRET_COMPONENT_TYPE = 'drunk:azure:VaultSecret';

const vaultInfo = { resourceGroupName: 'rg-vault', resourceName: 'kv1', id: 'kv1_id' };

async function deployAndSettle() {
  const { pulumi, sb, captured } = withStack(
    'dev',
    (pulumi) => {
      const { ServiceBus }: typeof import('../../src/services/ServiceBus') = require('../../src/services/ServiceBus');
      const sb = new ServiceBus('sb1', {
        rsGroup: { resourceGroupName: 'rg' },
        sku: { name: 'Basic' },
        disableLocalAuth: false,
        vaultInfo,
      } as any);
      return { pulumi, sb };
    },
    undefined,
    (args) =>
      args.token === NAMESPACE_KEYS_TOKEN
        ? { primaryConnectionString: 'SB-CONN-SECRET-P', secondaryConnectionString: 'SB-CONN-SECRET-S' }
        : undefined,
  );
  await settle(pulumi, sb.id);
  return captured.filter((c) => c.type === VAULT_SECRETS_COMPONENT_TYPE || c.type === VAULT_SECRET_COMPONENT_TYPE);
}

describe('ServiceBus — connection string vault write (DRK-1864)', () => {
  quietStackHooks();

  test('S6 — both namespace connection strings reach every VaultSecrets and VaultSecret registration secret-marked', async () => {
    const components = await deployAndSettle();

    // One VaultSecrets per authorization rule: the root rule plus the listen and send rules.
    for (const rule of ['sb1-RootManageSharedAccessKey', 'sb1-sb1-listen', 'sb1-sb1-send']) {
      expect(inputsOf(components, VAULT_SECRETS_COMPONENT_TYPE, rule).secrets).toEqual(
        asSecret({
          [`${rule}-primary-conn`]: {
            value: 'SB-CONN-SECRET-P',
            contentType: 'ServiceBus Primary ConnectionString',
          },
          [`${rule}-secondary-conn`]: {
            value: 'SB-CONN-SECRET-S',
            contentType: 'ServiceBus Secondary ConnectionString',
          },
        }),
      );

      const primary = inputsOf(components, VAULT_SECRET_COMPONENT_TYPE, `${rule}-primary-conn`);
      expect(primary.value).toEqual(asSecret('SB-CONN-SECRET-P'));
      expect(primary.contentType).toBe('ServiceBus Primary ConnectionString');

      const secondary = inputsOf(components, VAULT_SECRET_COMPONENT_TYPE, `${rule}-secondary-conn`);
      expect(secondary.value).toEqual(asSecret('SB-CONN-SECRET-S'));
      expect(secondary.contentType).toBe('ServiceBus Secondary ConnectionString');
    }

    // No component registration anywhere carries either connection string bare.
    const bareValues = components.map((c) => c.inputs.value).filter((v) => typeof v === 'string');
    expect(bareValues).not.toContain('SB-CONN-SECRET-P');
    expect(bareValues).not.toContain('SB-CONN-SECRET-S');
  }, 30000);
});
