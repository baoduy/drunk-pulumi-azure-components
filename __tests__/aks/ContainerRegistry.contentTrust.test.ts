import { withStack, restoreStack } from '../testUtils/pulumiMocks';
import type { ContainerRegistryArgs } from '../../src/aks/ContainerRegistry';

/**
 * DRK-1824 (PULUMI-DEP-001): Azure Container Registry retires Docker Content Trust on 2028-03-31.
 * A Premium registry no longer turns DCT on by default; callers opt in with the deprecated
 * `enableContentTrust` arg. Every other Premium policy default stays as it is.
 *
 * Expected values are the wire literals the azure-native SDK sends for these policies: `'enabled'` /
 * `'disabled'` (lowercase) for every policy status and `'Notary'` for the trust policy type.
 */

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
};

async function registryInputs(props: Partial<ContainerRegistryArgs> & Pick<ContainerRegistryArgs, 'sku'>) {
  const { pulumi, ContainerRegistry, captured } = withStack('dev', (p) => {
    const mod: typeof import('../../src/aks/ContainerRegistry') = require('../../src/aks/ContainerRegistry');
    return { pulumi: p, ContainerRegistry: mod.ContainerRegistry };
  });

  const acr = new ContainerRegistry('acr1', { ...baseArgs, ...props } as ContainerRegistryArgs);
  await pulumi.output(acr.id).promise();
  const found = captured.filter((c) => c.type === 'azure-native:containerregistry:Registry');
  expect(found).toHaveLength(1);
  return found[0].inputs;
}

describe('DRK-1824 ContainerRegistry — Docker Content Trust is an explicit, deprecated opt-in', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('S1 a Premium registry with no content-trust flag gets the trust policy Disabled', async () => {
    const inputs = await registryInputs({ sku: 'Premium' });
    expect(inputs.policies.trustPolicy).toEqual({ status: 'disabled', type: 'Notary' });
  });

  test('S1 a Premium registry with enableContentTrust false gets the trust policy Disabled', async () => {
    const inputs = await registryInputs({ sku: 'Premium', enableContentTrust: false });
    expect(inputs.policies.trustPolicy).toEqual({ status: 'disabled', type: 'Notary' });
  });

  test('S2 a Premium registry with enableContentTrust true gets the trust policy Enabled with type Notary', async () => {
    const inputs = await registryInputs({ sku: 'Premium', enableContentTrust: true });
    expect(inputs.policies.trustPolicy).toEqual({ status: 'enabled', type: 'Notary' });
  });

  test('S3 a Premium registry keeps export Disabled, quarantine Enabled and retention Enabled at 90 days', async () => {
    const inputs = await registryInputs({ sku: 'Premium' });
    expect(inputs.policies.exportPolicy).toEqual({ status: 'disabled' });
    expect(inputs.policies.quarantinePolicy).toEqual({ status: 'enabled' });
    expect(inputs.policies.retentionPolicy).toEqual({ status: 'enabled', days: 90 });
  });

  test("S3 a Premium registry keeps the caller's retentionDaysPolicy", async () => {
    const inputs = await registryInputs({ sku: 'Premium', retentionDaysPolicy: 30 });
    expect(inputs.policies.retentionPolicy).toEqual({ status: 'enabled', days: 30 });
  });

  test.each([true, false])(
    'S4 the Registry inputs carry no enableContentTrust key when the flag is %s',
    async (enableContentTrust) => {
      const inputs = await registryInputs({ sku: 'Premium', enableContentTrust });
      expect(inputs).not.toHaveProperty('enableContentTrust');
    },
  );

  test.each(['Basic', 'Standard'] as const)(
    'S5 a %s registry with enableContentTrust true gets no policies',
    async (sku) => {
      const inputs = await registryInputs({ sku, enableContentTrust: true });
      expect(inputs.policies).toBeUndefined();
    },
  );
});
