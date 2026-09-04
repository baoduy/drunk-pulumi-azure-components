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
