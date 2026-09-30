import { withStack, restoreStack } from '../testUtils/pulumiMocks';

// DRK-1818 build-stage pin: Postgres guards HA on `sku?.tier`, so a server with no SKU is not
// Burstable and still gets the default HA block (the frozen ATs only cover explicit SKUs).
const baseArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
  administratorLogin: 'admin',
  version: '16',
  enableAzureADAdmin: false,
  defaultUAssignedId: { id: 'uid_id', clientId: 'c', objectId: 'o', resourceName: 'uid', resourceGroupName: 'rg' },
};

describe('Postgres — high availability defaults with no SKU (DRK-1818)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  async function serverInputs(stackName: string) {
    const { pulumi, Postgres, captured } = withStack(stackName, (p) => {
      const mod: typeof import('../../src/database/Postgres') = require('../../src/database/Postgres');
      return { pulumi: p, Postgres: mod.Postgres };
    });

    const pg = new Postgres('pg1', baseArgs as any);
    await pulumi.output(pg.id).promise();
    return captured.find((c) => c.type === 'azure-native:dbforpostgresql:Server')!.inputs;
  }

  test('prd, no SKU: zone-redundant standby in zone 1, primary zone 3', async () => {
    const inputs = await serverInputs('prd');
    expect(inputs.availabilityZone).toBe('3');
    expect(inputs.highAvailability).toEqual({ mode: 'ZoneRedundant', standbyAvailabilityZone: '1' });
  });

  test('dev, no SKU: no high availability', async () => {
    const inputs = await serverInputs('dev');
    expect(inputs.highAvailability).toBeUndefined();
  });
});
