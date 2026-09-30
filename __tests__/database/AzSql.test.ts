import { withStack, restoreStack } from '../testUtils/pulumiMocks';
import { captureResourceParents } from '../testUtils/pulumiParentSpy';

// DRK-1816 — AzSql vulnerability assessment defaults and retention (spec §5, scenarios S1–S7).
// Contract: PRD servers get Microsoft-managed (express) SQL vulnerability assessment plus an enabled
// server security alert policy with no storage account, unless the caller opts out; a caller's
// `vulnerabilityAssessment.retentionDays` reaches both policies unchanged.

const VA_SETTING = 'azure-native:sql:SqlVulnerabilityAssessmentsSetting';
const ALERT_POLICY = 'azure-native:sql:ServerSecurityAlertPolicy';
const AUDIT_POLICY = 'azure-native:sql:ExtendedServerBlobAuditingPolicy';
const CLASSIC_VA = 'azure-native:sql:ServerVulnerabilityAssessment';

const logStorage = { resourceName: 'stglogs', rsGroup: { resourceGroupName: 'rg' } };

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
  administrators: { azureAdOnlyAuthentication: true },
};

function setup(stack: 'prd' | 'dev') {
  let spy: ReturnType<typeof captureResourceParents> | undefined;
  const loaded = withStack(
    stack,
    (pulumi) => {
      // Patch the registry AzSql will load from (withStack has just reset the module registry).
      spy = captureResourceParents();
      const mod: typeof import('../../src/database/AzSql') = require('../../src/database/AzSql');
      return { pulumi, AzSql: mod.AzSql };
    },
    undefined,
    (args) =>
      args.token === 'azure-native:storage:listStorageAccountKeys' ? { keys: [{ value: 'stg-key' }] } : undefined,
  );
  return { ...loaded, spy: spy! };
}

describe('AzSql — vulnerability assessment defaults and retention', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  let restoreSpy: (() => void) | undefined;

  afterEach(() => {
    restoreSpy?.();
    restoreSpy = undefined;
    restoreStack(ORIGINAL_STACK);
  });

  async function build(stack: 'prd' | 'dev', vulnerabilityAssessment?: object) {
    const { pulumi, AzSql, captured, spy } = setup(stack);
    restoreSpy = spy.restore;

    const server = new AzSql('sql1', { ...baseArgs, vulnerabilityAssessment } as any);
    await pulumi.output(server.id).promise();
    // The policies are fire-and-forget children whose inputs wait on async invokes; let them settle.
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));

    // Counts come from the synchronous registration spy so an "exactly 0" cannot pass on a race;
    // input values come from the mock's captured inputs once they have resolved.
    const registered = (type: string) => spy.captured.filter((c) => c.type === type);
    const inputsOf = (type: string) => captured.filter((c) => c.type === type).map((c) => c.inputs);
    return { server, registered, inputsOf };
  }

  test('S1 PRD default turns on express VA and alerts, no storage', async () => {
    const { server, registered, inputsOf } = await build('prd');

    expect(registered(VA_SETTING)).toHaveLength(1);
    expect(registered(VA_SETTING)[0].parent).toBe(server);
    const [va] = inputsOf(VA_SETTING);
    expect(va.vulnerabilityAssessmentName).toBe('default');
    expect(va.state).toBe('Enabled');

    expect(registered(ALERT_POLICY)).toHaveLength(1);
    const [alert] = inputsOf(ALERT_POLICY);
    expect(alert.state).toBe('Enabled');
    expect(alert.retentionDays).toBe(30);
    expect(alert.storageEndpoint).toBeUndefined();
    expect(alert.storageAccountAccessKey).toBeUndefined();

    expect(registered(AUDIT_POLICY)).toHaveLength(0);
    expect(registered(CLASSIC_VA)).toHaveLength(0);
  });

  test('S2 non-PRD default creates nothing', async () => {
    const { registered } = await build('dev');

    expect(registered(VA_SETTING)).toHaveLength(0);
    expect(registered(ALERT_POLICY)).toHaveLength(0);
    expect(registered(AUDIT_POLICY)).toHaveLength(0);
    expect(registered(CLASSIC_VA)).toHaveLength(0);
  });

  test('S3 explicit opt-out in PRD', async () => {
    const { registered } = await build('prd', { enabled: false });

    expect(registered(VA_SETTING)).toHaveLength(0);
    expect(registered(ALERT_POLICY)).toHaveLength(0);
    expect(registered(AUDIT_POLICY)).toHaveLength(0);
    expect(registered(CLASSIC_VA)).toHaveLength(0);
  });

  test('S4 non-PRD block without storage', async () => {
    const { registered, inputsOf } = await build('dev', { alertEmails: ['sec@example.com'] });

    expect(registered(VA_SETTING)).toHaveLength(1);
    expect(inputsOf(VA_SETTING)[0].state).toBe('Enabled');

    expect(registered(ALERT_POLICY)).toHaveLength(1);
    const [alert] = inputsOf(ALERT_POLICY);
    expect(alert.retentionDays).toBe(7);
    expect(alert.emailAddresses).toEqual(['sec@example.com']);

    expect(registered(AUDIT_POLICY)).toHaveLength(0);
  });

  test('S5 storage opt-in adds audit, PRD retention default', async () => {
    const { registered, inputsOf } = await build('prd', { logStorage, alertEmails: ['sec@example.com'] });

    const [alert] = inputsOf(ALERT_POLICY);
    expect(alert.storageEndpoint).toBe('https://stglogs.blob.core.windows.net');
    expect(alert.storageAccountAccessKey).toBe('stg-key');
    expect(alert.retentionDays).toBe(30);

    expect(registered(AUDIT_POLICY)).toHaveLength(1);
    const [audit] = inputsOf(AUDIT_POLICY);
    expect(audit.retentionDays).toBe(30);
    expect(audit.storageEndpoint).toBe('https://stglogs.blob.core.windows.net');

    expect(registered(CLASSIC_VA)).toHaveLength(0);
  });

  test.each([90, 365, 0])('S6 caller retention %p reaches both policies unchanged', async (days) => {
    const { inputsOf } = await build('prd', { logStorage, retentionDays: days });

    expect(inputsOf(ALERT_POLICY)[0].retentionDays).toBe(days);
    expect(inputsOf(AUDIT_POLICY)[0].retentionDays).toBe(days);
  });

  test('S7 non-PRD retention default with storage', async () => {
    const { inputsOf } = await build('dev', { logStorage });

    expect(inputsOf(ALERT_POLICY)[0].retentionDays).toBe(7);
    expect(inputsOf(AUDIT_POLICY)[0].retentionDays).toBe(7);
  });
});
