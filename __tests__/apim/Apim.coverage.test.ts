import { withStack, restoreStack, Captured } from '../testUtils/pulumiMocks';

/**
 * DRK-1821 §3 row 8: coverage for the Apim branches the caller-input ATs do not reach
 * (identity, defaults, hostnames, Premium locations, App Insight logger, products, permissions).
 * Runs on a non-prd stack (`withStack('dev')`).
 */

jest.setTimeout(30000);

// Every withStack() reloads @pulumi/pulumi, which adds one process 'exit' listener; this file loads it
// more than the default 10 times. Raise the limit for this file only and restore it afterwards.
const ORIGINAL_MAX_LISTENERS = process.getMaxListeners();
beforeAll(() => process.setMaxListeners(ORIGINAL_MAX_LISTENERS + 20));
afterAll(() => process.setMaxListeners(ORIGINAL_MAX_LISTENERS));

const SERVICE = 'azure-native:apimanagement:ApiManagementService';

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
  sku: { name: 'Developer', capacity: 1 },
  disableSignIn: true,
  publisherName: 'drunkcoding',
};

async function createApim(props: any): Promise<Captured[]> {
  const { pulumi, Apim, captured } = withStack('dev', (p) => {
    const mod: typeof import('../../src/apim/Apim') = require('../../src/apim/Apim');
    return { pulumi: p, Apim: mod.Apim };
  });
  const apim = new Apim('apim1', { ...baseArgs, ...props } as any);
  await pulumi.output(apim.id).promise();
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
  return captured;
}

const serviceInputs = async (props: any) => (await createApim(props)).find((c) => c.type === SERVICE)!.inputs;

describe('Apim — service inputs beyond VNet injection', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('no optional args: publisher, API version, TLS custom properties and public access take the defaults', async () => {
    const inputs = await serviceInputs({});
    expect(inputs.publisherName).toBe('drunkcoding');
    expect(inputs.publisherEmail).toBe('apimgmt-noreply@mail.windowsazure.com');
    expect(inputs.notificationSenderEmail).toBe('apimgmt-noreply@mail.windowsazure.com');
    expect(inputs.apiVersionConstraint).toEqual({ minApiVersion: '2019-12-01' });
    expect(inputs.publicNetworkAccess).toBe('Enabled');
    expect(inputs.identity).toBeUndefined();
    expect(inputs.additionalLocations).toBeUndefined();
    expect(inputs.customProperties).toEqual({
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Protocols.Server.Http2': 'true',
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Backend.Protocols.Ssl30': 'false',
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Backend.Protocols.Tls10': 'false',
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Backend.Protocols.Tls11': 'false',
    });
  });

  test('caller publisherEmail, apiVersionConstraint and customProperties win over the defaults', async () => {
    const inputs = await serviceInputs({
      publisherEmail: 'ops@drunkcoding.net',
      notificationSenderEmail: 'noreply@drunkcoding.net',
      apiVersionConstraint: { minApiVersion: '2021-08-01' },
      customProperties: { 'Microsoft.WindowsAzure.ApiManagement.Gateway.Protocols.Server.Http2': 'false' },
    });
    expect(inputs.publisherEmail).toBe('ops@drunkcoding.net');
    expect(inputs.notificationSenderEmail).toBe('noreply@drunkcoding.net');
    expect(inputs.apiVersionConstraint).toEqual({ minApiVersion: '2021-08-01' });
    expect(inputs.customProperties['Microsoft.WindowsAzure.ApiManagement.Gateway.Protocols.Server.Http2']).toBe(
      'false',
    );
  });

  test('network.publicNetworkAccess true keeps public access Enabled', async () => {
    const inputs = await serviceInputs({ network: { publicNetworkAccess: true } });
    expect(inputs.publicNetworkAccess).toBe('Enabled');
  });

  test('resource identity without a user-assigned id is SystemAssigned', async () => {
    const inputs = await serviceInputs({ enableResourceIdentity: true });
    expect(inputs.identity).toEqual({ type: 'SystemAssigned' });
  });

  test('resource identity with a user-assigned id is SystemAssigned, UserAssigned keyed by that id', async () => {
    const inputs = await serviceInputs({
      enableResourceIdentity: true,
      defaultUAssignedId: { id: 'uai_id', clientId: 'uai_client', principalId: 'uai_principal' },
    });
    expect(inputs.identity).toEqual({ type: 'SystemAssigned, UserAssigned', userAssignedIdentities: { uai_id: {} } });
  });

  test('a hostname configuration becomes a Key Vault proxy hostname using the user-assigned client id', async () => {
    const inputs = await serviceInputs({
      vaultInfo: { id: 'vault_id', resourceName: 'vault1', resourceGroupName: 'rg' },
      defaultUAssignedId: { id: 'uai_id', clientId: 'uai_client', principalId: 'uai_principal' },
      hostnameConfigurations: [
        { hostName: 'api.drunkcoding.net', defaultSslBinding: true, cert: { vaultCertName: 'api-cert' } },
      ],
    });
    expect(inputs.hostnameConfigurations).toEqual([
      {
        hostName: 'api.drunkcoding.net',
        defaultSslBinding: true,
        certificateSource: 'KeyVault',
        identityClientId: 'uai_client',
        keyVaultId: 'https://vault1.vault.azure.net/secrets/api-cert',
        type: 'Proxy',
      },
    ]);
  });

  test('Premium carries additional locations with the service sku', async () => {
    const inputs = await serviceInputs({
      sku: { name: 'Premium', capacity: 1 },
      additionalLocations: [{ location: 'westus' }],
    });
    expect(inputs.additionalLocations).toEqual([{ location: 'westus', sku: { name: 'Premium', capacity: 1 } }]);
  });

  test('a non-Premium sku drops additional locations', async () => {
    const inputs = await serviceInputs({ additionalLocations: [{ location: 'westus' }] });
    expect(inputs.additionalLocations).toBeUndefined();
  });
});

describe('Apim — child resources', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('logs.appInsight creates an Application Insights logger with the instrumentation key', async () => {
    const captured = await createApim({
      logs: { appInsight: { id: 'insight_id', resourceName: 'insight1', instrumentationKey: 'ikey' } },
    });
    const logger = captured.find((c) => c.type === 'azure-native:apimanagement:Logger');
    expect(logger).toBeDefined();
    expect(logger!.inputs.loggerType).toBe('applicationInsights');
    expect(logger!.inputs.resourceId).toBe('insight_id');
    expect(logger!.inputs.credentials).toEqual({ instrumentationKey: 'ikey' });
  });

  test('no logs creates no logger', async () => {
    const captured = await createApim({});
    expect(captured.find((c) => c.type === 'azure-native:apimanagement:Logger')).toBeUndefined();
  });

  test('each product creates an ApimProduct child', async () => {
    const captured = await createApim({ products: [{ name: 'public', displayName: 'Public' }] });
    const product = captured.find((c) => c.type === 'azure-native:apimanagement:Product');
    expect(product).toBeDefined();
    expect(product!.inputs.displayName).toBe('Public');
  });

  test('permissions grant the service identity the named role on the resource', async () => {
    const captured = await createApim({
      permissions: [
        { roleNames: ['Reader'], resource: { id: 'res_id', resourceName: 'res1', resourceGroupName: 'rg' } },
      ],
    });
    const roles = captured.filter((c) => c.inputs?.roleName === 'Reader');
    expect(roles).toHaveLength(1);
    expect(roles[0].inputs.scope).toBe('res_id');
    expect(roles[0].inputs.principalId).toBe('apim1_principal');
  });
});
