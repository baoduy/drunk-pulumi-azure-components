import { withStack, restoreStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1822 S2 — AzSql environment tiering (acceptance tests, DRK-1862).
 *
 * PRD: SQL databases and elastic pools on zone-capable SKUs (GeneralPurpose, BusinessCritical,
 * Premium) default to zone-redundant, and databases default to geo backups.
 * Non-PRD: databases default to local backups. Serverless SKUs (`_S_` in the name) default
 * `autoPauseDelay` to -1 in PRD and 60 minutes elsewhere. A caller-supplied value always wins.
 *
 * `isPrd` is read once at module load, so every case reloads AzSql under an explicit stack name
 * through `withStack`.
 */

// Each case reloads the pulumi module graph; under a parallel full run that can exceed jest's 5 s default.
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

  const sqlServer = new AzSql('sql-tier', { ...baseArgs, ...args } as any);
  await pulumi.output(sqlServer.id).promise();
  // Let the databases, pool and secrets settle before the next `withStack` swaps the mock monitor.
  await new Promise((resolve) => setTimeout(resolve, 50));

  return {
    db: captured.find((c) => c.type === DB_TYPE)?.inputs,
    pool: captured.find((c) => c.type === POOL_TYPE)?.inputs,
  };
}

describe('AzSql — PRD zone redundancy and geo backups, non-PRD local backups and serverless auto-pause', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('S1: prd standalone GP_Gen5_2 database is zone-redundant with geo backups and no auto-pause', async () => {
    const { db } = await deploy('prd', { databases: { app: { sku: { name: 'GP_Gen5_2' } } } });

    expect(db.zoneRedundant).toBe(true);
    expect(db.requestedBackupStorageRedundancy).toBe('Geo');
    expect(db.autoPauseDelay).toBeUndefined();
  });

  test('S2: dev standalone GP_Gen5_2 database is not zone-redundant and uses local backups', async () => {
    const { db } = await deploy('dev', { databases: { app: { sku: { name: 'GP_Gen5_2' } } } });

    expect(db.zoneRedundant).toBe(false);
    expect(db.requestedBackupStorageRedundancy).toBe('Local');
  });

  test('S3: prd GeneralPurpose elastic pool is zone-redundant by default', async () => {
    const { pool } = await deploy('prd', {
      elasticPoolCreate: { sku: { name: 'GP_Gen5_2', tier: 'GeneralPurpose' } },
    });

    expect(pool.zoneRedundant).toBe(true);
  });

  test('S3: prd GeneralPurpose elastic pool keeps a caller zoneRedundant: false', async () => {
    const { pool } = await deploy('prd', {
      elasticPoolCreate: { sku: { name: 'GP_Gen5_2', tier: 'GeneralPurpose' }, zoneRedundant: false },
    });

    expect(pool.zoneRedundant).toBe(false);
  });

  describe('S4: serverless GP_S_Gen5_1 auto-pause', () => {
    test('dev serverless elastic pool auto-pauses after 60 minutes', async () => {
      const { pool } = await deploy('dev', { elasticPoolCreate: { sku: { name: 'GP_S_Gen5_1' } } });

      expect(pool.autoPauseDelay).toBe(60);
    });

    test('dev serverless standalone database auto-pauses after 60 minutes', async () => {
      const { db } = await deploy('dev', { databases: { app: { sku: { name: 'GP_S_Gen5_1' } } } });

      expect(db.autoPauseDelay).toBe(60);
    });

    test('prd serverless elastic pool never auto-pauses (-1)', async () => {
      const { pool } = await deploy('prd', { elasticPoolCreate: { sku: { name: 'GP_S_Gen5_1' } } });

      expect(pool.autoPauseDelay).toBe(-1);
    });

    test('prd serverless standalone database never auto-pauses (-1)', async () => {
      const { db } = await deploy('prd', { databases: { app: { sku: { name: 'GP_S_Gen5_1' } } } });

      expect(db.autoPauseDelay).toBe(-1);
    });

    test('a caller autoPauseDelay: 120 on a serverless elastic pool is sent verbatim', async () => {
      const { pool } = await deploy('dev', {
        elasticPoolCreate: { sku: { name: 'GP_S_Gen5_1' }, autoPauseDelay: 120 },
      });

      expect(pool.autoPauseDelay).toBe(120);
    });

    test('a caller autoPauseDelay: 120 on a serverless standalone database is sent verbatim', async () => {
      const { db } = await deploy('prd', {
        databases: { app: { sku: { name: 'GP_S_Gen5_1' }, autoPauseDelay: 120 } },
      });

      expect(db.autoPauseDelay).toBe(120);
    });
  });

  test('S5: prd Basic database gets no zone-redundancy default but still geo backups', async () => {
    const { db } = await deploy('prd', { databases: { app: { sku: { name: 'Basic', tier: 'Basic' } } } });

    expect(db.zoneRedundant).toBeUndefined();
    expect(db.requestedBackupStorageRedundancy).toBe('Geo');
  });

  test('S6: prd Hyperscale HS_Gen5_2 database gets neither a zone-redundancy nor a backup default', async () => {
    const { db } = await deploy('prd', { databases: { app: { sku: { name: 'HS_Gen5_2' } } } });

    expect(db.zoneRedundant).toBeUndefined();
    expect(db.requestedBackupStorageRedundancy).toBeUndefined();
  });

  describe('S7: prd pooled database', () => {
    const pooled = (db: Record<string, unknown>) => ({
      elasticPoolCreate: { sku: { name: 'GP_Gen5_2', tier: 'GeneralPurpose' } },
      databases: { app: db },
    });

    test('gets no zoneRedundant default — the pool carries zone redundancy', async () => {
      const { db } = await deploy('prd', pooled({}));

      expect(db.zoneRedundant).toBeUndefined();
    });

    test('keeps a caller zoneRedundant: true verbatim', async () => {
      const { db } = await deploy('prd', pooled({ zoneRedundant: true }));

      expect(db.zoneRedundant).toBe(true);
    });

    test("keeps a caller requestedBackupStorageRedundancy: 'Zone' verbatim", async () => {
      const { db } = await deploy('prd', pooled({ requestedBackupStorageRedundancy: 'Zone' }));

      expect(db.requestedBackupStorageRedundancy).toBe('Zone');
    });
  });
});
