import { withStack, settle, quietStackHooks } from '../testUtils/pulumiMocks';

/**
 * DRK-1922 Build addition (review S2): Azure rejects replicas on the `free` and `developer` SKUs, so they are
 * skipped with one warning, whatever the case of the SKU name. Nothing throws and the store is still created.
 */
async function deploy(sku: string) {
  const { pulumi, AppConfig, captured } = withStack('dev', (p) => ({
    pulumi: p,
    AppConfig: require('../../src/app/AppConfig').AppConfig,
  }));
  const warn = jest.spyOn(pulumi.log, 'warn').mockImplementation(() => undefined);

  const store = new AppConfig('appcfg-sku', {
    rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
    sku,
    replicaLocations: ['southeastasia'],
  });
  await settle(pulumi, store.id);

  const byType = (type: string) => captured.filter((c) => c.type === type);
  return { byType, warnings: warn.mock.calls.map((call) => String(call[0])) };
}

describe('AppConfig — replicas on a SKU that cannot have them', () => {
  quietStackHooks();

  test.each(['free', 'Developer'])('the %s SKU skips the replicas and writes one warning', async (sku) => {
    const { byType, warnings } = await deploy(sku);

    expect(byType('azure-native:appconfiguration:ConfigurationStore')).toHaveLength(1);
    expect(byType('azure-native:appconfiguration:Replica')).toHaveLength(0);
    expect(warnings).toEqual([
      `AppConfig 'appcfg-sku' is on the ${sku} SKU, so \`replicaLocations\` is skipped. Use the Standard or Premium SKU.`,
    ]);
  });

  test('the Premium SKU keeps the replicas and writes no warning', async () => {
    const { byType, warnings } = await deploy('Premium');

    expect(byType('azure-native:appconfiguration:Replica')).toHaveLength(1);
    expect(warnings).toEqual([]);
  });
});
