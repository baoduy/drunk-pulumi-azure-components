import * as pulumi from '@pulumi/pulumi';

/**
 * Jest manual mock for `@drunk-pulumi/azure-providers/VaultSecret` (auto-applied to every test —
 * see https://jestjs.io/docs/manual-mocks#mocking-node-modules — no `jest.mock(...)` call needed).
 *
 * The real `VaultSecretResource` is a `pulumi.dynamic.Resource`: its constructor serializes its
 * whole provider object (which pulls in the Azure Key Vault SDK) as a V8 closure so the engine can
 * replay CRUD calls out-of-process. That closure-serialization path is unrelated to anything this
 * repo's `VaultSecret`/`VaultSecrets` components own, makes real network-bound Azure calls, and is
 * exactly the kind of side-effecting boundary `test-driven-development` says to mock rather than
 * exercise for real. This stand-in keeps the same public shape (constructor signature, `id` /
 * `vaultUrl` / `version` outputs) as a plain `CustomResource`, so `src/vault/VaultSecret.ts` and
 * `VaultSecrets.ts` — the actual classes under test — run completely unmodified against it.
 */
export class VaultSecretResource extends pulumi.CustomResource {
  public readonly vaultUrl!: pulumi.Output<string>;
  public readonly version!: pulumi.Output<string>;

  constructor(name: string, args: Record<string, unknown>, opts?: pulumi.CustomResourceOptions) {
    super('drunk-pulumi:vault:VaultSecretResourceMock', name, { vaultUrl: undefined, version: undefined, ...args }, opts);
  }
}
