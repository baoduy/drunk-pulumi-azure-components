import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Architecture tests for the component contract this repo documents in CLAUDE.md:
 *
 *   "every public component extends `pulumi.ComponentResource`, accepts a typed
 *    `Args` interface, registers child resources with `{ parent: this }`, and calls
 *    `this.registerOutputs(...)` at the end of the constructor."
 *
 * Produced by the monthly architecture review (DRK-1037). Source-scanning only —
 * nothing here constructs Pulumi resources.
 */

const srcDir = path.resolve(__dirname, '../../src');

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && full.endsWith('.ts') ? [full] : [];
  });

const relative = (file: string) => path.relative(srcDir, file).split(path.sep).join('/');

/** Turns a list of offenders into a self-explaining failure payload. */
const explain = (offenders: string[], why: string) =>
  offenders.length === 0 ? [] : [`${why} Offenders: ${offenders.join(', ')}`];

describe('PULUMI-PKG-002 — every component registers its outputs', () => {
  /**
   * Tier 2 (baseline). `getOutputs()` is abstract on `BaseComponent`, so a component
   * that never calls `this.registerOutputs()` computes its outputs and throws them
   * away: the engine never receives them, they are absent from state and from
   * `pulumi stack graph`, and the component has no explicit completion marker.
   *
   * KNOWN_VIOLATIONS is today's offenders and MUST ONLY SHRINK. Fixing a component
   * deletes its entry; the second assertion below enforces that.
   */
  const KNOWN_VIOLATIONS = [
    // DRK-1047 [A1037-10]
    'AppResources.ts',
    'azAd/CustomRoles.ts',
    'vnet/NetworkPeering.ts',
  ];

  const isComponent = /extends\s+(?:pulumi\.)?ComponentResource\b|extends\s+Base[A-Za-z]*Component\b/;

  const offenders = walk(srcDir)
    .filter((file) => {
      const text = fs.readFileSync(file, 'utf8');
      return isComponent.test(text) && !text.includes('registerOutputs');
    })
    .map(relative)
    .sort();

  test('no component class outside the allow-list skips registerOutputs()', () => {
    const unexpected = offenders.filter((f) => !KNOWN_VIOLATIONS.includes(f));

    expect(
      explain(
        unexpected,
        'These components never call `this.registerOutputs()`, so their outputs are ' +
          'computed and then discarded — the Pulumi engine never receives them and they ' +
          'are missing from state. Add the call as the last statement of the constructor.',
      ),
    ).toEqual([]);
  });

  test('the allow-list only shrinks — nothing on it still passes', () => {
    const fixed = KNOWN_VIOLATIONS.filter((f) => !offenders.includes(f));

    expect(
      explain(
        fixed,
        'These files are on KNOWN_VIOLATIONS but no longer violate the rule. Delete ' +
          'them from the list so the baseline keeps shrinking rather than rotting.',
      ),
    ).toEqual([]);
  });
});
