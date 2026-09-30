import { restoreStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1864 additions: an absent `value` is never secret-marked. `pulumi.secret(undefined)` is a non-nullish
 * Output, so wrapping it would put a phantom value on the component registration and, on the way from
 * `VaultSecrets` to its child `VaultSecret`, kill the config fallback.
 */

const VAULT_SECRET_COMPONENT_TYPE = 'drunk:azure:VaultSecret';
const VAULT_SECRET_RESOURCE_TYPE = 'drunk-pulumi:vault:VaultSecretResourceMock';

const asSecret = (value: unknown) => ({
  '4dabf18193072939515e22adb298388d': '1b47061264138c4ac30d75fd1eb44270',
  value,
});

const vaultInfo = { resourceGroupName: 'rg-vault', resourceName: 'kv1', id: 'kv1_id' };

type Registration = { type: string; name: string; inputs: any };

/** Loads a fresh Pulumi runtime with the given stack config, recording every resource registration. */
function loadPulumi(config: Record<string, string>) {
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
  pulumi.runtime.setAllConfig(config, Object.keys(config));
  return { pulumi, registrations };
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

describe('VaultSecret / VaultSecrets — absent value is not secret-marked (DRK-1864)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    restoreStack(ORIGINAL_STACK);
  });

  test('VaultSecret with no value registers no value input on the component', async () => {
    const { pulumi, registrations } = loadPulumi({ 'project:vsa1': 'CFG-VSA1-SECRET' });
    try {
      const { VaultSecret }: typeof import('../../src/vault/VaultSecret') = require('../../src/vault/VaultSecret');
      const secret = new VaultSecret('vsa1', { vaultInfo, contentType: 'VSA1 type' });
      await settle(pulumi, secret.id);

      const inputs = registrationOf(registrations, VAULT_SECRET_COMPONENT_TYPE, 'vsa1');
      expect(inputs).not.toHaveProperty('value');
      expect(inputs.contentType).toBe('VSA1 type');
    } finally {
      pulumi.runtime.setAllConfig({}, []);
    }
  }, 30000);

  test('VaultSecrets item with no value reaches the leaf as the config secret for the child name', async () => {
    const { pulumi, registrations } = loadPulumi({ 'project:vsf1-alpha': 'CFG-VSF1-ALPHA' });
    try {
      const { VaultSecrets }: typeof import('../../src/vault/VaultSecrets') = require('../../src/vault/VaultSecrets');
      const secrets = new VaultSecrets('vsf1', { vaultInfo, secrets: { alpha: { contentType: 'VSF1 type' } } });
      await settle(pulumi, secrets.getOutputs().alpha.id);

      const leaf = registrationOf(registrations, VAULT_SECRET_RESOURCE_TYPE, 'vsf1-alpha');
      expect(leaf.value).toEqual(asSecret('CFG-VSF1-ALPHA'));
      expect(leaf.contentType).toBe('VSF1 type');
    } finally {
      pulumi.runtime.setAllConfig({}, []);
    }
  }, 30000);
});
