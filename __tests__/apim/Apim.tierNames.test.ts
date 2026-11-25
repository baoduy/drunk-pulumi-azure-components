import * as path from 'path';
import * as ts from 'typescript';

/**
 * DRK-2592 compile-time acceptance tests. `tsconfig.test.json` sets `isolatedModules`, so ts-jest only transpiles
 * and never type-checks: these scenarios run the TypeScript compiler over small package-consumer files instead,
 * importing the package entry (`src/index.ts`) with the compiler options of the package build (`tsconfig.json`).
 */

const ROOT = path.resolve(__dirname, '../..');
const CONSUMER_DIR = path.join(ROOT, '__tests__', 'apim', '__consumer__').split(path.sep).join('/');

const RS_GROUP_LINE = "  rsGroup: { resourceGroupName: 'payments-rg', location: 'southeastasia' },";

/** Team "payments" creates APIM "pay-apim" on tier `tier` with capacity 1. */
const apimOnTier = (tier: string) =>
  [
    "import { Apim } from '../../../src';",
    "new Apim('pay-apim', {",
    RS_GROUP_LINE,
    "  publisherName: 'payments',",
    '  disableSignIn: true,',
    '  sku: {',
    '    capacity: 1,',
    `    name: '${tier}',`,
    '  },',
    '});',
  ].join('\n');

/** Team "payments" creates APIM "pay-apim" with no SKU. */
const apimWithNoSku = [
  "import { Apim } from '../../../src';",
  "new Apim('pay-apim', {",
  RS_GROUP_LINE,
  "  publisherName: 'payments',",
  '  disableSignIn: true,',
  '});',
].join('\n');

/** Team "payments" creates the app-resources bundle "pay" with an APIM block and no SKU. */
const bundleWithNoSku = [
  "import { AppResources } from '../../../src';",
  "new AppResources('pay', {",
  RS_GROUP_LINE,
  "  apim: { publisherName: 'payments', disableSignIn: true },",
  '});',
].join('\n');

const SUPPORTED_TIERS = [
  'Consumption',
  'Developer',
  'Basic',
  'Standard',
  'Premium',
  'Isolated',
  'BasicV2',
  'StandardV2',
  'PremiumV2',
];

const consumers = new Map<string, string>([
  ...SUPPORTED_TIERS.map((tier): [string, string] => [`${CONSUMER_DIR}/apim-${tier}.ts`, apimOnTier(tier)]),
  [`${CONSUMER_DIR}/apim-Foo.ts`, apimOnTier('Foo')],
  [`${CONSUMER_DIR}/apim-no-sku.ts`, apimWithNoSku],
  [`${CONSUMER_DIR}/bundle-no-sku.ts`, bundleWithNoSku],
]);

/** One program over every consumer file: the package's own compiler options, the consumer files kept in memory. */
function compileConsumers(): ts.Program {
  const config = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT);
  const compilerOptions: ts.CompilerOptions = { ...options, noEmit: true, declaration: false, rootDir: undefined };

  const host = ts.createCompilerHost(compilerOptions, true);
  const { fileExists, readFile, getSourceFile } = host;
  host.fileExists = (file) => consumers.has(file) || fileExists(file);
  host.readFile = (file) => consumers.get(file) ?? readFile(file);
  host.getSourceFile = (file, languageVersion, ...rest) => {
    const text = consumers.get(file);
    return text === undefined
      ? getSourceFile(file, languageVersion, ...rest)
      : ts.createSourceFile(file, text, languageVersion);
  };
  return ts.createProgram([...consumers.keys()], compilerOptions, host);
}

let program: ts.Program;

/** The compiler's type errors for one consumer file, as `line <n>: <message>`. */
function typeErrors(file: string): string[] {
  const source = program.getSourceFile(file)!;
  return [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)].map((d) => {
    const { line } = source.getLineAndCharacterOfPosition(d.start!);
    return `line ${line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`;
  });
}

describe('APIM tier names and optional SKU at compile time (DRK-2592)', () => {
  beforeAll(() => {
    program = compileConsumers();
  }, 120000);

  // Scenario Outline: Every supported tier name is accepted with no cast
  test.each(SUPPORTED_TIERS)('Every supported tier name is accepted with no cast — %s', (tier) => {
    expect(typeErrors(`${CONSUMER_DIR}/apim-${tier}.ts`)).toEqual([]);
  });

  // Scenario: An unknown tier name is refused at compile time
  test('An unknown tier name is refused at compile time — Foo', () => {
    const errors = typeErrors(`${CONSUMER_DIR}/apim-Foo.ts`);
    // Line 8 of the consumer file is `    name: 'Foo',` — every error, and at least one, is on the tier name.
    expect(errors.length).toBeGreaterThanOrEqual(1);
    for (const error of errors) expect(error).toMatch(/^line 8: Type '"Foo"' is not assignable to type /);
  });

  // Compile half of "APIM with no SKU uses Consumption with capacity 0": the call with no SKU compiles.
  test('APIM with no SKU compiles', () => {
    expect(typeErrors(`${CONSUMER_DIR}/apim-no-sku.ts`)).toEqual([]);
  });

  // Compile half of "The app-resources bundle creates APIM with no SKU": the APIM block with no SKU compiles.
  test('The app-resources bundle with an APIM block and no SKU compiles', () => {
    expect(typeErrors(`${CONSUMER_DIR}/bundle-no-sku.ts`)).toEqual([]);
  });
});
