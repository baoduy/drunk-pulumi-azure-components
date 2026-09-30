import { withStack, restoreStack } from '../testUtils/pulumiMocks';

// DRK-1822 Section A: in PRD, APIM gets the default zones ['1','2','3'] only on the tiers Azure
// supports zones on (Premium, Standard v2, Premium v2 — Microsoft Learn, "Enable availability zones
// for API Management", 2026-09-16). Other tiers get the caller's zones verbatim, or none; Basic
// and Consumption never get zones.
// The SDK enum has no V2 names, so V2 tiers are passed as strings, the way callers do.

const APIM_TYPE = 'azure-native:apimanagement:ApiManagementService';

async function sentZones(stackName: string, skuName: string, zones?: string[]) {
  const { pulumi, service, captured } = withStack(stackName, (p) => {
    const mod: typeof import('../../src/apim/Apim') = require('../../src/apim/Apim');
    const service = new mod.Apim('apim1', {
      rsGroup: { resourceGroupName: 'rg', location: 'southeastasia' },
      sku: { name: skuName as any, capacity: 1 },
      publisherName: 'drunk',
      disableSignIn: true,
      zones,
    });
    return { pulumi: p, service };
  });
  await pulumi.output(service.id).promise();
  return captured.find((c) => c.type === APIM_TYPE)!.inputs.zones;
}

describe('Apim — zone defaults only on zone-capable tiers (DRK-1822 S1-S3)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  // S1 (R1): tiers without zone support get no zones in PRD.
  test.each(['Developer', 'Standard', 'Isolated', 'BasicV2'])(
    'S1: prd %s with no caller zones sends no zones',
    async (skuName) => {
      expect(await sentZones('prd', skuName)).toBeUndefined();
    },
  );

  // S2 (R2): zone-capable tiers keep the three default zones in PRD.
  test.each(['Premium', 'StandardV2', 'PremiumV2'])(
    'S2: prd %s with no caller zones sends zones 1, 2 and 3',
    async (skuName) => {
      expect(await sentZones('prd', skuName)).toEqual(['1', '2', '3']);
    },
  );

  test('S2: dev Premium with no caller zones sends no zones', async () => {
    expect(await sentZones('dev', 'Premium')).toBeUndefined();
  });

  // S3 (R3): caller zones are sent verbatim, except on Basic/Consumption which stay without zones.
  test("S3: prd Developer with caller zones ['1'] sends ['1']", async () => {
    expect(await sentZones('prd', 'Developer', ['1'])).toEqual(['1']);
  });

  test("S3: prd Consumption with caller zones ['1'] sends no zones", async () => {
    expect(await sentZones('prd', 'Consumption', ['1'])).toBeUndefined();
  });
});
