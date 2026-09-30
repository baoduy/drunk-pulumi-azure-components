import { restoreStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1864 acceptance tests S1–S5: a secret `value` handed to `VaultSecret` / `VaultSecrets` must reach the
 * Pulumi engine secret-marked in the component registrations themselves (`drunk:azure:VaultSecret`,
 * `drunk:azure:VaultSecrets`), not only at the Key Vault leaf. Assertions read the `newResource` inputs by
 * component type, never the leaf mock (it does not wrap `value`), except S5, which is about the leaf value.
 */

const VAULT_SECRET_COMPONENT_TYPE = 'drunk:azure:VaultSecret';
const VAULT_SECRETS_COMPONENT_TYPE = 'drunk:azure:VaultSecrets';
const VAULT_SECRET_RESOURCE_TYPE = 'drunk-pulumi:vault:VaultSecretResourceMock';

// Pulumi's wire envelope for a secret-marked value; a plain value would arrive as the bare string.
const asSecret = (value: unknown) => ({
  '4dabf18193072939515e22adb298388d': '1b47061264138c4ac30d75fd1eb44270',
  value,
});

const vaultInfo = { resourceGroupName: 'rg-vault', resourceName: 'kv1', id: 'kv1_id' };

type Registration = { type: string; name: string; inputs: any };
type VaultModules = {
  pulumi: typeof import('@pulumi/pulumi');
  VaultSecret: typeof import('../../src/vault/VaultSecret').VaultSecret;
  VaultSecrets: typeof import('../../src/vault/VaultSecrets').VaultSecrets;
};

/** Loads a fresh Pulumi runtime and the vault components, recording every resource registration. */
function loadVault(config?: Record<string, string>) {
  process.env.PULUMI_NODEJS_STACK = 'dev';
  jest.resetModules();
  const pulumi: typeof import('@pulumi/pulumi') = require('@pulumi/pulumi');

  const registrations: Registration[] = [];
  pulumi.runtime.setMocks({
    newResource: (args: any) => {
      registrations.push({ type: args.type, name: args.name, inputs: args.inputs });
      return { id: `${args.name}_id`, state: { ...args.inputs } };
    },
    call: (args: any) => args.inputs,
  });
  if (config) pulumi.runtime.setAllConfig(config, Object.keys(config));

  const modules: VaultModules = {
    pulumi,
    VaultSecret: require('../../src/vault/VaultSecret').VaultSecret,
    VaultSecrets: require('../../src/vault/VaultSecrets').VaultSecrets,
  };
  return { ...modules, registrations };
}

async function settle(pulumi: typeof import('@pulumi/pulumi'), id: import('@pulumi/pulumi').Output<string>) {
  await pulumi.output(id).promise();
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));
}

function registrationOf(registrations: Registration[], type: string, name: string) {
  const found = registrations.filter((r) => r.type === type && r.name === name);
  expect(found).toHaveLength(1);
  return found[0].inputs;
}

describe('VaultSecret / VaultSecrets — secret marking of component inputs (DRK-1864)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    restoreStack(ORIGINAL_STACK);
  });

  test('S1 — VaultSecret with a plain value registers the value secret-marked', async () => {
    const { pulumi, VaultSecret, registrations } = loadVault();

    const secret = new VaultSecret('vs-s1', { vaultInfo, value: 'VS-S1-PLAIN' });
    await settle(pulumi, secret.id);

    expect(registrationOf(registrations, VAULT_SECRET_COMPONENT_TYPE, 'vs-s1').value).toEqual(asSecret('VS-S1-PLAIN'));
  }, 30000);

  test('S2 — VaultSecrets with two plain values registers the secrets map and each child value secret-marked', async () => {
    const { pulumi, VaultSecrets, registrations } = loadVault();

    const secrets = new VaultSecrets('vs-s2', {
      vaultInfo,
      secrets: { alpha: { value: 'VS-S2-ALPHA' }, beta: { value: 'VS-S2-BETA' } },
    });
    await settle(pulumi, secrets.getOutputs().beta.id);

    expect(registrationOf(registrations, VAULT_SECRETS_COMPONENT_TYPE, 'vs-s2').secrets).toEqual(
      asSecret({ alpha: { value: 'VS-S2-ALPHA' }, beta: { value: 'VS-S2-BETA' } }),
    );
    expect(registrationOf(registrations, VAULT_SECRET_COMPONENT_TYPE, 'vs-s2-alpha').value).toEqual(
      asSecret('VS-S2-ALPHA'),
    );
    expect(registrationOf(registrations, VAULT_SECRET_COMPONENT_TYPE, 'vs-s2-beta').value).toEqual(
      asSecret('VS-S2-BETA'),
    );
  }, 30000);

  test('S3 — VaultSecret with a plain value and a contentType marks only the value; contentType and tags stay plain', async () => {
    const { pulumi, VaultSecret, registrations } = loadVault();

    const secret = new VaultSecret('vs-s3', {
      vaultInfo,
      value: 'VS-S3-PLAIN',
      contentType: 'VS-S3 content type',
      tags: { scenario: 'vs-s3' },
    });
    await settle(pulumi, secret.id);

    const inputs = registrationOf(registrations, VAULT_SECRET_COMPONENT_TYPE, 'vs-s3');
    expect(inputs.value).toEqual(asSecret('VS-S3-PLAIN'));
    expect(inputs.contentType).toBe('VS-S3 content type');
    expect(inputs.tags).toEqual({ scenario: 'vs-s3' });
  }, 30000);

  test('S4 — VaultSecret with an already-secret value registers a single envelope with the same literal', async () => {
    const { pulumi, VaultSecret, registrations } = loadVault();

    const secret = new VaultSecret('vs-s4', { vaultInfo, value: pulumi.secret('VS-S4-SECRET') });
    await settle(pulumi, secret.id);

    expect(registrationOf(registrations, VAULT_SECRET_COMPONENT_TYPE, 'vs-s4').value).toEqual(asSecret('VS-S4-SECRET'));
  }, 30000);

  test('S5 — VaultSecret with no value falls back to the config secret for its name', async () => {
    const { pulumi, VaultSecret, registrations } = loadVault({ 'project:vs-s5': 'CFG-VS-S5-SECRET' });

    try {
      let secret: InstanceType<typeof VaultSecret> | undefined;
      expect(() => {
        secret = new VaultSecret('vs-s5', { vaultInfo });
      }).not.toThrow();
      await settle(pulumi, secret!.id);

      expect(registrationOf(registrations, VAULT_SECRET_RESOURCE_TYPE, 'vs-s5').value).toEqual(
        asSecret('CFG-VS-S5-SECRET'),
      );
    } finally {
      pulumi.runtime.setAllConfig({}, []);
    }
  }, 30000);
});
