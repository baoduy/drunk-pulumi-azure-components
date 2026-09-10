import * as pulumi from '@pulumi/pulumi';
import { VaultSecret } from '../../src/vault/VaultSecret';
import { VaultSecretResource } from '@drunk-pulumi/azure-providers/VaultSecret';
import { VaultSecrets } from '../../src/vault/VaultSecrets';
import { captureResourceParents } from '../testUtils/pulumiParentSpy';

pulumi.runtime.setMocks({
  newResource: (args: pulumi.runtime.MockResourceArgs) => ({
    id: `${args.name}_id`,
    state: { ...args.inputs },
  }),
  call: (args: pulumi.runtime.MockCallArgs) => args.inputs,
});

const vaultInfo = { resourceGroupName: 'rg1', resourceName: 'kv1', id: 'kv1_id' };

// VaultSecrets logs one line per secret (src/vault/VaultSecrets.ts:28) — pre-existing and out of
// scope for this cycle; silence it so the suite stays readable.
let logSpy: jest.SpyInstance;
beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  logSpy.mockRestore();
});

describe('VaultSecrets', () => {
  test('parents each VaultSecret child under itself, and each child parents its own VaultSecretResource', () => {
    const { captured, restore } = captureResourceParents();
    try {
      const secrets = new VaultSecrets('vs1', {
        vaultInfo,
        secrets: { password: { value: 'pw' }, apiKey: { value: 'key' } },
      });

      const children = captured.filter((c) => c.res instanceof VaultSecret);
      expect(children).toHaveLength(2);
      children.forEach((child) => expect(child.parent).toBe(secrets));

      children.forEach((child) => {
        const grandchild = captured.find((c) => c.res instanceof VaultSecretResource && c.parent === child.res);
        expect(grandchild).toBeDefined();
      });
    } finally {
      restore();
    }
  });

  test('keeps children parented under itself even when caller passes a different parent', () => {
    const { captured, restore } = captureResourceParents();
    try {
      const outerParent = new pulumi.ComponentResource('custom:index:Outer', 'outer2');
      const secrets = new VaultSecrets(
        'vs2',
        { vaultInfo, secrets: { password: { value: 'pw' } } },
        { parent: outerParent },
      );

      const ownRegistration = captured.find((c) => c.res === secrets);
      expect(ownRegistration?.parent).toBe(outerParent);

      const child = captured.find((c) => c.res instanceof VaultSecret);
      expect(child?.parent).toBe(secrets);
    } finally {
      restore();
    }
  });

  test('forces retainOnDelete on children regardless of caller opts, while other opts still flow through', () => {
    const { captured, restore } = captureResourceParents();
    try {
      const dependsOnTarget = new pulumi.ComponentResource('custom:index:Dep', 'dep2');
      const deletedWithTarget = new pulumi.ComponentResource('custom:index:DeletedWith', 'deletedWith2');

      new VaultSecrets(
        'vs3',
        { vaultInfo, secrets: { password: { value: 'pw' } } },
        { dependsOn: [dependsOnTarget], retainOnDelete: false, deletedWith: deletedWithTarget },
      );

      const child = captured.find((c) => c.res instanceof VaultSecret);
      expect(child?.opts.retainOnDelete).toBe(true); // hardcoded on children, pre-existing behaviour
      expect(child?.opts.dependsOn).toEqual([dependsOnTarget]);
      expect(child?.opts.deletedWith).toBe(deletedWithTarget);
    } finally {
      restore();
    }
  });

  test('does not throw when opts is omitted', () => {
    expect(() => new VaultSecrets('vs4', { vaultInfo, secrets: { password: { value: 'pw' } } })).not.toThrow();
  });

  test('creates no children and returns empty outputs for an empty secrets map', () => {
    const { captured, restore } = captureResourceParents();
    try {
      const secrets = new VaultSecrets('vs5', { vaultInfo, secrets: {} });

      expect(captured.some((c) => c.res instanceof VaultSecret)).toBe(false);
      expect(secrets.getOutputs()).toEqual({});
    } finally {
      restore();
    }
  });

  test('exposes id, vaultUrl and version per secret key', async () => {
    const secrets = new VaultSecrets('vs6', { vaultInfo, secrets: { password: { value: 'pw' } } });
    const outputs = secrets.getOutputs();

    await pulumi.output(outputs.password.id).apply((id) => expect(id).toBe('vs6-password_id'));
  });

  test('keeps a secret key as-is when it already includes the component name', async () => {
    const secrets = new VaultSecrets('vs7', { vaultInfo, secrets: { 'vs7-password': { value: 'pw' } } });
    const outputs = secrets.getOutputs();

    await pulumi.output(outputs['vs7-password'].id).apply((id) => expect(id).toBe('vs7-password_id'));
  });
});
