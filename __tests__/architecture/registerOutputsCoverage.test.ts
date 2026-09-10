import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * DRK-1047 / PULUMI-PKG-002 — every concrete component must register its outputs.
 *
 * A component whose constructor never calls `registerOutputs()` leaves the Pulumi
 * engine unaware the resource tree is complete, so its outputs never resolve for
 * consumers and `pulumi up` can hang waiting on children that already finished.
 * This is a repo-wide static check, not a per-component unit test, so it also
 * catches any *future* component that forgets the call.
 *
 * `KnownViolations` is the allow-list for files not yet compliant. It is empty:
 * this cycle (AppResources, CustomRoles, NetworkPeering) removed the last three.
 */
const KnownViolations: string[] = [];

const srcDir = path.resolve(__dirname, '../../src');

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && full.endsWith('.ts') ? [full] : [];
  });

// Concrete (non-abstract) classes only: BaseComponent/BaseResourceComponent are
// abstract bases that override `registerOutputs` for their subclasses to call —
// they never call it on themselves, by design.
const COMPONENT_CLASS = /^export\s+class\s+\w+.*extends\s+(pulumi\.)?(ComponentResource|Base\w*Component)\b/m;
const CALLS_REGISTER_OUTPUTS = /this\.registerOutputs\(/;

test('every component under src/ extending ComponentResource/Base*Component calls this.registerOutputs()', () => {
  const offenders = walk(srcDir)
    .filter((file) => COMPONENT_CLASS.test(fs.readFileSync(file, 'utf8')))
    .filter((file) => !CALLS_REGISTER_OUTPUTS.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(srcDir, file))
    .filter((file) => !KnownViolations.includes(file));

  expect(offenders).toEqual([]);
});

test('KnownViolations allow-list carries no entries (this cycle closed all prior gaps)', () => {
  expect(KnownViolations).toEqual([]);
});
