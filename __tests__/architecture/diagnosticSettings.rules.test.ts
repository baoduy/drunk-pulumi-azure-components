import { Captured, mockAksFetch, quietStackHooks, settle, withStack } from '../testUtils/pulumiMocks';
import { captureResourceParents } from '../testUtils/pulumiParentSpy';

// Each case reloads a component's module graph through `withStack`; AKS and SQL can exceed Jest's 5 s default.
jest.setTimeout(30000);

/**
 * DRK-1980 programmer tests for the brief's rules the acceptance tests do not reach:
 * R3 (other log inputs never create a setting), R5 (SQL audit storage fields), R7 (no input leak) and the
 * Q4 setting names. Expected values are literals from the brief.
 */

const DIAGNOSTIC_SETTING = 'azure-native:monitor:DiagnosticSetting';
const AUDIT_POLICY = 'azure-native:sql:ExtendedServerBlobAuditingPolicy';

const LOG_WORKSPACE = {
  resourceGroupName: 'rg-logs',
  resourceName: 'log-prd-01',
  id: '/subscriptions/sub/resourceGroups/rg-logs/providers/Microsoft.OperationalInsights/workspaces/log-prd-01',
};
const LOG_STORAGE = {
  resourceGroupName: 'rg-logs',
  resourceName: 'stlogprd01',
  id: '/subscriptions/sub/resourceGroups/rg-logs/providers/Microsoft.Storage/storageAccounts/stlogprd01',
};
const AUDIT_STORAGE = {
  resourceGroupName: 'rg-audit',
  resourceName: 'stauditprd01',
  id: '/subscriptions/sub/resourceGroups/rg-audit/providers/Microsoft.Storage/storageAccounts/stauditprd01',
  rsGroup: { resourceGroupName: 'rg-audit' },
};
const rsGroup = { resourceGroupName: 'rg', location: 'eastus' };

const extraState = ({ type }: { type: string }) =>
  type === 'azure-native:network:AzureFirewall'
    ? { ipConfigurations: [{ privateIPAddress: '10.0.1.4' }] }
    : type === 'azure-native:containerservice:ManagedCluster'
      ? { oidcIssuerProfile: { issuerURL: 'https://issuer.example.com' } }
      : {};
const extraCall = ({ token }: { token: string }) =>
  token === 'azure-native:storage:listStorageAccountKeys' ? { keys: [{ value: 'stg-key' }] } : undefined;

async function deploy(stack: 'prd' | 'dev', path: string, ctor: string, name: string, args: object) {
  const { pulumi, Ctor, captured } = withStack(
    stack,
    (p) => ({ pulumi: p, Ctor: require(path)[ctor] }),
    extraState,
    extraCall,
  );
  const resource = new Ctor(name, { rsGroup, ...args });
  await settle(pulumi, resource.id);
  if (resource.kubeletIdentity) await pulumi.output(resource.kubeletIdentity).promise();
  if (resource.systemIdentityId) await pulumi.output(resource.systemIdentityId).promise();
  await new Promise((resolve) => setTimeout(resolve, 50));
  return captured;
}

const ofType = (captured: Captured[], type: string) => captured.filter((c) => c.type === type);

// AzKubernetes fetches its kubelet identity over HTTP; stub it for the whole file.
afterAll(mockAksFetch());

describe('Diagnostic settings — rules beyond the acceptance tests', () => {
  quietStackHooks();

  // Every `withStack` reload adds a process `exit` listener; keep only the ones that existed before the case.
  let exitListenersBefore = new Set<Function>();
  beforeEach(() => {
    exitListenersBefore = new Set(process.listeners('exit'));
  });
  afterEach(() =>
    process
      .listeners('exit')
      .filter((listener) => !exitListenersBefore.has(listener))
      .forEach((listener) => process.off('exit', listener)),
  );

  test('R3: APIM logs.workspace and logs.storage create no diagnostic setting', async () => {
    const captured = await deploy('prd', '../../src/apim/Apim', 'Apim', 'apim-prd-01', {
      sku: { name: 'Developer', capacity: 1 },
      disableSignIn: true,
      publisherName: 'drunkcoding',
      logs: { workspace: { ...LOG_WORKSPACE, customerId: 'cid' }, storage: LOG_STORAGE },
    });

    expect(ofType(captured, 'azure-native:apimanagement:ApiManagementService')).toHaveLength(1);
    expect(ofType(captured, DIAGNOSTIC_SETTING)).toHaveLength(0);
  });

  test('R3: Firewall policy.insights creates no diagnostic setting', async () => {
    const insights = {
      isEnabled: true,
      logAnalyticsResources: { defaultWorkspaceId: { id: LOG_WORKSPACE.id } },
    };
    const captured = await deploy('prd', '../../src/vnet/Firewall', 'Firewall', 'fw-hub-prd', {
      sku: { name: 'AZFW_VNet', tier: 'Standard' },
      policy: { insights },
    });

    const [policy] = ofType(captured, 'azure-native:network:FirewallPolicy');
    expect(policy.inputs.insights).toEqual(insights);
    expect(ofType(captured, DIAGNOSTIC_SETTING)).toHaveLength(0);
  });

  test('R5: prd SQL with the assessment on but no assessment storage audits without storage fields', async () => {
    const captured = await deploy('prd', '../../src/database/AzSql', 'AzSql', 'sql-prd-01', {
      administrators: { azureAdOnlyAuthentication: true },
      logWorkspace: LOG_WORKSPACE,
    });

    expect(ofType(captured, 'azure-native:sql:ServerSecurityAlertPolicy')).toHaveLength(1);
    const audits = ofType(captured, AUDIT_POLICY);
    expect(audits).toHaveLength(1);
    expect(audits[0].name).toBe('sql-prd-01-audit');
    expect(audits[0].inputs.state).toBe('Enabled');
    expect(audits[0].inputs.isAzureMonitorTargetEnabled).toBe(true);
    expect(audits[0].inputs.predicateExpression).toBeUndefined();
    expect(audits[0].inputs.storageEndpoint).toBeUndefined();
    expect(audits[0].inputs.storageAccountAccessKey).toBeUndefined();
    expect(audits[0].inputs.storageAccountSubscriptionId).toBeUndefined();
  });

  test('R5: dev SQL with no assessment audits every event, with no predicate', async () => {
    const captured = await deploy('dev', '../../src/database/AzSql', 'AzSql', 'sql-dev-01', {
      administrators: { azureAdOnlyAuthentication: true },
      logWorkspace: LOG_WORKSPACE,
    });

    expect(ofType(captured, 'azure-native:sql:ServerSecurityAlertPolicy')).toHaveLength(0);
    const audits = ofType(captured, AUDIT_POLICY);
    expect(audits).toHaveLength(1);
    expect(audits[0].inputs.state).toBe('Enabled');
    expect(audits[0].inputs.predicateExpression).toBeUndefined();
  });

  test('R5: SQL with the assessment off keeps no storage copy even when assessment storage is given', async () => {
    const captured = await deploy('prd', '../../src/database/AzSql', 'AzSql', 'sql-prd-01', {
      administrators: { azureAdOnlyAuthentication: true },
      vulnerabilityAssessment: { enabled: false, logStorage: AUDIT_STORAGE },
      logStorage: LOG_STORAGE,
    });

    expect(ofType(captured, 'azure-native:sql:ServerSecurityAlertPolicy')).toHaveLength(0);
    const audits = ofType(captured, AUDIT_POLICY);
    expect(audits).toHaveLength(1);
    expect(audits[0].inputs.state).toBe('Enabled');
    expect(audits[0].inputs.isDevopsAuditEnabled).toBe(true);
    expect(audits[0].inputs.auditActionsAndGroups).toEqual([
      'SUCCESSFUL_DATABASE_AUTHENTICATION_GROUP',
      'FAILED_DATABASE_AUTHENTICATION_GROUP',
      'BATCH_COMPLETED_GROUP',
    ]);
    expect(audits[0].inputs.retentionDays).toBe(30);
    expect(audits[0].inputs.blobAuditingPolicyName).toBe('default');
    expect(audits[0].inputs.serverName).toBe('sql-prd-01');
    expect(audits[0].inputs.isStorageSecondaryKeyInUse).toBe(false);
    expect(audits[0].inputs.predicateExpression).toBeUndefined();
    expect(audits[0].inputs.queueDelayMs).toBe(4000);
    expect(audits[0].inputs.storageEndpoint).toBeUndefined();
    expect(audits[0].inputs.storageAccountAccessKey).toBeUndefined();
    expect(audits[0].inputs.storageAccountSubscriptionId).toBeUndefined();

    const [server] = ofType(captured, DIAGNOSTIC_SETTING).filter(
      (s) => s.inputs.resourceUri === 'sql-prd-01_id/databases/master',
    );
    expect(server.inputs.storageAccountId).toBe(LOG_STORAGE.id);
  });

  // The Azure resource each component builds, and the Pulumi names of its diagnostic settings (Q4).
  test.each<[string, string, string, object, string, string[]]>([
    [
      '../../src/storage/StorageAccount',
      'StorageAccount',
      'stappprd01',
      {},
      'azure-native:storage:StorageAccount',
      ['stappprd01-diag-blob', 'stappprd01-diag-file', 'stappprd01-diag-queue', 'stappprd01-diag-table'],
    ],
    [
      '../../src/database/AzSql',
      'AzSql',
      'sql-prd-01',
      { administrators: { azureAdOnlyAuthentication: true }, databases: { orders: {} } },
      'azure-native:sql:Server',
      ['sql-prd-01-diag', 'sql-prd-01-orders-diag'],
    ],
    [
      '../../src/vnet/Firewall',
      'Firewall',
      'fw-hub-prd',
      { sku: { name: 'AZFW_VNet', tier: 'Standard' }, policy: {} },
      'azure-native:network:AzureFirewall',
      ['fw-hub-prd-diag'],
    ],
    [
      '../../src/services/ServiceBus',
      'ServiceBus',
      'sb-prd-01',
      { sku: { name: 'Standard' }, disableLocalAuth: true, network: { ipRules: ['1.2.3.4'] } },
      'azure-native:servicebus:Namespace',
      ['sb-prd-01-diag'],
    ],
    [
      '../../src/apim/Apim',
      'Apim',
      'apim-prd-01',
      { sku: { name: 'Developer', capacity: 1 }, disableSignIn: true, publisherName: 'drunkcoding' },
      'azure-native:apimanagement:ApiManagementService',
      ['apim-prd-01-diag'],
    ],
    [
      '../../src/aks/AzKubernetes',
      'AzKubernetes',
      'aks-prd-01',
      {
        sku: { name: 'Base' },
        features: { enablePrivateCluster: false },
        agentPoolProfiles: [
          { name: 'system', vnetSubnetID: 'subnet_id', enableEncryptionAtHost: false, osDiskSizeGB: 128 },
        ],
      },
      'azure-native:containerservice:ManagedCluster',
      ['aks-prd-01-diag'],
    ],
  ])('R7: %s keeps the log destinations out of its Azure resource', async (path, ctor, name, args, type, names) => {
    const captured = await deploy('prd', path, ctor, name, {
      ...args,
      logWorkspace: LOG_WORKSPACE,
      logStorage: LOG_STORAGE,
    });

    const [resource] = ofType(captured, type);
    expect(resource.inputs).not.toHaveProperty('logWorkspace');
    expect(resource.inputs).not.toHaveProperty('logStorage');

    const settings = ofType(captured, DIAGNOSTIC_SETTING);
    expect(settings.map((s) => s.name).sort()).toEqual(names);
    for (const setting of settings) {
      expect(setting.inputs.name).toBe('drunk-diag');
      expect(setting.inputs.workspaceId).toBe(LOG_WORKSPACE.id);
      expect(setting.inputs.storageAccountId).toBe(LOG_STORAGE.id);
    }
  });

  test('The diagnostic setting is a child of the component it logs', async () => {
    let spy: ReturnType<typeof captureResourceParents> | undefined;
    const { pulumi, KeyVault } = withStack('prd', (p) => {
      spy = captureResourceParents();
      return { pulumi: p, KeyVault: require('../../src/vault/KeyVault').KeyVault };
    });
    try {
      const vault = new KeyVault('kv-prd-01', {
        rsGroup,
        network: { ipRules: ['1.2.3.4'] },
        logWorkspace: LOG_WORKSPACE,
      });
      await settle(pulumi, vault.id);

      const settings = spy!.captured.filter((r) => r.type === DIAGNOSTIC_SETTING);
      expect(settings).toHaveLength(1);
      expect(settings[0].parent).toBe(vault);
    } finally {
      spy!.restore();
    }
  });

  test.each<[string, string, object]>([
    ['on', 'sql-prd-01-alert', {}],
    ['off', 'sql-prd-01', { vulnerabilityAssessment: { enabled: false } }],
  ])('The SQL audit with the assessment %s is a child of the component and waits for "%s"', async (_, after, props) => {
    let spy: ReturnType<typeof captureResourceParents> | undefined;
    const { pulumi, AzSql } = withStack('prd', (p) => {
      spy = captureResourceParents();
      return { pulumi: p, AzSql: require('../../src/database/AzSql').AzSql };
    });
    try {
      const server = new AzSql('sql-prd-01', {
        rsGroup,
        administrators: { azureAdOnlyAuthentication: true },
        logWorkspace: LOG_WORKSPACE,
        ...props,
      });
      await settle(pulumi, server.id);

      const audits = spy!.captured.filter((r) => r.type === AUDIT_POLICY);
      expect(audits).toHaveLength(1);
      expect(audits[0].parent).toBe(server);
      const waitsFor = (audits[0].opts.dependsOn as unknown[]).map((d) => spy!.captured.find((r) => r.res === d)?.name);
      expect(waitsFor).toEqual([after]);
    } finally {
      spy!.restore();
    }
  });

  test('AKS with only a log storage account gets the control-plane diagnostic setting', async () => {
    const captured = await deploy('prd', '../../src/aks/AzKubernetes', 'AzKubernetes', 'aks-prd-01', {
      sku: { name: 'Base' },
      features: { enablePrivateCluster: false },
      agentPoolProfiles: [
        { name: 'system', vnetSubnetID: 'subnet_id', enableEncryptionAtHost: false, osDiskSizeGB: 128 },
      ],
      logStorage: LOG_STORAGE,
    });

    const [setting] = ofType(captured, DIAGNOSTIC_SETTING);
    expect(setting.inputs.resourceUri).toBe('aks-prd-01_id');
    expect(setting.inputs.storageAccountId).toBe(LOG_STORAGE.id);
    expect(setting.inputs.workspaceId).toBeUndefined();
  });
});
