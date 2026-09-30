import { restoreStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1814 / PULUMI-SEC-009: AzSearch.addSecretsToVault must store every query key of the search
 * service in Key Vault with the key (`QueryKeyResponse.key`) as the secret VALUE, named by index
 * (`<name>-query-key-<i>`), and the key must never appear in a secret name, a Pulumi resource
 * name, `contentType` or a log line.
 *
 * The vault write runs inside a fire-and-forget `.apply` that is not wired into any AzSearch
 * output, so each scenario awaits the service id and then lets the invoke's promise chain settle
 * before asserting. An error thrown inside that `.apply` surfaces as an unhandled rejection, which
 * jest reports as a failure of the running test — that is how "no error" is asserted.
 */

const SEARCH_QUERY_KEYS_TOKEN = 'azure-native:search:listQueryKeyBySearchService';
const VAULT_SECRET_RESOURCE_TYPE = 'drunk-pulumi:vault:VaultSecretResourceMock';

const QUERY_KEY_0 = { key: 'QK-SECRET-0', name: 'label-0' };
const QUERY_KEY_1 = { key: 'QK-SECRET-1', name: 'label-1' };
const MOCKED_KEY_VALUES = [QUERY_KEY_0.key, QUERY_KEY_1.key];

// Pulumi's wire envelope for a secret-marked value (pulumi.runtime.specialSigKey / specialSecretSig).
// The mock monitor hands secret inputs to `newResource` in this shape; a plain value arrives bare.
const SECRET_SIG_KEY = '4dabf18193072939515e22adb298388d';
const SECRET_SIG = '1b47061264138c4ac30d75fd1eb44270';
const asSecret = (value: string) => ({ [SECRET_SIG_KEY]: SECRET_SIG, value });

const vaultInfo = { resourceGroupName: 'rg-vault', resourceName: 'kv1', id: 'kv1_id' };
const baseArgs = { rsGroup: { resourceGroupName: 'rg' }, sku: 'basic' };

type Captured = { type: string; name: string; inputs: any };

/**
 * Reloads pulumi and AzSearch fresh on a fixed stack, with a mock whose query-key invoke returns
 * `queryKeys`. Returns the captured resources and the recorded query-key invokes.
 */
function loadAzSearch(queryKeys: { key: string; name: string }[]) {
  process.env.PULUMI_NODEJS_STACK = 'dev';
  jest.resetModules();
  const pulumi: typeof import('@pulumi/pulumi') = require('@pulumi/pulumi');

  const captured: Captured[] = [];
  const queryKeyCalls: any[] = [];
  pulumi.runtime.setMocks({
    newResource: (args: any) => {
      captured.push({ type: args.type, name: args.name, inputs: args.inputs });
      return { id: `${args.name}_id`, state: { ...args.inputs, name: args.name } };
    },
    call: (args: any) => {
      if (args.token === SEARCH_QUERY_KEYS_TOKEN) {
        queryKeyCalls.push(args.inputs);
        return { value: queryKeys };
      }
      return args.inputs;
    },
  });

  const { AzSearch }: typeof import('../../src/services/AzSearch') = require('../../src/services/AzSearch');
  return { pulumi, AzSearch, captured, queryKeyCalls };
}

async function deployAndSettle(queryKeys: { key: string; name: string }[], extraArgs: object = {}) {
  const env = loadAzSearch(queryKeys);
  const az = new env.AzSearch('az1', { ...baseArgs, ...extraArgs } as any);
  await env.pulumi.output(az.id).promise();
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));
  return env;
}

const vaultSecrets = (captured: Captured[]) => captured.filter((c) => c.type === VAULT_SECRET_RESOURCE_TYPE);

describe('AzSearch — query keys stored in Key Vault by index (PULUMI-SEC-009)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    restoreStack(ORIGINAL_STACK);
  });

  test('S1 — two query keys: each secret value is the query key value, secret-marked, never its label', async () => {
    const { captured } = await deployAndSettle([QUERY_KEY_0, QUERY_KEY_1], { vaultInfo });

    const secrets = vaultSecrets(captured).map((s) => ({ name: s.inputs.name, value: s.inputs.value }));
    expect(secrets).toHaveLength(2);
    expect(secrets).toEqual(
      expect.arrayContaining([
        { name: 'az1-query-key-0', value: asSecret('QK-SECRET-0') },
        { name: 'az1-query-key-1', value: asSecret('QK-SECRET-1') },
      ]),
    );
    secrets.forEach((s) => expect(['label-0', 'label-1']).not.toContain(s.value?.value));
  });

  test('S2 — no secret name, resource name, contentType or log line contains a query key value', async () => {
    const { captured } = await deployAndSettle([QUERY_KEY_0, QUERY_KEY_1], { vaultInfo });

    const secrets = vaultSecrets(captured);
    expect(secrets).toHaveLength(2);

    // Secret names are lower-cased by getSecretName, so every comparison is case-insensitive.
    const logged = logSpy.mock.calls.map((args) => args.map(String).join(' ').toLowerCase());
    for (const keyValue of MOCKED_KEY_VALUES.map((k) => k.toLowerCase())) {
      secrets.forEach((s) => {
        expect(String(s.inputs.name).toLowerCase()).not.toContain(keyValue);
        expect(String(s.inputs.contentType ?? '').toLowerCase()).not.toContain(keyValue);
      });
      captured.forEach((c) => expect(c.name.toLowerCase()).not.toContain(keyValue));
      logged.forEach((line) => expect(line).not.toContain(keyValue));
    }
  });

  test('S3 — one query key: exactly one secret-marked secret is created and nothing throws', async () => {
    const { captured } = await deployAndSettle([QUERY_KEY_0], { vaultInfo });

    const secrets = vaultSecrets(captured).map((s) => ({ name: s.inputs.name, value: s.inputs.value }));
    expect(secrets).toEqual([{ name: 'az1-query-key-0', value: asSecret('QK-SECRET-0') }]);
  });

  test('S4 — zero query keys: no secret is created and nothing throws', async () => {
    const { captured, queryKeyCalls } = await deployAndSettle([], { vaultInfo });

    expect(queryKeyCalls).toHaveLength(1);
    expect(vaultSecrets(captured)).toHaveLength(0);
  });

  test('S5a — disableLocalAuth: the query keys are not read and no secret is created', async () => {
    const { captured, queryKeyCalls } = await deployAndSettle([QUERY_KEY_0, QUERY_KEY_1], {
      vaultInfo,
      disableLocalAuth: true,
    });

    expect(queryKeyCalls).toHaveLength(0);
    expect(vaultSecrets(captured)).toHaveLength(0);
  });

  test('S5b — no vaultInfo: the query keys are not read and no secret is created', async () => {
    const { captured, queryKeyCalls } = await deployAndSettle([QUERY_KEY_0, QUERY_KEY_1]);

    expect(queryKeyCalls).toHaveLength(0);
    expect(vaultSecrets(captured)).toHaveLength(0);
  });
});
