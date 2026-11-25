import type { ApimArgs } from '../../src/apim/Apim';
import { withStack, restoreStack, settle, registrationOf, dropExitListenerHooks } from '../testUtils/pulumiMocks';

/**
 * DRK-2592 acceptance tests — "APIM falls back to Consumption and accepts the v2 tiers".
 * One test (or one row of an outline) per scenario of the spec's §5 Gherkin; expected values are the spec's literals.
 * Each preview drives the real `Apim` (or `AppResources`) under a fresh stack and reads the ApiManagementService
 * inputs the Pulumi mock received. Tier names are passed without casts: the tier-name type is the contract under test.
 */

type TierName = NonNullable<ApimArgs['sku']>['name'];
type ApimInputs = Omit<ApimArgs, 'rsGroup' | 'disableSignIn'>;

const SERVICE = 'azure-native:apimanagement:ApiManagementService';
const RS_GROUP = { resourceGroupName: 'payments-rg', location: 'southeastasia' };

/** An Examples cell as the spec writes it: "1,2,3" is a list, "none" is nothing sent. */
const listOrNone = (cell: string) => (cell === 'none' ? undefined : cell.split(','));

/** Team "payments" creates APIM "pay-apim" on the given stack; returns the inputs of the ApiManagementService. */
async function previewApim(stackName: string, inputs: ApimInputs) {
  const { pulumi, service, captured } = withStack(stackName, (p) => {
    const mod: typeof import('../../src/apim/Apim') = require('../../src/apim/Apim');
    const service = new mod.Apim('pay-apim', {
      rsGroup: RS_GROUP,
      publisherName: 'payments',
      disableSignIn: true,
      ...inputs,
    });
    return { pulumi: p, service };
  });
  await settle(pulumi, service.id);
  return registrationOf(captured, SERVICE, 'pay-apim');
}

describe('APIM falls back to Consumption and accepts the v2 tiers (DRK-2592)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));
  dropExitListenerHooks();

  // Scenario Outline: APIM with no SKU uses Consumption with capacity 0
  test.each(['dev', 'prd'])('APIM with no SKU uses Consumption with capacity 0 — %s stack', async (stack) => {
    const inputs = await previewApim(stack, {});
    expect(inputs.sku).toEqual({ name: 'Consumption', capacity: 0 });
  });

  // Scenario: APIM with no SKU in PRD sends no zones and no extra regions — one check per rule (gate note 1).
  test('APIM with no SKU in PRD sends no zones, even when zone "1" is asked for', async () => {
    const inputs = await previewApim('prd', { zones: ['1'] });
    expect(inputs.zones).toBeUndefined();
  });

  test('APIM with no SKU in PRD sends no extra regions, even when region "westus" is asked for', async () => {
    const inputs = await previewApim('prd', {
      additionalLocations: [{ location: 'westus', sku: { name: 'Premium', capacity: 1 } }],
    });
    expect(inputs.additionalLocations).toBeUndefined();
  });

  // Scenario: The app-resources bundle creates APIM with no SKU
  test('The app-resources bundle creates APIM with no SKU', async () => {
    let failure: unknown;
    const { pulumi, bundle, captured } = withStack('dev', (p) => {
      const mod: typeof import('../../src/AppResources') = require('../../src/AppResources');
      try {
        const bundle = new mod.AppResources('pay', {
          rsGroup: RS_GROUP,
          apim: { publisherName: 'payments', disableSignIn: true },
        });
        return { pulumi: p, bundle };
      } catch (error) {
        failure = error;
        return { pulumi: p, bundle: undefined };
      }
    });
    if (failure) {
      // A failed construction leaves the bundle's children registering: let them finish on this test's mock
      // monitor, not the next test's, before the failure is reported.
      await new Promise((resolve) => setTimeout(resolve, 200));
      throw failure;
    }
    await settle(pulumi, bundle!.apim!.id);
    expect(registrationOf(captured, SERVICE, 'pay').sku).toEqual({ name: 'Consumption', capacity: 0 });
  });

  // Scenario Outline: A SKU the caller gives is sent unchanged
  test.each<{ tier: TierName; capacity: number }>([
    { tier: 'Premium', capacity: 2 },
    { tier: 'StandardV2', capacity: 1 },
    { tier: 'PremiumV2', capacity: 1 },
    { tier: 'Developer', capacity: 1 },
  ])('A SKU the caller gives is sent unchanged — $tier with capacity $capacity', async ({ tier, capacity }) => {
    const inputs = await previewApim('prd', { sku: { name: tier, capacity } });
    expect(inputs.sku).toEqual({ name: tier, capacity });
  });

  // Scenario Outline: PRD default zones per tier stay as today
  test.each<{ tier: TierName; zones: string }>([
    { tier: 'Premium', zones: '1,2,3' },
    { tier: 'StandardV2', zones: '1,2,3' },
    { tier: 'PremiumV2', zones: '1,2,3' },
    { tier: 'Developer', zones: 'none' },
    { tier: 'Standard', zones: 'none' },
    { tier: 'Isolated', zones: 'none' },
    { tier: 'BasicV2', zones: 'none' },
  ])('PRD default zones per tier stay as today — $tier sends zones $zones', async ({ tier, zones }) => {
    const inputs = await previewApim('prd', { sku: { name: tier, capacity: 1 } });
    expect(inputs.zones).toEqual(listOrNone(zones));
  });

  // Gate note 2: Basic and Consumption never get zones, even in PRD and even when the caller asks for zone "1".
  test.each<TierName>(['Basic', 'Consumption'])(
    'PRD %s sends no zones, even when zone "1" is asked for',
    async (tier) => {
      const inputs = await previewApim('prd', { sku: { name: tier, capacity: 1 }, zones: ['1'] });
      expect(inputs.zones).toBeUndefined();
    },
  );

  // Scenario Outline: Extra regions are sent only for Premium
  test.each<{ tier: TierName; regions: string }>([
    { tier: 'Premium', regions: 'westus' },
    { tier: 'StandardV2', regions: 'none' },
    { tier: 'PremiumV2', regions: 'none' },
  ])('Extra regions are sent only for Premium — $tier sends regions $regions', async ({ tier, regions }) => {
    const sku = { name: tier, capacity: 1 };
    const inputs = await previewApim('dev', { sku, additionalLocations: [{ location: 'westus', sku }] });
    expect(inputs.additionalLocations?.map((l: { location: string }) => l.location)).toEqual(listOrNone(regions));
  });
});
