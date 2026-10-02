import type { AppConfigArgs } from '../../src/app/AppConfig';
import { withStack, restoreStack, settle } from '../testUtils/pulumiMocks';

/**
 * DRK-1922 row 9 — opt-in App Configuration replicas (acceptance tests, DRK-1986).
 *
 * `replicaLocations` creates one `appconfiguration.Replica` per region on the store; the replica name is the
 * region lower-cased with spaces and dashes removed. Without the input, or with an empty list, no replica is
 * created in any env (R1); in prd that writes one warning and the store is still created (R2); outside prd
 * nothing is written (R3).
 *
 * `isPrd` is read once at module load, so every case reloads AppConfig under an explicit stack name through
 * `withStack`. The prd network guard only accepts a private-link-only store, so prd cases pass one.
 */

jest.setTimeout(30_000);

const STORE_TYPE = 'azure-native:appconfiguration:ConfigurationStore';
const REPLICA_TYPE = 'azure-native:appconfiguration:Replica';

async function deploy(stackName: string, extra: Partial<AppConfigArgs> = {}) {
  const { pulumi, AppConfig, captured } = withStack(
    stackName,
    (p) => ({ pulumi: p, AppConfig: require('../../src/app/AppConfig').AppConfig }),
    // PrivateEndpoint reads customDnsConfigs[].ipAddresses back off its own resource state.
    (args) =>
      args.type === 'azure-native:network:PrivateEndpoint' ? { customDnsConfigs: [{ ipAddresses: ['10.0.0.4'] }] } : {},
  );
  const warn = jest.spyOn(pulumi.log, 'warn').mockImplementation(() => undefined);

  const network: AppConfigArgs['network'] =
    stackName === 'prd' ? { privateLink: { subnetInfo: { subnetId: 'pe-subnet' } } } : undefined;
  const args: AppConfigArgs = { rsGroup: { resourceGroupName: 'rg', location: 'eastus' }, network, ...extra };
  const store = new AppConfig('appcfg-rep', args);
  await settle(pulumi, store.id);

  const byType = (type: string) => captured.filter((c) => c.type === type);
  // Warnings that name this store and the replicaLocations input.
  const replicaWarnings = warn.mock.calls
    .map((call) => String(call[0]))
    .filter((m) => m.includes('AppConfig') && m.includes('appcfg-rep') && m.includes('replicaLocations'));
  return { byType, replicaWarnings };
}

describe('AppConfig — opt-in replicas', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    restoreStack(ORIGINAL_STACK);
  });

  describe('replicaLocations creates one replica per region', () => {
    test.each(['prd', 'dev'])('%s: two regions give two replicas on the store', async (stack) => {
      const { byType } = await deploy(stack, { replicaLocations: ['Southeast Asia', 'west-us-2'] });

      const replicas = byType(REPLICA_TYPE).map((r) => r.inputs);
      expect(replicas).toHaveLength(2);
      expect(replicas.map((r) => [r.replicaName, r.location])).toEqual([
        ['southeastasia', 'Southeast Asia'],
        ['westus2', 'west-us-2'],
      ]);
      for (const replica of replicas) {
        expect(replica.configStoreName).toBe('appcfg-rep');
        expect(replica.resourceGroupName).toBe('rg');
      }
    });
  });

  describe('no replica without regions (R1)', () => {
    test.each(['prd', 'dev'])('%s: no replicaLocations means no Replica', async (stack) => {
      const { byType } = await deploy(stack);

      expect(byType(STORE_TYPE)).toHaveLength(1);
      expect(byType(REPLICA_TYPE)).toHaveLength(0);
    });

    test('an empty replicaLocations list means no Replica', async () => {
      const { byType } = await deploy('dev', { replicaLocations: [] });

      expect(byType(REPLICA_TYPE)).toHaveLength(0);
    });
  });

  describe('prd warns when replicas are left off, the store is still created (R2)', () => {
    test('prd without replicaLocations writes one warning naming the store and the replicaLocations input', async () => {
      const { byType, replicaWarnings } = await deploy('prd');

      expect(replicaWarnings).toHaveLength(1);
      expect(byType(STORE_TYPE)).toHaveLength(1);
    });

    test('prd with an empty replicaLocations list writes the same warning', async () => {
      const { replicaWarnings } = await deploy('prd', { replicaLocations: [] });

      expect(replicaWarnings).toHaveLength(1);
    });

    test('prd with replicas writes no replica warning', async () => {
      const { replicaWarnings } = await deploy('prd', { replicaLocations: ['southeastasia'] });

      expect(replicaWarnings).toHaveLength(0);
    });
  });

  describe('outside prd nothing is written (R3)', () => {
    test('dev without replicaLocations writes no replica warning', async () => {
      const { replicaWarnings } = await deploy('dev');

      expect(replicaWarnings).toHaveLength(0);
    });
  });
});
