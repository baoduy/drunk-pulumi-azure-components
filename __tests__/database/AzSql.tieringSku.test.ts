import { withStack, restoreStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1822 S2 — SKU classification behind the AzSql tier defaults (programmer tests, DRK-1858).
 * Pins the SKU families the acceptance tests do not reach: BusinessCritical, DTU Premium,
 * DTU Standard, tier-only Hyperscale, case-insensitive tiers and unresolved `Input` SKU names.
 *
 * Each row names the stack, the AzSql args, and the expected inputs per resource type
 * (`Database`, `ElasticPool`). An expected `undefined` means the field is not sent.
 */

type Expected = Partial<Record<'Database' | 'ElasticPool', Record<string, unknown>>>;

const standalone = (sku: Record<string, unknown>) => ({ databases: { app: { sku } } });
const noZoneDefault = { zoneRedundant: undefined, requestedBackupStorageRedundancy: 'Geo', autoPauseDelay: undefined };

const cases: Array<[string, 'prd' | 'dev', Record<string, unknown>, Expected]> = [
  [
    'prd BC_Gen5_2 name is zone-redundant',
    'prd',
    standalone({ name: 'BC_Gen5_2' }),
    { Database: { zoneRedundant: true } },
  ],
  ['prd DTU P1 name is zone-redundant', 'prd', standalone({ name: 'P1' }), { Database: { zoneRedundant: true } }],
  ['prd DTU P15 name is zone-redundant', 'prd', standalone({ name: 'P15' }), { Database: { zoneRedundant: true } }],
  [
    'prd lower-case businesscritical tier is zone-redundant',
    'prd',
    standalone({ name: 'custom', tier: 'businesscritical' }),
    { Database: { zoneRedundant: true } },
  ],
  [
    'prd Premium tier is zone-redundant',
    'prd',
    standalone({ name: 'custom', tier: 'Premium' }),
    { Database: { zoneRedundant: true } },
  ],
  [
    'prd DTU S0 name gets no zone-redundancy default',
    'prd',
    standalone({ name: 'S0', tier: 'Standard' }),
    { Database: noZoneDefault },
  ],
  [
    'prd P1 prefix of a longer name gets no zone-redundancy default',
    'prd',
    standalone({ name: 'P1X' }),
    { Database: noZoneDefault },
  ],
  [
    'prd GP_ not at the start of the name gets no zone-redundancy default',
    'prd',
    standalone({ name: 'XGP_Gen5_2' }),
    { Database: noZoneDefault },
  ],
  [
    'prd database with only a Hyperscale tier gets no backup default',
    'prd',
    standalone({ name: 'custom', tier: 'Hyperscale' }),
    { Database: { zoneRedundant: undefined, requestedBackupStorageRedundancy: undefined } },
  ],
  [
    'dev database with no sku still gets local backups and no other default',
    'dev',
    { databases: { app: {} } },
    { Database: { requestedBackupStorageRedundancy: 'Local', zoneRedundant: undefined, autoPauseDelay: undefined } },
  ],
  [
    'prd database with an unresolved Input sku name gets no sku-based default',
    'prd',
    standalone({ name: Promise.resolve('GP_S_Gen5_1') }),
    { Database: noZoneDefault },
  ],
  [
    'dev database in a serverless pool takes the pool sku for auto-pause',
    'dev',
    { elasticPoolCreate: { sku: { name: 'GP_S_Gen5_1' } }, databases: { app: { sku: { name: 'Basic' } } } },
    {
      ElasticPool: { zoneRedundant: false },
      Database: { autoPauseDelay: 60, zoneRedundant: undefined, requestedBackupStorageRedundancy: 'Local' },
    },
  ],
  [
    'prd DTU Standard elastic pool gets neither a zone-redundancy nor an auto-pause default',
    'prd',
    { elasticPoolCreate: { sku: { name: 'StandardPool', tier: 'Standard' } } },
    { ElasticPool: { zoneRedundant: undefined, autoPauseDelay: undefined } },
  ],
  [
    'dev database keeps a caller zoneRedundant: true and requestedBackupStorageRedundancy: Geo',
    'dev',
    { databases: { app: { sku: { name: 'S0' }, zoneRedundant: true, requestedBackupStorageRedundancy: 'Geo' } } },
    { Database: { zoneRedundant: true, requestedBackupStorageRedundancy: 'Geo' } },
  ],
];

/**
 * Reloads AzSql under `stack`, deploys `args`, and waits until every expected resource type is
 * registered. Returns the captured inputs keyed by the last segment of the resource type.
 */
async function inputsByType(stack: string, args: Record<string, unknown>, types: string[]) {
  const { pulumi, AzSql, captured } = withStack(stack, (p) => ({
    pulumi: p,
    AzSql: require('../../src/database/AzSql').AzSql,
  }));

  const server = new AzSql('sql-sku', {
    rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
    administrators: { azureAdOnlyAuthentication: true },
    ...args,
  });
  await pulumi.output(server.id).promise();

  const byType = () => Object.fromEntries(captured.map((c) => [c.type.split(':').pop(), c.inputs]));
  for (let i = 0; i < 200 && !types.every((t) => t in byType()); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return byType();
}

describe('AzSql SKU classification for tier defaults', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test.each(cases)('%s', async (_, stack, args, expected) => {
    const inputs = await inputsByType(stack, args, Object.keys(expected));

    for (const [type, fields] of Object.entries(expected)) {
      // Presence first, so an expected `undefined` cannot pass on a resource that was never created.
      expect(Object.keys(inputs)).toContain(type);
      const actual = Object.fromEntries(Object.keys(fields!).map((key) => [key, inputs[type]?.[key]]));
      expect({ [type]: actual }).toEqual({ [type]: fields });
    }
  });
});
