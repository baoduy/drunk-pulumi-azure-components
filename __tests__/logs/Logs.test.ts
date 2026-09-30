import { withStack, restoreStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1073 / D1073-2: Logs.createStorage() forwards `storage.allowSharedKeyAccess` to
 * StorageAccount, which derives `defaultToOAuthAuthentication: !props.allowSharedKeyAccess`
 * (src/storage/StorageAccount.ts:89). The security outcome is that derived flag on the
 * created azure-native storage account, not the input prop echoed back — so every scenario
 * below asserts both `allowSharedKeyAccess` and `defaultToOAuthAuthentication` on the
 * captured `azure-native:storage:StorageAccount` resource.
 */

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg' },
};

function createLogs(Logs: typeof import('../../src/logs/Logs').Logs, props: any = {}) {
  return new Logs('logs1', { ...baseArgs, ...props } as any);
}

function storageAccount(captured: { type: string; name: string; inputs: any }[]) {
  return captured.find((c) => c.type === 'azure-native:storage:StorageAccount');
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('Logs.createStorage — log-archive storage shared-key toggle (DRK-1073)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('storage omitted creates no storage account at all', async () => {
    const { pulumi, Logs, captured } = withStack('dev', (p) => {
      const mod: typeof import('../../src/logs/Logs') = require('../../src/logs/Logs');
      return { pulumi: p, Logs: mod.Logs };
    });

    const logs = createLogs(Logs);
    await pulumi.output(logs.getOutputs()).promise();
    await settle();

    expect(storageAccount(captured)).toBeUndefined();
  });

  test.each([
    ['no allowSharedKeyAccess override stays byte-identical to the pre-change default', { enabled: true }, true, false],
    ['explicit allowSharedKeyAccess: true behaves the same as the default', { enabled: true, allowSharedKeyAccess: true }, true, false],
    [
      'explicit allowSharedKeyAccess: false survives to the created storage account and flips OAuth-only default on',
      { enabled: true, allowSharedKeyAccess: false },
      false,
      true,
    ],
  ])('storage enabled: %s', async (_name, storage, expectedSharedKey, expectedOAuth) => {
    const { pulumi, Logs, captured } = withStack('dev', (p) => {
      const mod: typeof import('../../src/logs/Logs') = require('../../src/logs/Logs');
      return { pulumi: p, Logs: mod.Logs };
    });

    const logs = createLogs(Logs, { storage });
    await pulumi.output(logs.getOutputs()).promise();
    await settle();

    const stg = storageAccount(captured);
    expect(stg).toBeDefined();
    expect(stg!.inputs.allowSharedKeyAccess).toBe(expectedSharedKey);
    expect(stg!.inputs.defaultToOAuthAuthentication).toBe(expectedOAuth);
  });
});

// Pre-existing behaviour, untouched by DRK-1073, but Logs.ts is a touched class this
// cycle (createStorage above) so the sibling workspace/appInsight constructor branches
// need coverage too — the coverage gate is per touched class, not per changed line.
describe('Logs — workspace and appInsight outputs (pre-existing behaviour)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  // Workspace.customerId and Component.instrumentationKey/connectionString are
  // server-assigned outputs, not echoed inputs — the shared withStack mock doesn't
  // fabricate them, so this setup adds them for the two resource types that need them.
  function setup() {
    return withStack(
      'dev',
      (pulumi) => {
        const mod: typeof import('../../src/logs/Logs') = require('../../src/logs/Logs');
        return { pulumi, Logs: mod.Logs };
      },
      (args) =>
        args.type === 'azure-native:operationalinsights:Workspace'
          ? { customerId: `${args.name}-customer-id` }
          : args.type === 'azure-native:applicationinsights:Component'
            ? { instrumentationKey: `${args.name}-ikey`, connectionString: `${args.name}-conn` }
            : {},
    );
  }

  test('workspace enabled exposes workspace outputs and queues the customerId secret', async () => {
    const { pulumi, Logs, captured } = setup();

    const logs = createLogs(Logs, { workspace: { enabled: true } });
    await pulumi.output(logs.getOutputs()).promise();
    await settle();

    expect(captured.find((c) => c.type === 'azure-native:operationalinsights:Workspace')).toBeDefined();
    expect(logs.workspace).toBeDefined();
    const customerId = await pulumi.output(logs.workspace!.customerId).promise();
    expect(customerId).toBe('logs1-wp-customer-id');
  });

  test('workspace + appInsight both enabled exposes appInsight outputs wired to the workspace', async () => {
    const { pulumi, Logs, captured } = setup();

    const logs = createLogs(Logs, { workspace: { enabled: true, appInsightEnabled: true } });
    await pulumi.output(logs.getOutputs()).promise();
    await settle();

    const ais = captured.find((c) => c.type === 'azure-native:applicationinsights:Component');
    expect(ais).toBeDefined();
    expect(logs.appInsight).toBeDefined();
    const key = await pulumi.output(logs.appInsight!.instrumentationKey).promise();
    expect(key).toBe('logs1-ais-ikey');
  });
});

/**
 * DRK-1822 S3 — Log Analytics workspace environment tiering (acceptance tests, DRK-1863).
 *
 * PRD workspaces default to `PerGB2018` with an explicit unlimited cap (`-1`), so ingestion never
 * stops mid-day and an existing 0.1 GB/day cap is lifted. Non-PRD keeps the cheap defaults: `Free`
 * (no capping, 7-day retention), and a paid SKU without a quota is capped at 0.1 GB/day.
 * A caller `sku` / `dailyQuotaGb` always wins — a caller `0` is a value.
 */
describe('Logs.createWorkspace — PRD PerGB2018 uncapped, non-PRD cheap defaults (DRK-1822)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  async function deployWorkspace(stackName: string, workspace: Record<string, unknown>) {
    const { pulumi, Logs, captured } = withStack(
      stackName,
      (p) => {
        const mod: typeof import('../../src/logs/Logs') = require('../../src/logs/Logs');
        return { pulumi: p, Logs: mod.Logs };
      },
      (args) =>
        args.type === 'azure-native:operationalinsights:Workspace' ? { customerId: `${args.name}-customer-id` } : {},
    );

    const logs = createLogs(Logs, { workspace });
    await pulumi.output(logs.getOutputs()).promise();
    await settle();

    return captured.find((c) => c.type === 'azure-native:operationalinsights:Workspace')!.inputs;
  }

  test('S3: prd workspace with no caller sku is PerGB2018, uncapped (-1), 30-day retention (R3)', async () => {
    const inputs = await deployWorkspace('prd', { enabled: true });

    expect(inputs.sku).toEqual({ name: 'PerGB2018' });
    expect(inputs.workspaceCapping).toEqual({ dailyQuotaGb: -1 });
    expect(inputs.retentionInDays).toBe(30);
  });

  describe('S4: non-PRD keeps the cheap defaults (R3)', () => {
    test('dev workspace with no caller sku is Free, no capping, 7-day retention', async () => {
      const inputs = await deployWorkspace('dev', { enabled: true });

      expect(inputs.sku).toEqual({ name: 'Free' });
      expect(inputs.workspaceCapping).toBeUndefined();
      expect(inputs.retentionInDays).toBe(7);
    });

    test('dev PerGB2018 workspace without a quota is capped at 0.1 GB/day', async () => {
      const inputs = await deployWorkspace('dev', { enabled: true, sku: 'PerGB2018' });

      expect(inputs.sku).toEqual({ name: 'PerGB2018' });
      expect(inputs.workspaceCapping).toEqual({ dailyQuotaGb: 0.1 });
    });
  });

  describe('S5: caller sku / dailyQuotaGb win in prd (R1)', () => {
    test('prd workspace with caller dailyQuotaGb: 5 is capped at 5', async () => {
      const inputs = await deployWorkspace('prd', { enabled: true, dailyQuotaGb: 5 });

      expect(inputs.workspaceCapping).toEqual({ dailyQuotaGb: 5 });
    });

    test('prd workspace with caller dailyQuotaGb: 0 is capped at 0', async () => {
      const inputs = await deployWorkspace('prd', { enabled: true, dailyQuotaGb: 0 });

      expect(inputs.workspaceCapping).toEqual({ dailyQuotaGb: 0 });
    });

    test('prd workspace with caller sku: Free stays Free with no capping', async () => {
      const inputs = await deployWorkspace('prd', { enabled: true, sku: 'Free' });

      expect(inputs.sku).toEqual({ name: 'Free' });
      expect(inputs.workspaceCapping).toBeUndefined();
    });
  });
});
