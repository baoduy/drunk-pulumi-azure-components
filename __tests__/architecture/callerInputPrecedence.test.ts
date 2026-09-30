import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * PULUMI-ARGS-001 — a caller-supplied value must never be used as a truthiness gate.
 *
 * The shape `(callerValue ?? fallback) ? DEFAULT_A : DEFAULT_B` looks like "use the caller's
 * value, else pick a default", but `?:` binds looser than `??`, so the caller's value only
 * decides WHICH hard-coded default wins — the value itself is thrown away. A caller passing
 * `retentionDays: 90` gets 30; a caller passing `threatIntelMode: 'Alert'` gets `Deny`.
 * This repo already shipped and fixed this bug once (DRK-770, MySql/Postgres availabilityZone).
 *
 * Write `callerValue ?? (condition ? DEFAULT_A : DEFAULT_B)` instead. If the left operand
 * really is a boolean flag, say so explicitly with `Boolean(flag ?? fallback) ? A : B`.
 *
 * Tier 2 (baseline), produced by the architecture review DRK-1812. KNOWN_VIOLATIONS holds
 * today's offenders with their occurrence counts and MUST ONLY SHRINK: fixing a site lowers
 * its count, and the second test fails until the entry is lowered or deleted.
 */

const srcDir = path.resolve(__dirname, '../../src');

const KNOWN_VIOLATIONS: Record<string, number> = {
  // DRK-1812 [A1812-3] — vulnerabilityAssessment.retentionDays (alert policy + audit policy)
  'database/AzSql.ts': 2,
  // DRK-1812 [A1812-8] — policy dnsSettings, policy threatIntelMode, firewall threatIntelMode
  'vnet/Firewall.ts': 3,
};

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && full.endsWith('.ts') ? [full] : [];
  });

const relative = (file: string) => path.relative(srcDir, file).split(path.sep).join('/');

/** Blanks out comments (keeping offsets and line numbers) so commented-out code is not scanned. */
const stripComments = (text: string) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, (m, prefix: string) => prefix + ' '.repeat(m.length - prefix.length));

/** A `(` after one of these words is a grouping paren, not a call. */
const KEYWORDS_BEFORE_EXPRESSION = new Set(['return', 'await', 'typeof', 'void', 'case', 'yield', 'in', 'of', 'else']);

/**
 * Counts grouping parentheses whose top-level operator is `??` and which are immediately used
 * as a ternary condition. Call parentheses (`Boolean(...)`, `fn(...)`) are skipped on purpose:
 * that is the explicit escape hatch for genuine boolean flags.
 */
const countViolations = (source: string) => {
  const text = stripComments(source);
  let count = 0;

  for (let open = 0; open < text.length; open++) {
    if (text[open] !== '(') continue;

    let before = open - 1;
    while (before >= 0 && /\s/.test(text[before])) before--;
    const precedingWord = /[\w$]+$/.exec(text.slice(0, before + 1))?.[0];
    const isCallOrIndex = before >= 0 && /[\])]/.test(text[before]);
    if (isCallOrIndex || (precedingWord && !KEYWORDS_BEFORE_EXPRESSION.has(precedingWord))) continue;

    let depth = 0;
    let close = open;
    let nullishAtTop = false;
    for (; close < text.length; close++) {
      const ch = text[close];
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      else if (ch === ')' || ch === ']' || ch === '}') {
        depth--;
        if (depth === 0) break;
      } else if (depth === 1 && ch === '?' && text[close + 1] === '?') {
        nullishAtTop = true;
        close++;
      }
    }
    if (!nullishAtTop) continue;

    let after = close + 1;
    while (after < text.length && /\s/.test(text[after])) after++;
    if (text[after] === '?' && text[after + 1] !== '?' && text[after + 1] !== '.') count++;
  }

  return count;
};

const found: Record<string, number> = Object.fromEntries(
  walk(srcDir)
    .map((file) => [relative(file), countViolations(fs.readFileSync(file, 'utf8'))] as const)
    .filter(([, n]) => n > 0),
);

describe('PULUMI-ARGS-001 — caller values are not used as truthiness gates', () => {
  test('the detector recognises the bug shape and ignores the fixed shape and the escape hatch', () => {
    expect(countViolations('const a = (x.days ?? isPrd) ? 30 : 7;')).toBe(1);
    expect(countViolations('const a = (\n  x.days ?? isPrd\n)\n  ? 30\n  : 7;')).toBe(1);
    expect(countViolations('return (x.days ?? isPrd) ? 30 : 7;')).toBe(1);
    expect(countViolations('const a = x.days ?? (isPrd ? 30 : 7);')).toBe(0);
    expect(countViolations('const a = Boolean(flag ?? isPrd) ? 30 : 7;')).toBe(0);
    expect(countViolations('// const a = (x.days ?? isPrd) ? 30 : 7;')).toBe(0);
  });

  test('no file outside the allow-list, and no allow-listed file above its count, uses `(value ?? x) ? a : b`', () => {
    const unexpected = Object.entries(found)
      .filter(([file, n]) => n > (KNOWN_VIOLATIONS[file] ?? 0))
      .map(([file, n]) => `${file} (${n})`);

    expect(
      unexpected.length === 0
        ? []
        : [
            'These files use `(callerValue ?? fallback) ? A : B`, which discards the caller value and only ' +
              'uses it to choose between two hard-coded defaults. Write `callerValue ?? (fallback ? A : B)`; ' +
              `for a real boolean flag write \`Boolean(flag ?? fallback) ? A : B\`. Offenders: ${unexpected.join(', ')}`,
          ],
    ).toEqual([]);
  });

  test('the allow-list only shrinks — every entry still has exactly its recorded count', () => {
    const stale = Object.entries(KNOWN_VIOLATIONS)
      .filter(([file, n]) => (found[file] ?? 0) < n)
      .map(([file, n]) => `${file} (listed ${n}, found ${found[file] ?? 0})`);

    expect(
      stale.length === 0
        ? []
        : [
            'These KNOWN_VIOLATIONS entries are higher than what the code still contains. Lower or delete ' +
              `them so the baseline keeps shrinking rather than rotting. Stale: ${stale.join(', ')}`,
          ],
    ).toEqual([]);
  });
});
