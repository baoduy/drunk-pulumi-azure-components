import * as fs from 'node:fs';
import * as path from 'node:path';

import * as pulumi from '@pulumi/pulumi';

/**
 * Architecture tests for the review dimensions in `pulumi-azure-iac-standards`.
 *
 * These pin defaults and import hygiene that the components library already
 * satisfies today, so the suite fails the moment a change loosens one. They are
 * intentionally about the *default* path — the value a downstream stack inherits
 * when it passes no override — because that is what every consumer of this
 * published package gets without asking.
 */

const capturedInputs: Record<string, any>[] = [];

pulumi.runtime.setMocks({
  newResource: (args: pulumi.runtime.MockResourceArgs): { id: string; state: any } => {
    capturedInputs.push({ __type: args.type, ...args.inputs });
    return {
      id: `${args.name}_id`,
      state: { ...args.inputs, name: args.name, id: `${args.name}_id`, resourceName: args.name },
    };
  },
  call: (args: pulumi.runtime.MockCallArgs) => args.inputs,
});

const inputsForType = (type: string) => capturedInputs.filter((i) => i.__type === type);

describe('PULUMI-SEC-007 — Key Vault data-protection defaults', () => {
  test('a vault created with no `properties` override still gets RBAC auth, soft delete and purge protection', async () => {
    // Imported lazily so `setMocks` above is installed before the component runs.
    const { KeyVault } = await import('../../src/vault/KeyVault');

    new KeyVault('arch-vault-defaults', {
      rsGroup: { resourceGroupName: 'arch-rg' },
    } as any);

    await new Promise((resolve) => setTimeout(resolve, 0));

    const vaults = inputsForType('azure-native:keyvault:Vault');
    expect(vaults).toHaveLength(1);

    const properties = vaults[0].properties;
    // Why these three: a vault without RBAC authorization falls back to access
    // policies (no central role model), and a vault without soft delete +
    // purge protection can be destroyed irrecoverably along with every secret
    // in it. Downstream stacks that pass no `properties` inherit exactly this.
    expect(properties.enableRbacAuthorization).toBe(true);
    expect(properties.enableSoftDelete).toBe(true);
    expect(properties.enablePurgeProtection).toBe(true);
  });
});

describe('PULUMI-UP-003 — no dated azure-native API-version imports', () => {
  const srcDir = path.resolve(__dirname, '../../src');

  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.isFile() && full.endsWith('.ts') ? [full] : [];
    });

  test('no production source pins a dated `@pulumi/azure-native/**/vYYYYMMDD` module', () => {
    // A dated module freezes the resource at that API version, so every later
    // upstream hardening default silently stops reaching this package.
    const dated = /@pulumi\/azure-native\/[^'"`]*\/v\d{8}/;

    const offenders = walk(srcDir).filter((file) => dated.test(fs.readFileSync(file, 'utf8')));

    expect(offenders.map((f) => path.relative(srcDir, f))).toEqual([]);
  });
});
