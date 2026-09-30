import { withStack, restoreStack } from '../testUtils/pulumiMocks';

// DRK-1840 REWORK: the storage access key must leave getStorageAccessKeyOutputs as a Pulumi secret on
// both paths, so it never lands in plaintext in state or `pulumi up` diffs (PULUMI-SEC-009).

jest.mock('@drunk-pulumi/azure-providers/AzBase/KeyVaultBase', () => ({
  __esModule: true,
  default: () => ({ getSecret: async () => ({ value: 'vault-key' }) }),
}));

const stg = { resourceName: 'stglogs', rsGroup: { resourceGroupName: 'rg' } };

function load() {
  return withStack(
    'dev',
    (pulumi) => {
      const helpers: typeof import('../../src/storage/helpers') = require('../../src/storage/helpers');
      return { pulumi, helpers };
    },
    undefined,
    (args) =>
      args.token === 'azure-native:storage:listStorageAccountKeys' ? { keys: [{ value: 'stg-key' }] } : undefined,
  );
}

describe('getStorageAccessKeyOutputs — key is a secret', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('key read from the storage account is a secret', async () => {
    const { pulumi, helpers } = load();

    const key = helpers.getStorageAccessKeyOutputs(stg);

    expect(await pulumi.isSecret(key)).toBe(true);
    expect(await key.promise()).toBe('stg-key');
  });

  test('key read from Key Vault is a secret', async () => {
    const { pulumi, helpers } = load();

    const key = helpers.getStorageAccessKeyOutputs(stg, {
      resourceName: 'vault1',
      rsGroup: { resourceGroupName: 'rg' },
    } as any);

    expect(await pulumi.isSecret(key)).toBe(true);
    expect(await key.promise()).toBe('vault-key');
  });
});
