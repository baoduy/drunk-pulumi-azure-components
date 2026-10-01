import { Captured, mockAksFetch, restoreStack, settle, withStack } from '../testUtils/pulumiMocks';

// Each case reloads a component's module graph through `withStack`; AKS and SQL can exceed Jest's 5 s default.
jest.setTimeout(30000);

/**
 * DRK-1980 §5 — Feature: Resource logs sent to the destinations a stack names.
 *
 * One test per spec scenario, named verbatim; Scenario Outlines run their Examples rows through `test.each`.
 * Sources of the expected values:
 * - log categories and resource names: the spec's §3 log table and §5 Examples, verbatim;
 * - SQL audit fields (`state`, `isAzureMonitorTargetEnabled`, `isDevopsAuditEnabled`, storage fields): brief rule R5;
 * - the "no destination" resource-type lists: what each component registered before this change (R1 baseline);
 * - `https://stauditprd01.blob.core.windows.net`: the blob endpoint the package derives for an assessment storage;
 * - target resource ids: the mock monitor's `${pulumiResourceName}_id` convention, so `kv-prd-01_id` is the vault
 *   `kv-prd-01`.
 * Scenarios named `*-prd-*` run on a prd stack, `*-dev-*` on a dev stack.
 */

const DIAGNOSTIC_SETTING = 'azure-native:monitor:DiagnosticSetting';
const AUDIT_POLICY = 'azure-native:sql:ExtendedServerBlobAuditingPolicy';
const FIREWALL = 'azure-native:network:AzureFirewall';
const FIREWALL_POLICY = 'azure-native:network:FirewallPolicy';
const MANAGED_CLUSTER = 'azure-native:containerservice:ManagedCluster';

const workspace = (name: string) => ({
  resourceGroupName: 'rg-logs',
  resourceName: name,
  id: `/subscriptions/sub/resourceGroups/rg-logs/providers/Microsoft.OperationalInsights/workspaces/${name}`,
});
const storageAccount = (name: string) => ({
  resourceGroupName: 'rg-logs',
  resourceName: name,
  id: `/subscriptions/sub/resourceGroups/rg-logs/providers/Microsoft.Storage/storageAccounts/${name}`,
});

const LOG_PRD_01 = workspace('log-prd-01');
const LOG_DEV_01 = workspace('log-dev-01');
const ST_LOG_PRD_01 = storageAccount('stlogprd01');
const ST_AUDIT_PRD_01 = {
  resourceGroupName: 'rg-audit',
  resourceName: 'stauditprd01',
  id: '/subscriptions/sub/resourceGroups/rg-audit/providers/Microsoft.Storage/storageAccounts/stauditprd01',
  rsGroup: { resourceGroupName: 'rg-audit' },
};

const rsGroup = { resourceGroupName: 'rg', location: 'eastus' };

type Component =
  'Key Vault' | 'Storage account' | 'SQL server' | 'AKS cluster' | 'Firewall' | 'Service Bus' | 'API gateway';

// The minimum valid args per component. Key Vault and Service Bus carry an IP rule because a prd stack
// refuses an unrestricted one (src/helpers/networkGuard.ts).
const COMPONENTS: Record<Component, { path: string; ctor: string; args: object }> = {
  'Key Vault': { path: '../../src/vault/KeyVault', ctor: 'KeyVault', args: { network: { ipRules: ['1.2.3.4'] } } },
  'Storage account': { path: '../../src/storage/StorageAccount', ctor: 'StorageAccount', args: {} },
  'SQL server': {
    path: '../../src/database/AzSql',
    ctor: 'AzSql',
    args: { administrators: { azureAdOnlyAuthentication: true } },
  },
  'AKS cluster': {
    path: '../../src/aks/AzKubernetes',
    ctor: 'AzKubernetes',
    args: {
      sku: { name: 'Base' },
      features: { enablePrivateCluster: false },
      agentPoolProfiles: [
        { name: 'system', vnetSubnetID: 'subnet_id', enableEncryptionAtHost: false, osDiskSizeGB: 128 },
      ],
    },
  },
  Firewall: {
    path: '../../src/vnet/Firewall',
    ctor: 'Firewall',
    args: { sku: { name: 'AZFW_VNet', tier: 'Standard' }, policy: {} },
  },
  'Service Bus': {
    path: '../../src/services/ServiceBus',
    ctor: 'ServiceBus',
    args: { sku: { name: 'Standard' }, disableLocalAuth: true, network: { ipRules: ['1.2.3.4'] } },
  },
  'API gateway': {
    path: '../../src/apim/Apim',
    ctor: 'Apim',
    args: { sku: { name: 'Developer', capacity: 1 }, disableSignIn: true, publisherName: 'drunkcoding' },
  },
};

// State the components read back from their deployed resources (same values as the existing Firewall and AKS tests).
const extraState = ({ type }: { type: string }) =>
  type === FIREWALL
    ? { ipConfigurations: [{ privateIPAddress: '10.0.1.4' }] }
    : type === MANAGED_CLUSTER
      ? {
          addonProfiles: {
            azureKeyvaultSecretsProvider: {
              identity: { resourceId: 'kv_identity_id', clientId: 'kv_client', objectId: 'kv_object' },
            },
          },
          oidcIssuerProfile: { issuerURL: 'https://issuer.example.com' },
        }
      : {};

// SQL's assessment storage key is read through this invoke.
const extraCall = ({ token }: { token: string }) =>
  token === 'azure-native:storage:listStorageAccountKeys' ? { keys: [{ value: 'stg-key' }] } : undefined;

/** Deploys one component on the given stack and returns every resource the stack registered. */
async function deploy(stack: 'prd' | 'dev', component: Component, name: string, props: object = {}) {
  const { path, ctor, args } = COMPONENTS[component];
  const { pulumi, Ctor, captured } = withStack(
    stack,
    (p) => ({ pulumi: p, Ctor: require(path)[ctor] }),
    extraState,
    extraCall,
  );
  const resource = new Ctor(name, { rsGroup, ...args, ...props });
  await settle(pulumi, resource.id);
  if (resource.kubeletIdentity) await pulumi.output(resource.kubeletIdentity).promise();
  if (resource.systemIdentityId) await pulumi.output(resource.systemIdentityId).promise();
  // Let fire-and-forget children settle before the next `withStack` swaps the mock monitor.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return captured;
}

const ofType = (captured: Captured[], type: string) => captured.filter((c) => c.type === type);
const diagnosticSettings = (captured: Captured[]) => ofType(captured, DIAGNOSTIC_SETTING).map((c) => c.inputs);

/** The one diagnostic setting on `resourceUri`; fails on zero or several. */
function settingOn(captured: Captured[], resourceUri: string) {
  const found = diagnosticSettings(captured).filter((s) => s.resourceUri === resourceUri);
  expect(found).toHaveLength(1);
  return found[0];
}

/** The setting sends exactly `categories` as enabled logs, by category name, never a group, and no metrics. */
function expectOnlyLogs(setting: any, categories: string[]) {
  expect(setting.logs.map((l: any) => l.category).sort()).toEqual([...categories].sort());
  for (const log of setting.logs) {
    expect(log.enabled).toBe(true);
    expect(log.categoryGroup).toBeUndefined();
  }
  expect(setting.metrics).toBeUndefined();
}

const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
let restoreFetch: () => void;
beforeAll(() => {
  // AzKubernetes fetches its kubelet identity from the Azure management API.
  restoreFetch = mockAksFetch();
});
afterAll(() => restoreFetch());
// Each fresh `@pulumi/pulumi` copy that `withStack` loads adds a process `exit` listener; drop the ones a case added.
let exitListeners: Function[] = [];
let logSpy: jest.SpyInstance;
beforeEach(() => {
  exitListeners = process.listeners('exit');
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  logSpy.mockRestore();
  restoreStack(ORIGINAL_STACK);
  for (const listener of process.listeners('exit')) {
    if (!exitListeners.includes(listener)) process.removeListener('exit', listener as (code: number) => void);
  }
});

describe('Feature: Resource logs sent to the destinations a stack names', () => {
  test('Scenario: A Key Vault with a workspace sends its audit logs there', async () => {
    const captured = await deploy('prd', 'Key Vault', 'kv-prd-01', { logWorkspace: LOG_PRD_01 });

    const setting = settingOn(captured, 'kv-prd-01_id');
    expect(setting.workspaceId).toBe(LOG_PRD_01.id);
    expectOnlyLogs(setting, ['AuditEvent']);
  });

  test.each<[Component, string, string[], object]>([
    ['Key Vault', 'kv-prd-01', ['AuditEvent'], {}],
    ['AKS cluster', 'aks-prd-01', ['kube-audit-admin', 'guard', 'cluster-autoscaler'], {}],
    [
      'Firewall',
      'fw-hub-prd',
      ['AZFWNetworkRule', 'AZFWApplicationRule', 'AZFWNatRule', 'AZFWThreatIntel', 'AZFWIdpsSignature'],
      {},
    ],
    ['API gateway', 'apim-prd-01', ['GatewayLogs'], {}],
    ['Service Bus', 'sb-std-01', ['OperationalLogs', 'VNetAndIPFilteringLogs'], { sku: { name: 'Standard' } }],
  ])('Scenario Outline: Each component sends only its listed logs — %s "%s"', async (component, name, logs, props) => {
    const captured = await deploy('prd', component, name, { ...props, logWorkspace: LOG_PRD_01 });

    expect(diagnosticSettings(captured)).toHaveLength(1);
    const setting = settingOn(captured, `${name}_id`);
    expect(setting.workspaceId).toBe(LOG_PRD_01.id);
    expectOnlyLogs(setting, logs);
  });

  test('Scenario: Both destinations receive the same logs', async () => {
    const captured = await deploy('prd', 'Service Bus', 'sb-prd-01', {
      sku: { name: 'Premium' },
      logWorkspace: LOG_PRD_01,
      logStorage: ST_LOG_PRD_01,
    });

    // One setting carries both destinations, so both receive the same logs.
    expect(diagnosticSettings(captured)).toHaveLength(1);
    const setting = settingOn(captured, 'sb-prd-01_id');
    expect(setting.workspaceId).toBe(LOG_PRD_01.id);
    expect(setting.storageAccountId).toBe(ST_LOG_PRD_01.id);
    expectOnlyLogs(setting, ['OperationalLogs', 'VNetAndIPFilteringLogs', 'RuntimeAuditLogs']);
  });

  // The resource types each component registers today with no destination (pre-change baseline, sorted).
  test.each<[Component, string, string[]]>([
    ['Key Vault', 'kv-dev-01', ['azure-native:keyvault:Vault', 'drunk:azure:KeyVault']],
    [
      'Storage account',
      'stdev01',
      [
        'azure-native:storage:BlobServiceProperties',
        'azure-native:storage:StorageAccount',
        'drunk:azure:StorageAccount',
      ],
    ],
    [
      'SQL server',
      'sql-dev-01',
      [
        'azure-native:sql:Server',
        'azuread:index/group:Group',
        'drunk:azure:AzRole',
        'drunk:azure:AzSql',
        'drunk:azure:RandomPassword',
        'drunk:azure:RandomString',
        'random:index/randomPassword:RandomPassword',
        'random:index/randomString:RandomString',
      ],
    ],
    [
      'AKS cluster',
      'aks-dev-01',
      [
        'azure-native:authorization:RoleAssignment',
        'azure-native:containerservice:MaintenanceConfiguration',
        'azure-native:containerservice:MaintenanceConfiguration',
        'azure-native:containerservice:MaintenanceConfiguration',
        'azure-native:containerservice:ManagedCluster',
        'azuread:index/application:Application',
        'azuread:index/applicationPassword:ApplicationPassword',
        'azuread:index/group:Group',
        'azuread:index/servicePrincipal:ServicePrincipal',
        'azuread:index/servicePrincipalPassword:ServicePrincipalPassword',
        'drunk:azure:AppRegistration',
        'drunk:azure:AzKubernetes',
        'drunk:azure:AzRole',
        'drunk:azure:RandomPassword',
        'drunk:azure:RandomString',
        'drunk:azure:RoleAssignment',
        'drunk:azure:SshGenerator',
        'pulumi-nodejs:dynamic:Resource',
        'random:index/randomPassword:RandomPassword',
        'random:index/randomString:RandomString',
      ],
    ],
    [
      'Firewall',
      'fw-hub-dev',
      ['azure-native:network:AzureFirewall', 'azure-native:network:FirewallPolicy', 'drunk:azure:Firewall'],
    ],
    [
      'Service Bus',
      'sb-dev-01',
      [
        'azure-native:servicebus:Namespace',
        'azure-native:servicebus:NamespaceNetworkRuleSet',
        'drunk:azure:ServiceBus',
      ],
    ],
    ['API gateway', 'apim-dev-01', ['azure-native:apimanagement:ApiManagementService', 'drunk:azure:Apim']],
  ])('Scenario Outline: No destination means no diagnostic setting — %s "%s"', async (component, name, before) => {
    const captured = await deploy('dev', component, name);

    expect(diagnosticSettings(captured)).toHaveLength(0);
    expect(captured.map((c) => c.type).sort()).toEqual(before);
  });

  test('Scenario: A storage account alone receives the logs', async () => {
    const captured = await deploy('prd', 'Key Vault', 'kv-prd-02', { logStorage: ST_LOG_PRD_01 });

    const setting = settingOn(captured, 'kv-prd-02_id');
    expect(setting.storageAccountId).toBe(ST_LOG_PRD_01.id);
    expect(setting.workspaceId).toBeUndefined();
    expectOnlyLogs(setting, ['AuditEvent']);
  });

  test('Scenario: A dev stack with a destination gets the same logging as PRD', async () => {
    const captured = await deploy('dev', 'Key Vault', 'kv-dev-01', { logWorkspace: LOG_DEV_01 });

    const setting = settingOn(captured, 'kv-dev-01_id');
    expect(setting.workspaceId).toBe(LOG_DEV_01.id);
    expectOnlyLogs(setting, ['AuditEvent']);
  });

  test('Scenario: A storage account logs each of its four services', async () => {
    const captured = await deploy('prd', 'Storage account', 'stappprd01', { logWorkspace: LOG_PRD_01 });

    expect(diagnosticSettings(captured)).toHaveLength(4);
    for (const service of ['blobServices', 'fileServices', 'queueServices', 'tableServices']) {
      const setting = settingOn(captured, `stappprd01_id/${service}/default`);
      expect(setting.workspaceId).toBe(LOG_PRD_01.id);
      expectOnlyLogs(setting, ['StorageWrite', 'StorageDelete']);
    }
    // No read logs, and nothing on the account itself.
    const categories = diagnosticSettings(captured).flatMap((s) => s.logs.map((l: any) => l.category));
    expect(categories).not.toContain('StorageRead');
    expect(diagnosticSettings(captured).filter((s) => s.resourceUri === 'stappprd01_id')).toHaveLength(0);
  });

  test("Scenario: SQL sends the server audit and each database's error logs", async () => {
    const captured = await deploy('prd', 'SQL server', 'sql-prd-01', {
      databases: { orders: {} },
      logWorkspace: LOG_PRD_01,
    });

    expect(diagnosticSettings(captured)).toHaveLength(2);
    const server = settingOn(captured, 'sql-prd-01_id/databases/master');
    expect(server.workspaceId).toBe(LOG_PRD_01.id);
    expectOnlyLogs(server, ['SQLSecurityAuditEvents', 'DevOpsOperationsAudit']);

    const orders = settingOn(captured, 'sql-prd-01-orders_id');
    expect(orders.workspaceId).toBe(LOG_PRD_01.id);
    expectOnlyLogs(orders, ['Errors', 'Timeouts', 'Deadlocks']);

    // The audit events only exist when the server audit runs and targets Azure Monitor.
    const audits = ofType(captured, AUDIT_POLICY);
    expect(audits).toHaveLength(1);
    expect(audits[0].name).toBe('sql-prd-01-audit');
    expect(audits[0].inputs.state).toBe('Enabled');
    expect(audits[0].inputs.isAzureMonitorTargetEnabled).toBe(true);
    expect(audits[0].inputs.isDevopsAuditEnabled).toBe(true);
  });

  test('Scenario: A SQL server with no audit today gets one when given a destination', async () => {
    // Given the dev SQL server "sql-dev-01" has no server audit
    const before = await deploy('dev', 'SQL server', 'sql-dev-01');
    expect(ofType(before, AUDIT_POLICY)).toHaveLength(0);

    const captured = await deploy('dev', 'SQL server', 'sql-dev-01', { logWorkspace: LOG_DEV_01 });

    const audits = ofType(captured, AUDIT_POLICY);
    expect(audits).toHaveLength(1);
    expect(audits[0].name).toBe('sql-dev-01-audit');
    expect(audits[0].inputs.state).toBe('Enabled');
    expect(audits[0].inputs.isAzureMonitorTargetEnabled).toBe(true);
    expect(audits[0].inputs.isDevopsAuditEnabled).toBe(true);
    // No assessment storage was given, so no storage copy of the audit is kept.
    expect(audits[0].inputs.storageEndpoint).toBeUndefined();
    expect(audits[0].inputs.storageAccountAccessKey).toBeUndefined();
    expect(audits[0].inputs.storageAccountSubscriptionId).toBeUndefined();

    const server = settingOn(captured, 'sql-dev-01_id/databases/master');
    expect(server.workspaceId).toBe(LOG_DEV_01.id);
    expectOnlyLogs(server, ['SQLSecurityAuditEvents', 'DevOpsOperationsAudit']);
  });

  test('Scenario: An existing audit to the assessment storage stays unchanged', async () => {
    // Given the SQL server "sql-prd-01" already audits to the assessment storage account "stauditprd01"
    const before = await deploy('prd', 'SQL server', 'sql-prd-01', {
      vulnerabilityAssessment: { logStorage: ST_AUDIT_PRD_01 },
    });
    const auditBefore = ofType(before, AUDIT_POLICY);
    expect(auditBefore).toHaveLength(1);
    expect(auditBefore[0].inputs.storageEndpoint).toBe('https://stauditprd01.blob.core.windows.net');

    const captured = await deploy('prd', 'SQL server', 'sql-prd-01', {
      vulnerabilityAssessment: { logStorage: ST_AUDIT_PRD_01 },
      logWorkspace: LOG_PRD_01,
    });

    // The audit events still reach "stauditprd01": one audit, inputs unchanged.
    const audits = ofType(captured, AUDIT_POLICY);
    expect(audits).toHaveLength(1);
    expect(audits[0].name).toBe('sql-prd-01-audit');
    expect(audits[0].inputs).toEqual(auditBefore[0].inputs);
    expect(audits[0].inputs.isAzureMonitorTargetEnabled).toBe(true);

    // And "log-prd-01" receives the same audit events.
    const server = settingOn(captured, 'sql-prd-01_id/databases/master');
    expect(server.workspaceId).toBe(LOG_PRD_01.id);
    expectOnlyLogs(server, ['SQLSecurityAuditEvents', 'DevOpsOperationsAudit']);
  });

  test.each<[string, string, boolean]>([
    ['sb-prd-01', 'Premium', true],
    ['sb-std-01', 'Standard', false],
  ])(
    'Scenario Outline: Service Bus runtime audit logs need the Premium tier — "%s" on %s',
    async (name, tier, sent) => {
      const captured = await deploy('prd', 'Service Bus', name, { sku: { name: tier }, logWorkspace: LOG_PRD_01 });

      const categories = settingOn(captured, `${name}_id`).logs.map((l: any) => l.category);
      if (sent) expect(categories).toContain('RuntimeAuditLogs');
      else expect(categories).not.toContain('RuntimeAuditLogs');
    },
  );

  test('Scenario: An AKS stack that already gives a workspace gets control-plane logs', async () => {
    const captured = await deploy('prd', 'AKS cluster', 'aks-prd-01', { logWorkspace: LOG_PRD_01 });

    // Defender for "aks-prd-01" is configured as before.
    const [cluster] = ofType(captured, MANAGED_CLUSTER);
    expect(cluster.inputs.securityProfile.defender).toEqual({
      logAnalyticsWorkspaceResourceId: LOG_PRD_01.id,
      securityMonitoring: { enabled: true },
    });

    const setting = settingOn(captured, 'aks-prd-01_id');
    expect(setting.workspaceId).toBe(LOG_PRD_01.id);
    expectOnlyLogs(setting, ['kube-audit-admin', 'guard', 'cluster-autoscaler']);
  });

  test.each<[Component, string, string, object, (captured: Captured[]) => void]>([
    [
      'Firewall',
      'fw-hub-prd',
      'policy-insights workspace',
      { logs: { defaultWorkspace: LOG_PRD_01 } },
      (captured) => {
        const [policy] = ofType(captured, FIREWALL_POLICY);
        expect(policy.inputs.insights.logAnalyticsResources.defaultWorkspaceId).toEqual({ id: LOG_PRD_01.id });
      },
    ],
    [
      'API gateway',
      'apim-prd-01',
      'App Insights logging',
      {
        logs: {
          appInsight: {
            resourceGroupName: 'rg-logs',
            resourceName: 'appi-prd-01',
            id: '/subscriptions/sub/resourceGroups/rg-logs/providers/Microsoft.Insights/components/appi-prd-01',
            instrumentationKey: 'ikey',
            connectionString: 'InstrumentationKey=ikey',
          },
        },
      },
      (captured) => expect(ofType(captured, 'azure-native:apimanagement:Logger')).toHaveLength(1),
    ],
    [
      'SQL server',
      'sql-prd-01',
      'vulnerability-assessment storage account',
      { vulnerabilityAssessment: { logStorage: ST_AUDIT_PRD_01 } },
      (captured) => {
        const audits = ofType(captured, AUDIT_POLICY);
        expect(audits).toHaveLength(1);
        expect(audits[0].inputs.storageEndpoint).toBe('https://stauditprd01.blob.core.windows.net');
      },
    ],
  ])(
    'Scenario Outline: Existing log inputs do not turn diagnostic settings on — %s "%s" given only its %s',
    async (component, name, _input, props, existingInputApplied) => {
      const captured = await deploy('prd', component, name, props);

      existingInputApplied(captured);
      expect(diagnosticSettings(captured)).toHaveLength(0);
    },
  );
});
