import { restoreStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1865 — Redis with `vaultInfo` must write its `<name>-redis-*` secrets to Key Vault.
 *
 * R1: all Redis secrets are collected before `registerOutputs()` and written in one `VaultSecrets`.
 * R2: every value that carries the access key reaches the vault inputs secret-marked, never plain.
 * R3: `disableAccessKeyAuthentication: true` → no `listRedisKeys` invoke and no `-redis-pass` secret.
 * R5: no `vaultInfo` → no vault secret and no `listRedisKeys` invoke.
 *
 * Each scenario awaits the cache id and then lets pending promise chains settle before asserting.
 */

const REDIS_TYPE = 'azure-native:redis:Redis';
const LIST_REDIS_KEYS_TOKEN = 'azure-native:redis:listRedisKeys';
const VAULT_SECRET_RESOURCE_TYPE = 'drunk-pulumi:vault:VaultSecretResourceMock';
const VAULT_SECRETS_COMPONENT_TYPE = 'drunk:azure:VaultSecrets';
const VAULT_SECRET_COMPONENT_TYPE = 'drunk:azure:VaultSecret';

// Non-empty on purpose: an empty host would make every host assertion vacuous.
const HOST_NAME = 'cache1.redis.cache.windows.net';
const PRIMARY_KEY = 'RK-PRIMARY-KEY';

// Pulumi's wire envelope for a secret-marked value; a plain value arrives as the bare string.
const SECRET_SIG_KEY = '4dabf18193072939515e22adb298388d';
const SECRET_SIG = '1b47061264138c4ac30d75fd1eb44270';
const asSecret = (value: unknown) => ({ [SECRET_SIG_KEY]: SECRET_SIG, value });
const unwrap = (v: any) => (v && typeof v === 'object' && v[SECRET_SIG_KEY] === SECRET_SIG ? v.value : v);

const vaultInfo = { resourceGroupName: 'rg-vault', resourceName: 'kv1', id: 'kv1_id' };
const baseArgs = {
  rsGroup: { resourceGroupName: 'rg' },
  sku: { name: 'Basic', family: 'C', capacity: 0 },
};

type Captured = { type: string; name: string; inputs: any };

async function deployAndSettle(extraArgs: object) {
  process.env.PULUMI_NODEJS_STACK = 'dev';
  jest.resetModules();
  const pulumi: typeof import('@pulumi/pulumi') = require('@pulumi/pulumi');

  const captured: Captured[] = [];
  const listKeysCalls: any[] = [];
  pulumi.runtime.setMocks({
    newResource: (args: any) => {
      captured.push({ type: args.type, name: args.name, inputs: args.inputs });
      const extra = args.type === REDIS_TYPE ? { hostName: HOST_NAME } : {};
      return { id: `${args.name}_id`, state: { ...args.inputs, name: args.name, ...extra } };
    },
    call: (args: any) => {
      if (args.token === LIST_REDIS_KEYS_TOKEN) {
        listKeysCalls.push(args.inputs);
        return { primaryKey: PRIMARY_KEY, secondaryKey: 'RK-SECONDARY-KEY' };
      }
      return args.inputs;
    },
  });

  const { Redis }: typeof import('../../src/database/Redis') = require('../../src/database/Redis');
  const cache = new Redis('cache1', { ...baseArgs, ...extraArgs } as any);
  await pulumi.output(cache.id).promise();
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));

  const byType = (type: string) => captured.filter((c) => c.type === type);
  return { captured, listKeysCalls, byType };
}

describe('Redis — Key Vault secrets (DRK-1865)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    restoreStack(ORIGINAL_STACK);
  });

  test('R1 — key auth enabled: all 7 secrets are written to vault kv1 in one VaultSecrets, with host, port and key values', async () => {
    const { byType, listKeysCalls } = await deployAndSettle({ vaultInfo, disableAccessKeyAuthentication: false });

    expect(byType(VAULT_SECRETS_COMPONENT_TYPE)).toHaveLength(1);
    expect(listKeysCalls).toEqual([{ name: 'cache1', resourceGroupName: 'rg' }]);

    const secrets = byType(VAULT_SECRET_RESOURCE_TYPE);
    secrets.forEach((s) => expect(s.inputs.vaultName).toBe('kv1'));
    const values = Object.fromEntries(secrets.map((s) => [s.inputs.name, unwrap(s.inputs.value)]));
    expect(values).toEqual({
      'cache1-redis-host': 'cache1.redis.cache.windows.net',
      'cache1-redis-pass': 'RK-PRIMARY-KEY',
      'cache1-redis-port': '6380',
      'cache1-redis-conn-nodejs': 'rediss://:RK-PRIMARY-KEY@cache1.redis.cache.windows.net:6380',
      'cache1-redis-conn-dotnet':
        'cache1.redis.cache.windows.net:6380,password=RK-PRIMARY-KEY,ssl=True,abortConnect=False',
      'cache1-redis-conn-python': 'rediss://:RK-PRIMARY-KEY@cache1.redis.cache.windows.net:6380',
      'cache1-redis-conn': 'cache1.redis.cache.windows.net:6380,password=RK-PRIMARY-KEY,ssl=True,abortConnect=False',
    });
  });

  test('R2 — the access key and every connection string carrying it reach the vault inputs secret-marked, never plain', async () => {
    const { byType } = await deployAndSettle({ vaultInfo, disableAccessKeyAuthentication: false });

    const expectedSecret = {
      'cache1-redis-pass': asSecret('RK-PRIMARY-KEY'),
      'cache1-redis-conn-nodejs': asSecret('rediss://:RK-PRIMARY-KEY@cache1.redis.cache.windows.net:6380'),
      'cache1-redis-conn-dotnet': asSecret(
        'cache1.redis.cache.windows.net:6380,password=RK-PRIMARY-KEY,ssl=True,abortConnect=False',
      ),
      'cache1-redis-conn-python': asSecret('rediss://:RK-PRIMARY-KEY@cache1.redis.cache.windows.net:6380'),
      'cache1-redis-conn': asSecret(
        'cache1.redis.cache.windows.net:6380,password=RK-PRIMARY-KEY,ssl=True,abortConnect=False',
      ),
    };

    // VaultSecretResource inputs.
    const resourceValues = Object.fromEntries(
      byType(VAULT_SECRET_RESOURCE_TYPE).map((s) => [s.inputs.name, s.inputs.value]),
    );
    expect(resourceValues).toEqual(expect.objectContaining(expectedSecret));

    // VaultSecret component inputs (the component is named after the secret key).
    const componentValues = Object.fromEntries(
      byType(VAULT_SECRET_COMPONENT_TYPE).map((c) => [c.name, c.inputs.value]),
    );
    expect(componentValues).toEqual(expect.objectContaining(expectedSecret));
  });

  test('R3 — key auth disabled: exactly 6 secrets without -redis-pass, key-less connection strings, no listRedisKeys invoke', async () => {
    const { byType, listKeysCalls } = await deployAndSettle({ vaultInfo, disableAccessKeyAuthentication: true });

    expect(listKeysCalls).toHaveLength(0);
    expect(byType(VAULT_SECRETS_COMPONENT_TYPE)).toHaveLength(1);

    const secrets = byType(VAULT_SECRET_RESOURCE_TYPE);
    secrets.forEach((s) => expect(s.inputs.vaultName).toBe('kv1'));
    const values = Object.fromEntries(secrets.map((s) => [s.inputs.name, unwrap(s.inputs.value)]));
    expect(values).toEqual({
      'cache1-redis-host': 'cache1.redis.cache.windows.net',
      'cache1-redis-port': '6380',
      'cache1-redis-conn-nodejs': 'rediss://cache1.redis.cache.windows.net:6380',
      'cache1-redis-conn-dotnet': 'cache1.redis.cache.windows.net:6380,ssl=True,abortConnect=False',
      'cache1-redis-conn-python': 'rediss://cache1.redis.cache.windows.net:6380',
      'cache1-redis-conn': 'cache1.redis.cache.windows.net:6380,ssl=True,abortConnect=False',
    });
  });

  test('R5 — no vaultInfo: no vault secret is written and listRedisKeys is not invoked', async () => {
    const { byType, listKeysCalls } = await deployAndSettle({ disableAccessKeyAuthentication: false });

    expect(listKeysCalls).toHaveLength(0);
    expect(byType(VAULT_SECRETS_COMPONENT_TYPE)).toHaveLength(0);
    expect(byType(VAULT_SECRET_RESOURCE_TYPE)).toHaveLength(0);
  });
});
