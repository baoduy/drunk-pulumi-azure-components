import { asSecret, quietStackHooks, registrationOf, settle, withStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1864 additions: an absent `value` is never secret-marked. `pulumi.secret(undefined)` is a non-nullish
 * Output, so wrapping it would put a phantom value on the component registration and, on the way from
 * `VaultSecrets` to its child `VaultSecret`, kill the config fallback.
 */

const VAULT_SECRET_COMPONENT_TYPE = 'drunk:azure:VaultSecret';
const VAULT_SECRET_RESOURCE_TYPE = 'drunk-pulumi:vault:VaultSecretResourceMock';

const vaultInfo = { resourceGroupName: 'rg-vault', resourceName: 'kv1', id: 'kv1_id' };

/** Loads a fresh Pulumi runtime with the given stack config, recording every resource registration. */
function loadPulumi(config: Record<string, string>) {
  const { pulumi, captured } = withStack('dev', (pulumi) => {
    pulumi.runtime.setAllConfig(config, Object.keys(config));
    return { pulumi };
  });
  return { pulumi, registrations: captured };
}

describe('VaultSecret / VaultSecrets — absent value is not secret-marked (DRK-1864)', () => {
  quietStackHooks();

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
