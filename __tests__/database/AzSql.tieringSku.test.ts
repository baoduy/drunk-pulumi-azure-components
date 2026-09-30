import { withStack, restoreStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1822 S2 — SKU classification behind the AzSql tier defaults (programmer tests, DRK-1858).
 * Pins the SKU families the acceptance tests do not reach: BusinessCritical, DTU Premium,
 * DTU Standard, tier-only Hyperscale, case-insensitive tiers and unresolved `Input` SKU names.
 */

jest.setTimeout(30_000);

const DB_TYPE = 'azure-native:sql:Database';
const POOL_TYPE = 'azure-native:sql:ElasticPool';

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
  administrators: { azureAdOnlyAuthentication: true },
};

async function deploy(stackName: string, args: Record<string, unknown>) {
  const { pulumi, AzSql, captured } = withStack(stackName, (p) => ({
    pulumi: p,
    AzSql: require('../../src/database/AzSql').AzSql,
  }));

  // The cases send raw SKU shapes, including an unresolved Input name, so the args stay untyped.
  const sqlServer = new AzSql('sql-sku', { ...baseArgs, ...args } as any);
  await pulumi.output(sqlServer.id).promise();
  await new Promise((resolve) => setTimeout(resolve, 50));

  return {
    pulumi,
    db: captured.find((c) => c.type === DB_TYPE)?.inputs,
    pool: captured.find((c) => c.type === POOL_TYPE)?.inputs,
  };
}

const standalone = (sku: Record<string, unknown>) => ({ databases: { app: { sku } } });

describe('AzSql SKU classification for tier defaults', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test.each([
    ['BC_Gen5_2 name', { name: 'BC_Gen5_2' }],
    ['DTU P1 name', { name: 'P1' }],
    ['DTU P15 name', { name: 'P15' }],
    ['lower-case businesscritical tier', { name: 'custom', tier: 'businesscritical' }],
    ['Premium tier', { name: 'custom', tier: 'Premium' }],
  ])('prd standalone %s is zone-redundant', async (_, sku) => {
    const { db } = await deploy('prd', standalone(sku));

    expect(db.zoneRedundant).toBe(true);
  });

  test.each([
    ['DTU S0 name', { name: 'S0', tier: 'Standard' }],
    ['P1 prefix of a longer name', { name: 'P1X' }],
    ['GP_ not at the start of the name', { name: 'XGP_Gen5_2' }],
  ])('prd standalone %s gets no zone-redundancy default', async (_, sku) => {
    const { db } = await deploy('prd', standalone(sku));

    expect(db.zoneRedundant).toBeUndefined();
    expect(db.requestedBackupStorageRedundancy).toBe('Geo');
    expect(db.autoPauseDelay).toBeUndefined();
  });

  test('prd database with only a Hyperscale tier gets no backup default', async () => {
    const { db } = await deploy('prd', standalone({ name: 'custom', tier: 'Hyperscale' }));

    expect(db.zoneRedundant).toBeUndefined();
    expect(db.requestedBackupStorageRedundancy).toBeUndefined();
  });

  test('dev database with no sku still gets local backups and no other default', async () => {
    const { db } = await deploy('dev', { databases: { app: {} } });

    expect(db.requestedBackupStorageRedundancy).toBe('Local');
    expect(db.zoneRedundant).toBeUndefined();
    expect(db.autoPauseDelay).toBeUndefined();
  });

  test('prd database with an unresolved Input sku name gets no sku-based default', async () => {
    const { db } = await deploy('prd', {
      databases: { app: { sku: { name: Promise.resolve('GP_S_Gen5_1') } } },
    });

    expect(db.zoneRedundant).toBeUndefined();
    expect(db.autoPauseDelay).toBeUndefined();
    expect(db.requestedBackupStorageRedundancy).toBe('Geo');
  });

  test('dev database in a serverless pool takes the pool sku for auto-pause', async () => {
    const { db, pool } = await deploy('dev', {
      elasticPoolCreate: { sku: { name: 'GP_S_Gen5_1' } },
      databases: { app: { sku: { name: 'Basic' } } },
    });

    expect(pool.zoneRedundant).toBe(false);
    expect(db.autoPauseDelay).toBe(60);
    expect(db.zoneRedundant).toBeUndefined();
    expect(db.requestedBackupStorageRedundancy).toBe('Local');
  });

  test('prd DTU Standard elastic pool gets neither a zone-redundancy nor an auto-pause default', async () => {
    const { pool } = await deploy('prd', { elasticPoolCreate: { sku: { name: 'StandardPool', tier: 'Standard' } } });

    expect(pool.zoneRedundant).toBeUndefined();
    expect(pool.autoPauseDelay).toBeUndefined();
  });

  test('dev database keeps a caller zoneRedundant: true and requestedBackupStorageRedundancy: Geo', async () => {
    const { db } = await deploy('dev', {
      databases: { app: { sku: { name: 'S0' }, zoneRedundant: true, requestedBackupStorageRedundancy: 'Geo' } },
    });

    expect(db.zoneRedundant).toBe(true);
    expect(db.requestedBackupStorageRedundancy).toBe('Geo');
  });
});
