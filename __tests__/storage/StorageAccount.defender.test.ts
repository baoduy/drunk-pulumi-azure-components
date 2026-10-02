import type { StorageAccountArgs } from '../../src/storage/StorageAccount';
import { withStack, restoreStack, settle } from '../testUtils/pulumiMocks';

/**
 * DRK-1922 row 2 — opt-in Defender for Storage (acceptance tests, DRK-1986).
 *
 * `defender.enabled` creates one `DefenderForStorage` setting (`current`) that overrides the subscription
 * level. Malware scanning stays off unless `defender.malwareScanning.enabled` is `true` (R4). Without the
 * input no setting is created in any env (R1); in prd that writes one warning and the account is still
 * created (R2); outside prd nothing is written (R3).
 *
 * `isPrd` is read once at module load, so every case reloads StorageAccount under an explicit stack name
 * through `withStack`.
 */

jest.setTimeout(30_000);

const STORAGE_TYPE = 'azure-native:storage:StorageAccount';
const DEFENDER_TYPE = 'azure-native:security:DefenderForStorage';

async function deploy(stackName: string, extra: Partial<StorageAccountArgs> = {}) {
  const { pulumi, StorageAccount, captured } = withStack(stackName, (p) => ({
    pulumi: p,
    StorageAccount: require('../../src/storage/StorageAccount').StorageAccount,
  }));
  const warn = jest.spyOn(pulumi.log, 'warn').mockImplementation(() => undefined);

  const args: StorageAccountArgs = { rsGroup: { resourceGroupName: 'rg', location: 'eastus' }, ...extra };
  const sa = new StorageAccount('stgdefender', args);
  await settle(pulumi, sa.id);

  const byType = (type: string) => captured.filter((c) => c.type === type);
  // Warnings that name this account and the given input.
  const warningsFor = (input: string) =>
    warn.mock.calls
      .map((call) => String(call[0]))
      .filter((m) => m.includes('StorageAccount') && m.includes('stgdefender') && m.includes(input));
  return { byType, warn, warningsFor };
}

describe('StorageAccount — opt-in Defender for Storage', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  let logSpy: jest.SpyInstance;
  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    restoreStack(ORIGINAL_STACK);
  });

  describe('defender.enabled creates one Defender setting on the account', () => {
    test.each(['prd', 'dev'])(
      '%s: defender on registers DefenderForStorage "current" for the account',
      async (stack) => {
        const { byType } = await deploy(stack, { defender: { enabled: true } });

        const settings = byType(DEFENDER_TYPE);
        expect(settings).toHaveLength(1);
        const inputs = settings[0].inputs;
        expect(inputs.resourceId).toBe('stgdefender_id');
        expect(inputs.settingName).toBe('current');
        expect(inputs.properties.isEnabled).toBe(true);
        expect(inputs.properties.overrideSubscriptionLevelSettings).toBe(true);
      },
    );

    test('malware scanning is off when Defender is on and malware scanning is not asked for (R4)', async () => {
      const { byType } = await deploy('dev', { defender: { enabled: true } });

      expect(byType(DEFENDER_TYPE)[0].inputs.properties.malwareScanning.onUpload.isEnabled).toBe(false);
    });

    test('malware scanning is on with the cap the engineer set', async () => {
      const { byType } = await deploy('dev', {
        defender: { enabled: true, malwareScanning: { enabled: true, capGBPerMonth: 5000 } },
      });

      expect(byType(DEFENDER_TYPE)[0].inputs.properties.malwareScanning.onUpload).toEqual({
        isEnabled: true,
        capGBPerMonth: 5000,
      });
    });

    test('malware scanning stays off when the engineer turned it off explicitly (R4, R6)', async () => {
      const { byType } = await deploy('dev', { defender: { enabled: true, malwareScanning: { enabled: false } } });

      expect(byType(DEFENDER_TYPE)[0].inputs.properties.malwareScanning.onUpload.isEnabled).toBe(false);
    });
  });

  describe('no Defender setting without the input (R1)', () => {
    test.each(['prd', 'dev'])('%s: no defender input means no DefenderForStorage', async (stack) => {
      const { byType } = await deploy(stack);

      expect(byType(STORAGE_TYPE)).toHaveLength(1);
      expect(byType(DEFENDER_TYPE)).toHaveLength(0);
    });

    test('defender.enabled false means no DefenderForStorage', async () => {
      const { byType } = await deploy('dev', { defender: { enabled: false } });

      expect(byType(DEFENDER_TYPE)).toHaveLength(0);
    });
  });

  describe('prd warns once per missing protection and still creates the account (R2)', () => {
    test('prd without defender writes one warning naming the account and the defender input', async () => {
      const { byType, warningsFor } = await deploy('prd');

      expect(warningsFor('defender')).toHaveLength(1);
      expect(byType(STORAGE_TYPE)).toHaveLength(1);
    });

    test('prd with defender.enabled false writes the same warning', async () => {
      const { warningsFor } = await deploy('prd', { defender: { enabled: false } });

      expect(warningsFor('defender')).toHaveLength(1);
    });

    test('prd with Defender on but no malware scanning writes one warning naming defender.malwareScanning', async () => {
      const { byType, warningsFor } = await deploy('prd', { defender: { enabled: true } });

      expect(warningsFor('defender.malwareScanning')).toHaveLength(1);
      expect(byType(DEFENDER_TYPE)).toHaveLength(1);
    });

    test('prd with Defender and malware scanning on writes no warning', async () => {
      const { warn } = await deploy('prd', { defender: { enabled: true, malwareScanning: { enabled: true } } });

      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe('outside prd nothing is written (R3)', () => {
    test('dev without defender writes no warning', async () => {
      const { warn } = await deploy('dev');

      expect(warn).not.toHaveBeenCalled();
    });

    test('dev with Defender on but no malware scanning writes no warning', async () => {
      const { warn } = await deploy('dev', { defender: { enabled: true } });

      expect(warn).not.toHaveBeenCalled();
    });
  });
});
