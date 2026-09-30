import { withStack, restoreStack } from '../testUtils/pulumiMocks';
import { captureResourceParents } from '../testUtils/pulumiParentSpy';

// Pre-existing AzSql behaviour, untouched by DRK-1816, but AzSql.ts is a touched class this cycle
// (vulnerability assessment) so its other branches need coverage too.

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
  administrators: { azureAdOnlyAuthentication: true },
  vulnerabilityAssessment: { enabled: false },
};

async function build(props: object) {
  const { pulumi, AzSql, captured } = withStack('dev', (p) => {
    const mod: typeof import('../../src/database/AzSql') = require('../../src/database/AzSql');
    return { pulumi: p, AzSql: mod.AzSql };
  });
  const server = new AzSql('sql1', { ...baseArgs, ...props } as any);
  await pulumi.output(server.id).promise();
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
  const inputsOf = (type: string) => captured.filter((c) => c.type === type).map((c) => c.inputs);
  return { server, inputsOf };
}

describe('AzSql — server, network, elastic pool and databases (pre-existing behaviour)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('server defaults to TLS 1.2, version 12.0, public access enabled and an AAD group admin', async () => {
    const { server, inputsOf } = await build({});

    const [srv] = inputsOf('azure-native:sql:Server');
    expect(srv.minimalTlsVersion).toBe('1.2');
    expect(srv.version).toBe('12.0');
    expect(srv.publicNetworkAccess).toBe('Enabled');
    expect(srv.identity).toBeUndefined();
    expect(srv.administrators.principalType).toBe('Group');
    expect(srv.administrators.azureADOnlyAuthentication).toBe(true);
    expect(server.getOutputs()).toHaveProperty('resourceName');
  });

  test('resource identity with a user-assigned id uses SystemAssigned,UserAssigned', async () => {
    const { inputsOf } = await build({
      enableResourceIdentity: true,
      defaultUAssignedId: { id: 'uid_id', clientId: 'c', principalId: 'p', resourceName: 'uid' },
    });

    const [srv] = inputsOf('azure-native:sql:Server');
    expect(srv.identity.type).toBe('SystemAssigned,UserAssigned');
    expect(srv.identity.userAssignedIdentities).toEqual(['uid_id']);
    expect(srv.primaryUserAssignedIdentityId).toBe('uid_id');
  });

  test('resource identity without a user-assigned id uses SystemAssigned', async () => {
    const { inputsOf } = await build({ enableResourceIdentity: true });

    expect(inputsOf('azure-native:sql:Server')[0].identity.type).toBe('SystemAssigned');
  });

  test('allowAllInbound creates one 0.0.0.0-255.255.255.255 firewall rule', async () => {
    const { inputsOf } = await build({ network: { allowAllInbound: true, ipRules: ['1.2.3.4'] } });

    const rules = inputsOf('azure-native:sql:FirewallRule');
    expect(rules).toHaveLength(1);
    expect(rules[0].startIpAddress).toBe('0.0.0.0');
    expect(rules[0].endIpAddress).toBe('255.255.255.255');
  });

  test('ipRules and subnets create firewall and virtual network rules', async () => {
    const subnetId = '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet/subnets/app';
    const { inputsOf } = await build({ network: { ipRules: ['1.2.3.4'], subnets: [{ id: subnetId }] } });

    const rules = inputsOf('azure-native:sql:FirewallRule');
    expect(rules).toHaveLength(1);
    expect(rules[0].startIpAddress).toBe('1.2.3.4');
    expect(rules[0].endIpAddress).toBe('1.2.3.4');

    const vnetRules = inputsOf('azure-native:sql:VirtualNetworkRule');
    expect(vnetRules).toHaveLength(1);
    expect(vnetRules[0].virtualNetworkSubnetId).toBe(subnetId);
    expect(vnetRules[0].ignoreMissingVnetServiceEndpoint).toBe(false);
  });

  test('elastic pool converts maxSizeGB to bytes and databases join it without their own sku', async () => {
    const { inputsOf } = await build({
      elasticPoolCreate: { maxSizeGB: 2, sku: { name: 'StandardPool', tier: 'Standard', capacity: 50 } },
      databases: { app: { sku: { name: 'S0' } } },
    });

    const [pool] = inputsOf('azure-native:sql:ElasticPool');
    expect(pool.maxSizeBytes).toBe(2147483648);

    const [db] = inputsOf('azure-native:sql:Database');
    expect(db.databaseName).toBe('app');
    expect(db.elasticPoolId).toBeDefined();
    expect(db.sku).toBeUndefined();
  });

  test('a database outside an elastic pool keeps its sku and name override', async () => {
    const { inputsOf } = await build({
      administrators: {
        azureAdOnlyAuthentication: false,
        useDefaultUAssignedIdForConnection: true,
        additionalUAssignedClientIds: { worker: 'client-1' },
      },
      defaultUAssignedId: { id: 'uid_id', clientId: 'c', principalId: 'p', resourceName: 'uid' },
      databases: { app: { databaseName: 'appdb', sku: { name: 'S0' } } },
    });

    expect(inputsOf('azure-native:sql:ElasticPool')).toHaveLength(0);
    const [db] = inputsOf('azure-native:sql:Database');
    expect(db.databaseName).toBe('appdb');
    expect(db.sku).toEqual({ name: 'S0' });
  });
});

// DRK-1816 additions: pin the fixed alert/audit policy inputs the acceptance tests do not assert,
// so the express rewrite cannot silently drop them (mutation survivors on AzSql.ts).
describe('AzSql — vulnerability assessment policy inputs', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  let restoreSpy: (() => void) | undefined;
  afterEach(() => {
    restoreSpy?.();
    restoreSpy = undefined;
    restoreStack(ORIGINAL_STACK);
  });

  test('alert and audit policies keep their fixed inputs and are children of the component', async () => {
    let spy: ReturnType<typeof captureResourceParents> | undefined;
    const { pulumi, AzSql, captured } = withStack(
      'dev',
      (p) => {
        spy = captureResourceParents();
        const mod: typeof import('../../src/database/AzSql') = require('../../src/database/AzSql');
        return { pulumi: p, AzSql: mod.AzSql };
      },
      undefined,
      (args) =>
        args.token === 'azure-native:storage:listStorageAccountKeys' ? { keys: [{ value: 'stg-key' }] } : undefined,
    );
    restoreSpy = spy!.restore;

    const server = new AzSql('sql1', {
      ...baseArgs,
      vulnerabilityAssessment: { logStorage: { resourceName: 'stglogs', rsGroup: { resourceGroupName: 'rg' } } },
    } as any);
    await pulumi.output(server.id).promise();
    for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));

    const parentOf = (type: string) => spy!.captured.find((c) => c.type === type)?.parent;
    const inputsOf = (type: string) => captured.find((c) => c.type === type)!.inputs;

    const alert = inputsOf('azure-native:sql:ServerSecurityAlertPolicy');
    expect(alert.securityAlertPolicyName).toBe('default');
    expect(alert.emailAccountAdmins).toBe(true);
    expect(parentOf('azure-native:sql:ServerSecurityAlertPolicy')).toBe(server);

    const audit = inputsOf('azure-native:sql:ExtendedServerBlobAuditingPolicy');
    expect(audit.auditActionsAndGroups).toEqual([
      'SUCCESSFUL_DATABASE_AUTHENTICATION_GROUP',
      'FAILED_DATABASE_AUTHENTICATION_GROUP',
      'BATCH_COMPLETED_GROUP',
    ]);
    expect(audit.blobAuditingPolicyName).toBe('default');
    expect(audit.isAzureMonitorTargetEnabled).toBe(true);
    expect(audit.isStorageSecondaryKeyInUse).toBe(false);
    expect(audit.predicateExpression).toBe("object_name = 'SensitiveData'");
    expect(audit.queueDelayMs).toBe(4000);
    expect(audit.state).toBe('Enabled');
    expect(audit.isDevopsAuditEnabled).toBe(true);
    // The key reaches the mock monitor as a Pulumi secret envelope, not a plain string.
    expect(audit.storageAccountAccessKey).toEqual({
      [pulumi.runtime.specialSigKey]: pulumi.runtime.specialSecretSig,
      value: 'stg-key',
    });
    expect(parentOf('azure-native:sql:ExtendedServerBlobAuditingPolicy')).toBe(server);
  });
});
