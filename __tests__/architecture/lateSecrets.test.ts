import { restoreStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1865 / R4 — a secret added after `registerOutputs()` must fail loudly.
 *
 * `BaseResourceComponent.registerOutputs()` flushes the collected secrets to Key Vault once. A secret
 * added after that flush used to be dropped silently (the Redis defect). Once `registerOutputs()`
 * has run, `addSecret` / `addSecrets` must throw an Error naming the component (`<type>:<name>`)
 * and the secret key(s). A secret added before `registerOutputs()` still reaches the vault.
 */

const VAULT_SECRET_RESOURCE_TYPE = 'drunk-pulumi:vault:VaultSecretResourceMock';
const vaultInfo = { resourceGroupName: 'rg-vault', resourceName: 'kv1', id: 'kv1_id' };

type Captured = { type: string; name: string; inputs: any };

/**
 * Reloads pulumi and BaseResourceComponent fresh, then defines a minimal test component that adds
 * `early-key` in its constructor before `registerOutputs()` and exposes the protected add methods.
 */
function loadLateSecretComponent() {
  process.env.PULUMI_NODEJS_STACK = 'dev';
  jest.resetModules();
  const pulumi: typeof import('@pulumi/pulumi') = require('@pulumi/pulumi');

  const captured: Captured[] = [];
  pulumi.runtime.setMocks({
    newResource: (args: any) => {
      captured.push({ type: args.type, name: args.name, inputs: args.inputs });
      return { id: `${args.name}_id`, state: { ...args.inputs, name: args.name } };
    },
    call: (args: any) => args.inputs,
  });

  const { BaseResourceComponent }: typeof import('../../src/base') = require('../../src/base');

  class LateSecret extends BaseResourceComponent<any> {
    constructor(name: string, args: any) {
      super('LateSecret', name, args);
      this.addSecret(`${name}-early-key`, 'early-value');
      this.registerOutputs();
    }

    public addSecretNow(name: string, value: string) {
      this.addSecret(name, value);
    }

    public addSecretsNow(secrets: { [key: string]: string }) {
      this.addSecrets(secrets);
    }
  }

  return { pulumi, LateSecret, captured };
}

async function settle() {
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));
}

describe('BaseResourceComponent — late secrets fail loudly (DRK-1865 R4)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    restoreStack(ORIGINAL_STACK);
  });

  test('R4 — a secret added before registerOutputs() does not throw and reaches the vault', async () => {
    const { LateSecret, captured } = loadLateSecretComponent();

    expect(() => new LateSecret('late1', { vaultInfo })).not.toThrow();
    await settle();

    const names = captured.filter((c) => c.type === VAULT_SECRET_RESOURCE_TYPE).map((c) => c.inputs.name);
    expect(names).toEqual(['late1-early-key']);
  });

  test('R4 — addSecret after registerOutputs() throws an Error naming the component and the key', async () => {
    const { LateSecret } = loadLateSecretComponent();
    const component = new LateSecret('late1', { vaultInfo });
    await settle();

    let error: unknown;
    try {
      component.addSecretNow('late1-late-key', 'late-value');
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('LateSecret:late1');
    expect((error as Error).message).toContain('late1-late-key');
  });

  test('R4 — addSecrets after registerOutputs() throws an Error naming the component and every key', async () => {
    const { LateSecret } = loadLateSecretComponent();
    const component = new LateSecret('late1', { vaultInfo });
    await settle();

    let error: unknown;
    try {
      component.addSecretsNow({ 'late1-late-a': 'a', 'late1-late-b': 'b' });
    } catch (e) {
      error = e;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('LateSecret:late1');
    expect((error as Error).message).toContain('late1-late-a');
    expect((error as Error).message).toContain('late1-late-b');
  });
});
