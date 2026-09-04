import * as pulumi from '@pulumi/pulumi';
import { VaultSecret } from '../../src/vault/VaultSecret';
import { VaultSecretResource } from '@drunk-pulumi/azure-providers/VaultSecret';
import { captureResourceParents } from '../testUtils/pulumiParentSpy';

pulumi.runtime.setMocks({
  newResource: (args: pulumi.runtime.MockResourceArgs) => ({
    id: `${args.name}_id`,
    state: { ...args.inputs },
  }),
  call: (args: pulumi.runtime.MockCallArgs) => args.inputs,
});

const vaultInfo = { resourceGroupName: 'rg1', resourceName: 'kv1', id: 'kv1_id' };

describe('VaultSecret', () => {
  test('parents its VaultSecretResource under itself', () => {
    const { captured, restore } = captureResourceParents();
    try {
      const secret = new VaultSecret('sec1', { vaultInfo, value: 'abc' });

      const child = captured.find((c) => c.res instanceof VaultSecretResource);
      expect(child?.parent).toBe(secret);
    } finally {
      restore();
    }
  });

  test('keeps VaultSecretResource parented under itself even when caller passes a different parent', () => {
    const { captured, restore } = captureResourceParents();
    try {
      const outerParent = new pulumi.ComponentResource('custom:index:Outer', 'outer1');
      const secret = new VaultSecret('sec2', { vaultInfo, value: 'abc' }, { parent: outerParent });

      // VaultSecret itself still honours the caller's parent...
      const ownRegistration = captured.find((c) => c.res === secret);
      expect(ownRegistration?.parent).toBe(outerParent);

      // ...but its internal VaultSecretResource never leaks up to that same parent.
      const child = captured.find((c) => c.res instanceof VaultSecretResource);
      expect(child?.parent).toBe(secret);
    } finally {
      restore();
    }
  });

  test('flows non-parent opts through to VaultSecretResource unchanged', () => {
    const { captured, restore } = captureResourceParents();
    try {
      const dependsOnTarget = new pulumi.ComponentResource('custom:index:Dep', 'dep1');
      const deletedWithTarget = new pulumi.ComponentResource('custom:index:DeletedWith', 'deletedWith1');

      new VaultSecret(
        'sec3',
        { vaultInfo, value: 'abc' },
        { dependsOn: [dependsOnTarget], retainOnDelete: true, deletedWith: deletedWithTarget },
      );

      const child = captured.find((c) => c.res instanceof VaultSecretResource);
      expect(child?.opts.dependsOn).toEqual([dependsOnTarget]);
      expect(child?.opts.retainOnDelete).toBe(true);
      expect(child?.opts.deletedWith).toBe(deletedWithTarget);
    } finally {
      restore();
    }
  });

  test('does not throw when opts is omitted', () => {
    expect(() => new VaultSecret('sec4', { vaultInfo, value: 'abc' })).not.toThrow();
  });

  test('exposes id, vaultUrl and version from the underlying secret', async () => {
    const secret = new VaultSecret('sec5', { vaultInfo, value: 'abc', contentType: 'text/plain' });
    const outputs = secret.getOutputs();

    await pulumi.output(outputs.id).apply((id) => expect(id).toBe('sec5_id'));
    expect(outputs.vaultUrl).toBe(secret.vaultUrl);
    expect(outputs.version).toBe(secret.version);
  });

  test('falls back to an empty secret value when neither a value nor stack config is provided', async () => {
    const { captured, restore } = captureResourceParents();
    try {
      new VaultSecret('sec6', { vaultInfo });

      const child = captured.find((c) => c.res instanceof VaultSecretResource);
      await pulumi.output(child?.props.value).apply((value) => expect(value).toBe(''));
    } finally {
      restore();
    }
  });
});
