import { withStack, restoreStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1822 S3 — AzSearch environment tiering (acceptance tests, DRK-1863).
 *
 * PRD search services on a paid SKU default to 3 replicas, which gives an SLA.
 * The Free SKU and every non-PRD stack keep the Azure default (no `replicaCount` sent).
 * A caller-supplied `replicaCount` always wins, in any env — a caller `0` is a value.
 *
 * "No `replicaCount` sent" is observed as `1`: the azure-native `search.Service` constructor fills an
 * absent `replicaCount` with `?? 1` before the resource reaches the mock monitor, so the captured
 * input of an unset replica count is `1` (the spec's "unset (1)").
 *
 * `isPrd` is read once at module load, so every case reloads AzSearch under an explicit stack name
 * through `withStack`.
 */

// Each case reloads the pulumi module graph; under a parallel full run that can exceed jest's 5 s default.
jest.setTimeout(30_000);

const SEARCH_TYPE = 'azure-native:search:Service';

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
};

async function deploy(stackName: string, args: Record<string, unknown>) {
  const { pulumi, AzSearch, captured } = withStack(stackName, (p) => ({
    pulumi: p,
    AzSearch: require('../../src/services/AzSearch').AzSearch,
  }));

  const service = new AzSearch('search-tier', { ...baseArgs, ...args } as any);
  await pulumi.output(service.id).promise();
  // Let the service settle before the next `withStack` swaps the mock monitor.
  await new Promise((resolve) => setTimeout(resolve, 50));

  return captured.find((c) => c.type === SEARCH_TYPE)!.inputs;
}

describe('AzSearch — PRD replicas for an SLA, non-PRD and Free unchanged', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  describe('S1: default replica count by environment and SKU (R2)', () => {
    test('prd basic search without replicaCount gets 3 replicas', async () => {
      const inputs = await deploy('prd', { sku: 'basic' });

      expect(inputs.replicaCount).toBe(3);
    });

    test('prd free search without replicaCount keeps the Azure default of 1 replica', async () => {
      const inputs = await deploy('prd', { sku: 'free' });

      expect(inputs.sku).toEqual({ name: 'free' });
      expect(inputs.replicaCount).toBe(1);
    });

    test('dev basic search without replicaCount keeps the Azure default of 1 replica', async () => {
      const inputs = await deploy('dev', { sku: 'basic' });

      expect(inputs.sku).toEqual({ name: 'basic' });
      expect(inputs.replicaCount).toBe(1);
    });
  });

  describe('S2: caller replicaCount wins in prd (R1)', () => {
    test('prd basic search with caller replicaCount: 1 keeps 1', async () => {
      const inputs = await deploy('prd', { sku: 'basic', replicaCount: 1 });

      expect(inputs.replicaCount).toBe(1);
    });

    test('prd basic search with caller replicaCount: 0 keeps 0', async () => {
      const inputs = await deploy('prd', { sku: 'basic', replicaCount: 0 });

      expect(inputs.replicaCount).toBe(0);
    });
  });
});
