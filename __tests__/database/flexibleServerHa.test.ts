import { restoreStack } from '../testUtils/pulumiMocks';
import { ServerKind, components, serverInputs } from '../testUtils/flexibleServer';

// Each case reloads the component and the Azure SDK modules through `withStack`. The first case in
// the file pays the cold load, which exceeds Jest's 5 s default when the full suite runs in parallel.
jest.setTimeout(30000);

// DRK-1818: Flexible Server HA defaults. Every scenario runs for both MySql and Postgres on a
// General Purpose SKU, because Burstable skips the high-availability block entirely.
describe.each(Object.keys(components) as ServerKind[])('%s — high availability defaults (DRK-1818)', (kind) => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('S1 — prd, GeneralPurpose, no zone args: primary zone 3, zone-redundant standby in zone 1', async () => {
    const inputs = await serverInputs(kind, 'prd');
    expect(inputs.availabilityZone).toBe('3');
    expect(inputs.highAvailability).toEqual({ mode: 'ZoneRedundant', standbyAvailabilityZone: '1' });
  });

  test.each([
    ['1', '2'],
    ['2', '1'],
  ])('S2 — prd, GeneralPurpose, caller primary zone %s: standby defaults to zone %s', async (zone, standby) => {
    const inputs = await serverInputs(kind, 'prd', { availabilityZone: zone });
    expect(inputs.availabilityZone).toBe(zone);
    expect(inputs.highAvailability).toEqual({ mode: 'ZoneRedundant', standbyAvailabilityZone: standby });
  });

  test('S3 — dev, GeneralPurpose, no HA args: no high availability, primary zone 1', async () => {
    const inputs = await serverInputs(kind, 'dev');
    expect(inputs.highAvailability).toBeUndefined();
    expect(inputs.availabilityZone).toBe('1');
  });

  test.each(['dev', 'prd'])('S4 — %s: a caller-supplied highAvailability is sent exactly as given', async (stack) => {
    const inputs = await serverInputs(kind, stack, {
      highAvailability: { mode: 'SameZone', standbyAvailabilityZone: '2' },
    });
    expect(inputs.highAvailability).toEqual({ mode: 'SameZone', standbyAvailabilityZone: '2' });
  });

  test('S5 — prd, Burstable: no high availability', async () => {
    const inputs = await serverInputs(kind, 'prd', { sku: { name: 'Standard_B2ms', tier: 'Burstable' } });
    expect(inputs.highAvailability).toBeUndefined();
  });
});
