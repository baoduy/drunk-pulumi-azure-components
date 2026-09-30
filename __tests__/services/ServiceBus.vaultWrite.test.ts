import { restoreStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1864 acceptance test S6: ServiceBus reads its namespace connection strings with the promise-form
 * `listNamespaceKeys` invoke, which returns plain strings, and writes them to Key Vault through
 * `VaultSecrets`. Both connection strings must reach every `drunk:azure:VaultSecrets` and
 * `drunk:azure:VaultSecret` component registration secret-marked, never bare.
 */

const NAMESPACE_KEYS_TOKEN = 'azure-native:servicebus:listNamespaceKeys';
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
      if (args.token !== NAMESPACE_KEYS_TOKEN) return args.inputs;
      return { primaryConnectionString: 'SB-CONN-SECRET-P', secondaryConnectionString: 'SB-CONN-SECRET-S' };
    },
  });

  const { ServiceBus }: typeof import('../../src/services/ServiceBus') = require('../../src/services/ServiceBus');
  const sb = new ServiceBus('sb1', {
    rsGroup: { resourceGroupName: 'rg' },
    sku: { name: 'Basic' },
    disableLocalAuth: false,
    vaultInfo,
  } as any);
  await pulumi.output(sb.id).promise();
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));
  return components;
}

function inputsOf(components: { type: string; name: string; inputs: any }[], type: string, name: string) {
  const found = components.filter((c) => c.type === type && c.name === name);
  expect(found).toHaveLength(1);
  return found[0].inputs;
}

describe('ServiceBus — connection string vault write (DRK-1864)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    restoreStack(ORIGINAL_STACK);
  });

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
