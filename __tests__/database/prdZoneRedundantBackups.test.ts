import { dropExitListenerHooks, restoreStack, settle, withStack } from '../testUtils/pulumiMocks';
import { captureResourceParents } from '../testUtils/pulumiParentSpy';
import { ServerKind, serverInputs } from '../testUtils/flexibleServer';

/**
 * DRK-2569 — PRD databases use zone-redundant protection (acceptance tests, azure-components rows).
 *
 * Feature file: spec DRK-2569 §5, revision 37. One test per scenario row, named after it.
 * - PRD Azure SQL databases (standalone or pooled, Hyperscale excepted) default to zone-redundant
 *   backup storage and get a `BackupShortTermRetentionPolicy`: a differential backup every 12 hours
 *   and 7 days of point-in-time restore.
 * - PRD PostgreSQL / MySQL flexible servers default to geo-redundant backup off, retention unchanged.
 * - A caller-set value always wins; outside PRD every touched default stays as it is today.
 *
 * The scenario "azure-components keeps its PRD zone-redundant compute" is already pinned and is not
 * duplicated here: `AzSql.tiering.test.ts` (S1 database, S3 pool), `flexibleServerHa.test.ts`
 * (PostgreSQL / MySQL zone-redundant HA) and `Redis.behaviour.test.ts` (Premium Redis zones).
 *
 * `isPrd` is read once at module load, so every case reloads AzSql under an explicit stack name.
 */

const COMPONENT = 'sql-prd-01';
const POLICY_TYPE = 'azure-native:sql:BackupShortTermRetentionPolicy';
const DB_TYPE = 'azure-native:sql:Database';

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
  administrators: { azureAdOnlyAuthentication: true },
};

const onItsOwn = (size: string, db = 'orders') => ({ databases: { [db]: { sku: { name: size } } } });
const inPool = (size: string, db = 'orders') => ({
  elasticPoolCreate: { sku: { name: size } },
  databases: { [db]: {} },
});

/**
 * Builds AzSql under `stack` and lets every child settle. Azure returns a database's `name` as the
 * database name, not the Pulumi resource name, so the mock echoes `databaseName` back as `name`.
 */
async function build(stack: string, args: Record<string, unknown>) {
  let spy: ReturnType<typeof captureResourceParents> | undefined;
  const { pulumi, AzSql, captured } = withStack(
    stack,
    (p) => {
      spy = captureResourceParents();
      return { pulumi: p, AzSql: require('../../src/database/AzSql').AzSql };
    },
    (a) => (a.type === DB_TYPE ? { name: a.inputs.databaseName } : {}),
  );
  try {
    const server = new AzSql(COMPONENT, { ...baseArgs, ...args });
    await settle(pulumi, server.id);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const ofType = (type: string) => captured.filter((c) => c.type === type);
    return { server, ofType, registered: spy!.captured };
  } finally {
    spy!.restore();
  }
}

/** The one captured database named `db`; fails the test when it is missing, so an absence check is never vacuous. */
function databaseOf(ofType: (type: string) => Array<{ inputs: any }>, db: string) {
  const found = ofType(DB_TYPE).filter((c) => c.inputs.databaseName === db);
  expect(found).toHaveLength(1);
  return found[0].inputs;
}

describe('Feature: PRD databases use zone-redundant protection (azure-components)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));
  dropExitListenerHooks();

  describe('@new Scenario Outline: azure-components keeps PRD SQL backups inside the region', () => {
    test.each([
      ['GP_Gen5_2', 'on its own', onItsOwn('GP_Gen5_2')],
      ['S0', 'on its own', onItsOwn('S0')],
      ['GP_Gen5_2', 'in the elastic pool "shared-pool"', inPool('GP_Gen5_2')],
    ])('"orders" on size "%s" %s keeps its backups in zone-redundant storage', async (_size, _placement, args) => {
      const { ofType } = await build('prd', args);

      expect(databaseOf(ofType, 'orders').requestedBackupStorageRedundancy).toBe('Zone');
    });
  });

  describe('@new Scenario Outline: azure-components takes a PRD SQL differential backup every 12 hours', () => {
    test.each([
      ['S0', 'on its own', onItsOwn('S0')],
      ['GP_Gen5_2', 'on its own', onItsOwn('GP_Gen5_2')],
      ['GP_Gen5_2', 'in the elastic pool "shared-pool"', inPool('GP_Gen5_2')],
    ])(
      '"orders" on size "%s" %s takes a differential backup every 12 hours and keeps 7 days of point-in-time restore',
      async (_size, _placement, args) => {
        const { ofType } = await build('prd', args);

        const policies = ofType(POLICY_TYPE);
        expect(policies).toHaveLength(1);
        expect(policies[0].inputs).toEqual({
          resourceGroupName: 'rg',
          serverName: COMPONENT,
          databaseName: 'orders',
          policyName: 'default',
          diffBackupIntervalInHours: 12,
          retentionDays: 7,
        });
      },
    );
  });

  describe('@existing Scenario: azure-components gives a PRD Hyperscale database no backup defaults', () => {
    test('"analytics" on size "HS_Gen5_2" gets no backup storage default and no differential backup frequency', async () => {
      const { ofType } = await build('prd', onItsOwn('HS_Gen5_2', 'analytics'));

      expect(databaseOf(ofType, 'analytics').requestedBackupStorageRedundancy).toBeUndefined();
      expect(ofType(POLICY_TYPE)).toHaveLength(0);
    });
  });

  describe('@new Scenario Outline: PRD PostgreSQL and MySQL servers keep their backups inside the region', () => {
    test.each([
      ['PostgreSQL', 'Postgres'],
      ['MySQL', 'MySql'],
    ] as Array<[string, ServerKind]>)(
      'azure-components %s flexible server on tier "GeneralPurpose" has geo-redundant backup off and keeps backups for 30 days',
      async (_engine, kind) => {
        expect((await serverInputs(kind, 'prd')).backup).toEqual({
          geoRedundantBackup: 'Disabled',
          backupRetentionDays: 30,
        });
      },
    );
  });

  describe("@existing Scenario Outline: a caller's backup choice wins in azure-components", () => {
    test('Azure SQL database "orders" keeps geo-redundant backup storage', async () => {
      const { ofType } = await build('prd', {
        databases: { orders: { sku: { name: 'S0' }, requestedBackupStorageRedundancy: 'Geo' } },
      });

      expect(databaseOf(ofType, 'orders').requestedBackupStorageRedundancy).toBe('Geo');
    });

    test.each([
      ['PostgreSQL', 'Postgres'],
      ['MySQL', 'MySql'],
    ] as Array<[string, ServerKind]>)(
      '%s flexible server "orders" keeps geo-redundant backup on with 30 days of retention',
      async (_engine, kind) => {
        const backup = { geoRedundantBackup: 'Enabled', backupRetentionDays: 30 };

        expect((await serverInputs(kind, 'prd', { backup })).backup).toEqual({
          geoRedundantBackup: 'Enabled',
          backupRetentionDays: 30,
        });
      },
    );
  });

  describe('@existing Scenario Outline: outside PRD the touched defaults stay as they are today', () => {
    test('azure-components Azure SQL database "orders" on size "S0" keeps local backup storage and gets no differential backup frequency', async () => {
      const { ofType } = await build('dev', onItsOwn('S0'));

      expect(databaseOf(ofType, 'orders').requestedBackupStorageRedundancy).toBe('Local');
      expect(ofType(POLICY_TYPE)).toHaveLength(0);
    });

    test.each([
      ['PostgreSQL', 'Postgres'],
      ['MySQL', 'MySql'],
    ] as Array<[string, ServerKind]>)(
      'azure-components %s flexible server "orders-db" has geo-redundant backup off and keeps backups for 7 days',
      async (_engine, kind) => {
        expect((await serverInputs(kind, 'dev')).backup).toEqual({
          geoRedundantBackup: 'Disabled',
          backupRetentionDays: 7,
        });
      },
    );
  });

  // Input-domain rows of the brief (§6a) the scenarios above do not reach.
  describe('PRD differential backup policy — input domain', () => {
    test('D6: a database on a tier-only "Hyperscale" sku gets no policy', async () => {
      const { ofType } = await build('prd', {
        databases: { orders: { sku: { name: 'custom', tier: 'Hyperscale' } } },
      });

      databaseOf(ofType, 'orders');
      expect(ofType(POLICY_TYPE)).toHaveLength(0);
    });

    test('D6: a database in a Hyperscale elastic pool gets no policy and no backup storage default', async () => {
      const { ofType } = await build('prd', inPool('HS_Gen5_2'));

      expect(databaseOf(ofType, 'orders').requestedBackupStorageRedundancy).toBeUndefined();
      expect(ofType(POLICY_TYPE)).toHaveLength(0);
    });

    test('D8: a database whose sku name is an unresolved Input counts as non-Hyperscale and gets the policy', async () => {
      const { ofType } = await build('prd', {
        databases: { orders: { sku: { name: Promise.resolve('HS_Gen5_2') } } },
      });

      expect(databaseOf(ofType, 'orders').requestedBackupStorageRedundancy).toBe('Zone');
      const policies = ofType(POLICY_TYPE);
      expect(policies).toHaveLength(1);
      expect(policies[0].inputs.databaseName).toBe('orders');
      expect(policies[0].inputs.diffBackupIntervalInHours).toBe(12);
    });

    test('D9: a server with no databases gets no policy', async () => {
      const { ofType } = await build('prd', {});

      expect(ofType('azure-native:sql:Server')).toHaveLength(1);
      expect(ofType(POLICY_TYPE)).toHaveLength(0);
    });

    test('one policy per PRD database, each named after its own database', async () => {
      const { ofType } = await build('prd', {
        databases: { orders: { sku: { name: 'S0' } }, billing: { sku: { name: 'S0' } } },
      });

      expect(
        ofType(POLICY_TYPE)
          .map((c) => c.inputs.databaseName)
          .sort(),
      ).toEqual(['billing', 'orders']);
    });

    test('the policy is a child of the AzSql component', async () => {
      const { server, registered } = await build('prd', onItsOwn('S0'));

      const policies = registered.filter((r) => r.type === POLICY_TYPE);
      expect(policies).toHaveLength(1);
      expect(policies[0].parent).toBe(server);
    });
  });
});
