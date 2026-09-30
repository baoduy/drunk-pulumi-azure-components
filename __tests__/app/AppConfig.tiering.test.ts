import type { AppConfigArgs } from '../../src/app/AppConfig';
import { withStack, restoreStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1822 S3 — AppConfig caller `sku` (acceptance tests, DRK-1863).
 *
 * `AppConfigArgs` accepts an optional `sku`; a caller value is sent verbatim in any env.
 * Without one the store stays on `Standard` in every env — the spec's non-PRD `free` default is
 * held (brief §9 Q3: Azure does not support downgrading an existing store to Free).
 *
 * `isPrd` is read once at module load, so every case reloads AppConfig under an explicit stack name
 * through `withStack`.
 */

// Each case reloads the pulumi module graph; under a parallel full run that can exceed jest's 5 s default.
jest.setTimeout(30_000);

const STORE_TYPE = 'azure-native:appconfiguration:ConfigurationStore';

async function deploy(stackName: string, extra: Partial<AppConfigArgs> = {}) {
  const { pulumi, AppConfig, captured } = withStack(
    stackName,
    (p) => ({ pulumi: p, AppConfig: require('../../src/app/AppConfig').AppConfig }),
    // PrivateEndpoint reads customDnsConfigs[].ipAddresses back off its own resource state.
    (args) =>
      args.type === 'azure-native:network:PrivateEndpoint' ? { customDnsConfigs: [{ ipAddresses: ['10.0.0.4'] }] } : {},
  );

  // The prd network guard (PULUMI-SEC-006) only accepts a private-link-only AppConfig in prd.
  const network: AppConfigArgs['network'] =
    stackName === 'prd' ? { privateLink: { subnetInfo: { subnetId: 'pe-subnet' } } } : undefined;
  const args: AppConfigArgs = { rsGroup: { resourceGroupName: 'rg', location: 'eastus' }, network, ...extra };
  const store = new AppConfig('appcfg-tier', args);
  await pulumi.output(store.id).promise();
  // Let the store settle before the next `withStack` swaps the mock monitor.
  await new Promise((resolve) => setTimeout(resolve, 50));

  return captured.find((c) => c.type === STORE_TYPE)!.inputs;
}

describe('AppConfig — caller sku, Standard by default in every env', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  describe("S6: caller sku: 'developer' is sent verbatim (R1)", () => {
    test.each(['prd', 'dev'])('%s store uses the developer sku', async (stackName) => {
      const inputs = await deploy(stackName, { sku: 'developer' });

      expect(inputs.sku).toEqual({ name: 'developer' });
    });
  });

  describe('S7: no caller sku defaults to Standard (R4)', () => {
    test.each(['prd', 'dev'])('%s store uses the Standard sku', async (stackName) => {
      const inputs = await deploy(stackName);

      expect(inputs.sku).toEqual({ name: 'Standard' });
    });
  });
});
