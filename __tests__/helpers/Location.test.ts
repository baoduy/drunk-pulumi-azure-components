import { getCountryCode, getLocation, getRegionCode } from '../../src/helpers/Location';

/**
 * DRK-1988 acceptance tests: a region name that is not in the built-in list must never resolve
 * to a different region (it used to fall back to Southeast Asia / SG / southeastasia).
 *
 * Expected values are literals from the DRK-1991 brief §3 table (Microsoft Learn "List of Azure
 * regions", 2026-09-23) and §7 scenarios — never computed from the production list.
 */
describe('Location helpers — region lookup and unknown-name fallback', () => {
  test('S1 new region by programmatic name: italynorth resolves to itself', () => {
    expect(getRegionCode('italynorth')).toBe('italynorth');
  });

  test('S2 new region by display name: Italy North resolves to italynorth / IT / Italy North', () => {
    expect(getRegionCode('Italy North')).toBe('italynorth');
    expect(getCountryCode('Italy North')).toBe('IT');
    expect(getLocation('italynorth')).toBe('Italy North');
  });

  describe('S3 all 12 new regions resolve to their own code and country', () => {
    test.each([
      ['Austria East', 'austriaeast', 'AT'],
      ['Belgium Central', 'belgiumcentral', 'BE'],
      ['Chile Central', 'chilecentral', 'CL'],
      ['Denmark East', 'denmarkeast', 'DK'],
      ['India South Central', 'indiasouthcentral', 'IN'],
      ['Indonesia Central', 'indonesiacentral', 'ID'],
      ['Israel Central', 'israelcentral', 'IL'],
      ['Italy North', 'italynorth', 'IT'],
      ['Malaysia West', 'malaysiawest', 'MY'],
      ['Mexico Central', 'mexicocentral', 'MX'],
      ['New Zealand North', 'newzealandnorth', 'NZ'],
      ['Spain Central', 'spaincentral', 'ES'],
    ])('%s (%s) → region code %s, country %s', (displayName, name, countryCode) => {
      expect(getRegionCode(name)).toBe(name);
      expect(getRegionCode(displayName)).toBe(name);
      expect(getCountryCode(name)).toBe(countryCode);
      expect(getCountryCode(displayName)).toBe(countryCode);
    });
  });

  test('S4 unknown name falls back to itself, never to Southeast Asia', () => {
    expect(getRegionCode('Mars Central')).toBe('marscentral');
    expect(getCountryCode('Mars Central')).toBe('');
    expect(getLocation('Mars Central')).toBe('Mars Central');
  });

  test('E2 entries whose display name differs from their name keep their code', () => {
    expect(getRegionCode('United Kingdom')).toBe('uk');
    expect(getRegionCode('East US (Stage)')).toBe('eastusstage');
    expect(getRegionCode('UK South')).toBe('uksouth');
    expect(getCountryCode('uksouth')).toBe('GB');
  });
});

/**
 * `currentRegionCode` / `currentCountryCode` are computed once at module load from the
 * `azure-native:config:location` key inside PULUMI_CONFIG (src/helpers/azureEnv.ts), so each
 * scenario sets PULUMI_CONFIG and reloads the module fresh with jest.resetModules().
 */
describe('azureEnv — current region derived from the configured location', () => {
  const ORIGINAL_CONFIG = process.env.PULUMI_CONFIG;

  afterEach(() => {
    if (ORIGINAL_CONFIG === undefined) delete process.env.PULUMI_CONFIG;
    else process.env.PULUMI_CONFIG = ORIGINAL_CONFIG;
  });

  function loadAzureEnv(config: Record<string, string>) {
    process.env.PULUMI_CONFIG = JSON.stringify(config);
    jest.resetModules();
    return require('../../src/helpers/azureEnv') as typeof import('../../src/helpers/azureEnv');
  }

  test('S5 location italynorth → currentRegionCode italynorth, currentCountryCode IT', () => {
    const azureEnv = loadAzureEnv({ 'azure-native:config:location': 'italynorth' });
    expect(azureEnv.currentRegionCode).toBe('italynorth');
    expect(azureEnv.currentCountryCode).toBe('IT');
  });

  test('S6 unknown location Mars Central → currentRegionCode marscentral', () => {
    const azureEnv = loadAzureEnv({ 'azure-native:config:location': 'Mars Central' });
    expect(azureEnv.currentRegionCode).toBe('marscentral');
  });

  test('E1 no location configured → currentRegionCode southeastasia, currentCountryCode SG', () => {
    const azureEnv = loadAzureEnv({});
    expect(azureEnv.currentRegionCode).toBe('southeastasia');
    expect(azureEnv.currentCountryCode).toBe('SG');
  });
});
