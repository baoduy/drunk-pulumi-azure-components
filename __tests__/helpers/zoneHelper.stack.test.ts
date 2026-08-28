/**
 * DRK-770 §5 @unit scenarios: "Zone defaulting yields three zones in production" /
 * "Zone defaulting yields no zones outside production".
 *
 * `isPrd` is derived once at module load from the Pulumi stack name (src/helpers/azureEnv.ts),
 * so each scenario forces the stack via PULUMI_NODEJS_STACK and reloads the module fresh
 * with jest.resetModules() — a plain re-import would keep replaying whichever stack name
 * happened to load first and could never fail when the prd/non-prd branch breaks.
 */
describe('zoneHelper.getDefaultZones — stack-driven defaulting', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;

  afterEach(() => {
    if (ORIGINAL_STACK === undefined) delete process.env.PULUMI_NODEJS_STACK;
    else process.env.PULUMI_NODEJS_STACK = ORIGINAL_STACK;
  });

  function loadZoneHelper(stackName: string) {
    process.env.PULUMI_NODEJS_STACK = stackName;
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../../src/helpers/zoneHelper') as typeof import('../../src/helpers/zoneHelper');
  }

  test('stack "prd" yields zones 1, 2 and 3 when no override is supplied', () => {
    const { getDefaultZones } = loadZoneHelper('prd');
    expect(getDefaultZones()).toEqual(['1', '2', '3']);
  });

  test('a non-prd stack yields no default zones when no override is supplied', () => {
    const { getDefaultZones } = loadZoneHelper('dev');
    expect(getDefaultZones()).toBeUndefined();
  });

  test('an explicit override always wins, in prd or out of it', () => {
    expect(loadZoneHelper('prd').getDefaultZones(['1']).toString()).toBe(['1'].toString());
    expect(loadZoneHelper('dev').getDefaultZones(['2']).toString()).toBe(['2'].toString());
  });
});
