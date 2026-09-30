import { withStack, restoreStack } from '../testUtils/pulumiMocks';

// DRK-770 §3.5 / §5: the availabilityZone precedence bug — `(this.args.availabilityZone ?? azureEnv.isPrd) ? '3' : '1'`
// coerced ANY truthy engineer-supplied zone string to '3', discarding the actual value. Fixed to
// `this.args.availabilityZone ?? (azureEnv.isPrd ? '3' : '1')`.

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
  administratorLogin: 'admin',
  version: '16',
  sku: { name: 'Standard_B2ms', tier: 'Burstable' },
  enableAzureADAdmin: false,
  // Supplying this avoids the component creating its own UserAssignedIdentity child resource.
  defaultUAssignedId: { id: 'uid_id', clientId: 'c', objectId: 'o', resourceName: 'uid', resourceGroupName: 'rg' },
};

function createPostgres(
  pulumi: typeof import('@pulumi/pulumi'),
  Postgres: typeof import('../../src/database/Postgres').Postgres,
  props: any,
) {
  return new Postgres('pg1', { ...baseArgs, ...props } as any);
}

describe('Postgres — availability zone defaulting', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('prd with no engineer zone defaults to zone 3', async () => {
    const { pulumi, Postgres, captured } = withStack('prd', (p) => {
      const mod: typeof import('../../src/database/Postgres') = require('../../src/database/Postgres');
      return { pulumi: p, Postgres: mod.Postgres };
    });

    const pg = createPostgres(pulumi, Postgres, {});
    await pulumi.output(pg.id).promise();
    const server = captured.find((c) => c.type === 'azure-native:dbforpostgresql:Server')!;
    expect(server.inputs.availabilityZone).toBe('3');
  });

  test('outside prd with no engineer zone defaults to zone 1', async () => {
    const { pulumi, Postgres, captured } = withStack('dev', (p) => {
      const mod: typeof import('../../src/database/Postgres') = require('../../src/database/Postgres');
      return { pulumi: p, Postgres: mod.Postgres };
    });

    const pg = createPostgres(pulumi, Postgres, {});
    await pulumi.output(pg.id).promise();
    const server = captured.find((c) => c.type === 'azure-native:dbforpostgresql:Server')!;
    expect(server.inputs.availabilityZone).toBe('1');
  });

  // Regression guard for the precedence bug: a prd engineer-supplied zone of '2' must stay '2',
  // not be coerced to '3' by the old `(zone ?? isPrd) ? '3' : '1'` truthiness check.
  test('an engineer-supplied zone in prd is honoured verbatim, not forced to 3', async () => {
    const { pulumi, Postgres, captured } = withStack('prd', (p) => {
      const mod: typeof import('../../src/database/Postgres') = require('../../src/database/Postgres');
      return { pulumi: p, Postgres: mod.Postgres };
    });

    const pg = createPostgres(pulumi, Postgres, { availabilityZone: '2' });
    await pulumi.output(pg.id).promise();
    const server = captured.find((c) => c.type === 'azure-native:dbforpostgresql:Server')!;
    expect(server.inputs.availabilityZone).toBe('2');
  });
});

// Pre-existing behaviour, untouched by DRK-770, but this file is a touched class this cycle
// (the availabilityZone line above) so its other branches need coverage too.
describe('Postgres — network rules, managed identity and databases (pre-existing behaviour)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('creates an allow-all firewall rule, its own managed identity and databases', async () => {
    const { pulumi, Postgres, captured } = withStack('dev', (p) => {
      const mod: typeof import('../../src/database/Postgres') = require('../../src/database/Postgres');
      return { pulumi: p, Postgres: mod.Postgres };
    });

    const pg = createPostgres(pulumi, Postgres, {
      defaultUAssignedId: undefined,
      enableResourceIdentity: true,
      network: { allowAllInbound: true },
      databases: [{ name: 'appdb' }],
    });
    await pulumi.output(pg.id).promise();
    // FirewallRule/Database are fire-and-forget siblings of `server`, not wired back through any
    // Postgres output — give their promise chains one more tick to settle after the server resolves.
    await new Promise((resolve) => setImmediate(resolve));

    expect(captured.find((c) => c.type === 'azure-native:dbforpostgresql:FirewallRule')).toBeDefined();
    expect(captured.find((c) => c.type === 'azure-native:managedidentity:UserAssignedIdentity')).toBeDefined();
    expect(captured.find((c) => c.type === 'azure-native:dbforpostgresql:Database')).toBeDefined();
  });

  test('creates a firewall rule per supplied IP', async () => {
    const { pulumi, Postgres, captured } = withStack('dev', (p) => {
      const mod: typeof import('../../src/database/Postgres') = require('../../src/database/Postgres');
      return { pulumi: p, Postgres: mod.Postgres };
    });

    const pg = createPostgres(pulumi, Postgres, { network: { ipRules: ['1.2.3.4'] } });
    await pulumi.output(pg.id).promise();
    await new Promise((resolve) => setImmediate(resolve));

    const rule = captured.find((c) => c.type === 'azure-native:dbforpostgresql:FirewallRule');
    expect(rule?.inputs.startIpAddress).toBe('1.2.3.4');
    expect(rule?.inputs.endIpAddress).toBe('1.2.3.4');
  });
});

// DRK-1818: Flexible Server HA defaults. A General Purpose SKU is used because Burstable skips the
// high-availability block entirely and would hide the defaults under test.
describe('Postgres — high availability defaults (DRK-1818)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  const generalPurposeSku = { name: 'Standard_D2ds_v4', tier: 'GeneralPurpose' };

  async function serverInputs(stackName: string, props: any) {
    const { pulumi, Postgres, captured } = withStack(stackName, (p) => {
      const mod: typeof import('../../src/database/Postgres') = require('../../src/database/Postgres');
      return { pulumi: p, Postgres: mod.Postgres };
    });

    const pg = createPostgres(pulumi, Postgres, props);
    await pulumi.output(pg.id).promise();
    return captured.find((c) => c.type === 'azure-native:dbforpostgresql:Server')!.inputs;
  }

  test('S1 — prd, GeneralPurpose, no zone args: primary zone 3, zone-redundant standby in zone 1', async () => {
    const inputs = await serverInputs('prd', { sku: generalPurposeSku });
    expect(inputs.availabilityZone).toBe('3');
    expect(inputs.highAvailability).toEqual({ mode: 'ZoneRedundant', standbyAvailabilityZone: '1' });
  });

  test.each([
    ['1', '2'],
    ['2', '1'],
  ])('S2 — prd, GeneralPurpose, caller primary zone %s: standby defaults to zone %s', async (zone, standby) => {
    const inputs = await serverInputs('prd', { sku: generalPurposeSku, availabilityZone: zone });
    expect(inputs.availabilityZone).toBe(zone);
    expect(inputs.highAvailability).toEqual({ mode: 'ZoneRedundant', standbyAvailabilityZone: standby });
  });

  test('S3 — dev, GeneralPurpose, no HA args: no high availability, primary zone 1', async () => {
    const inputs = await serverInputs('dev', { sku: generalPurposeSku });
    expect(inputs.highAvailability).toBeUndefined();
    expect(inputs.availabilityZone).toBe('1');
  });

  test.each(['dev', 'prd'])('S4 — %s: a caller-supplied highAvailability is sent exactly as given', async (stack) => {
    const inputs = await serverInputs(stack, {
      sku: generalPurposeSku,
      highAvailability: { mode: 'SameZone', standbyAvailabilityZone: '2' },
    });
    expect(inputs.highAvailability).toEqual({ mode: 'SameZone', standbyAvailabilityZone: '2' });
  });

  test('S5 — prd, Burstable: no high availability', async () => {
    const inputs = await serverInputs('prd', { sku: { name: 'Standard_B2ms', tier: 'Burstable' } });
    expect(inputs.highAvailability).toBeUndefined();
  });
});
