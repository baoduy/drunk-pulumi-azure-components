import { withStack, restoreStack, Captured } from '../testUtils/pulumiMocks';

// DRK-1874: Apim must pass its CA and root certificates to ApiManagementService as one ordered
// array — every CA cert (storeName 'CertificateAuthority') first, then every root cert
// (storeName 'Root'). S1–S4 are the defect ATs; S5–S10 pin the other Apim branches as they are today.

const SERVICE = 'azure-native:apimanagement:ApiManagementService';
const IDENTITY_PROVIDER = 'azure-native:apimanagement:IdentityProvider';
const LOGGER = 'azure-native:apimanagement:Logger';
const PRIVATE_ENDPOINT = 'azure-native:network:PrivateEndpoint';
const APP_REGISTRATION = 'drunk:azure:AppRegistration';
const APIM_PRODUCT = 'drunk:azure:ApimProduct';
const ROLE_ASSIGNMENT = 'azure-native:authorization:RoleAssignment';

const PE_SUBNET = '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet/subnets/snet';

const CA_CERT_A = { encodedCertificate: 'CA-CERT-A', certificatePassword: 'PASS-A' };
const CA_CERT_A2 = { encodedCertificate: 'CA-CERT-A2' };
const ROOT_CERT_B = { encodedCertificate: 'ROOT-CERT-B', certificatePassword: 'PASS-B' };

const vaultInfo = { resourceGroupName: 'vault-rg', resourceName: 'vault1', id: 'vault1_id' };

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
  sku: { name: 'Developer', capacity: 1 },
  disableSignIn: true,
  // stackInfo.organization is undefined under mocks and the provider requires a publisher name.
  publisherName: 'drunkcoding',
};

// Every withStack call reloads @pulumi/pulumi, and each copy holds a process `exit` listener while
// its RPCs settle. This file runs more than 10 such reloads, so lift the limit for this file only.
const ORIGINAL_MAX_LISTENERS = process.getMaxListeners();
beforeAll(() => process.setMaxListeners(50));
afterAll(() => process.setMaxListeners(ORIGINAL_MAX_LISTENERS));

async function deployApim(props: any, { stack = 'dev' }: { stack?: string } = {}) {
  const { pulumi, Apim, captured } = withStack(
    stack,
    (p) => {
      const mod: typeof import('../../src/apim/Apim') = require('../../src/apim/Apim');
      return { pulumi: p, Apim: mod.Apim };
    },
    // PrivateEndpoint reads customDnsConfigs[].ipAddresses back off its own resource state.
    ({ type }) => (type === PRIVATE_ENDPOINT ? { customDnsConfigs: [{ ipAddresses: ['10.0.0.4'] }] } : {}),
  );

  const apim = new Apim('apim-1', { ...baseArgs, ...props } as any);
  await pulumi.output(apim.id).promise();
  // Role grants and child components resolve inside `apply` callbacks.
  await new Promise((resolve) => setTimeout(resolve, 50));

  const byType = (type: string) => captured.filter((c: Captured) => c.type === type);
  return { pulumi, apim, captured, byType, service: byType(SERVICE)[0] };
}

describe('Apim — certificates', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('S1 one CA cert and one root cert are sent as an array of two', async () => {
    const { service } = await deployApim({ certificates: { caCerts: [CA_CERT_A], rootCerts: [ROOT_CERT_B] } });

    expect(Array.isArray(service.inputs.certificates)).toBe(true);
    expect(service.inputs.certificates).toHaveLength(2);
  });

  test('S2 the CA cert comes first with storeName CertificateAuthority, then the root cert with storeName Root', async () => {
    const { service } = await deployApim({ certificates: { caCerts: [CA_CERT_A], rootCerts: [ROOT_CERT_B] } });

    expect(service.inputs.certificates).toEqual([
      { encodedCertificate: 'CA-CERT-A', certificatePassword: 'PASS-A', storeName: 'CertificateAuthority' },
      { encodedCertificate: 'ROOT-CERT-B', certificatePassword: 'PASS-B', storeName: 'Root' },
    ]);
  });

  test('S3 two CA certs and one root cert keep the order CA1, CA2, Root', async () => {
    const { service } = await deployApim({
      certificates: { caCerts: [CA_CERT_A, CA_CERT_A2], rootCerts: [ROOT_CERT_B] },
    });

    expect(service.inputs.certificates).toEqual([
      { encodedCertificate: 'CA-CERT-A', certificatePassword: 'PASS-A', storeName: 'CertificateAuthority' },
      { encodedCertificate: 'CA-CERT-A2', storeName: 'CertificateAuthority' },
      { encodedCertificate: 'ROOT-CERT-B', certificatePassword: 'PASS-B', storeName: 'Root' },
    ]);
  });

  test('S4 no certificates arg sends an empty array', async () => {
    const { service } = await deployApim({});

    expect(Array.isArray(service.inputs.certificates)).toBe(true);
    expect(service.inputs.certificates).toEqual([]);
  });
});

describe('Apim — sign-in', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('S5 disableSignIn false adds one app registration and one aad identity provider', async () => {
    const { byType } = await deployApim({ disableSignIn: false, vaultInfo });

    expect(byType(APP_REGISTRATION)).toHaveLength(1);
    const providers = byType(IDENTITY_PROVIDER);
    expect(providers).toHaveLength(1);
    expect(providers[0].inputs.type).toBe('aad');
    expect(providers[0].inputs.identityProviderName).toBe('aad');
    expect(providers[0].inputs.serviceName).toBe('apim-1');
  });

  test('S5 disableSignIn true adds no app registration and no identity provider', async () => {
    const { byType } = await deployApim({ disableSignIn: true });

    expect(byType(APP_REGISTRATION)).toHaveLength(0);
    expect(byType(IDENTITY_PROVIDER)).toHaveLength(0);
  });
});

describe('Apim — network', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('S6 no network args means public access Enabled and no private endpoint', async () => {
    const { byType, service } = await deployApim({});

    expect(service.inputs.publicNetworkAccess).toBe('Enabled');
    expect(service.inputs.virtualNetworkType).toBe('None');
    expect(byType(PRIVATE_ENDPOINT)).toHaveLength(0);
  });

  test('S6 privateLink adds one private endpoint and disables public access', async () => {
    const { byType, service } = await deployApim({
      network: { privateLink: { subnetInfo: { subnetId: PE_SUBNET } } },
    });

    expect(byType(PRIVATE_ENDPOINT)).toHaveLength(1);
    expect(service.inputs.publicNetworkAccess).toBe('Disabled');
  });

  test('S6 publicNetworkAccess keeps public access Enabled alongside privateLink', async () => {
    const { service } = await deployApim({
      network: { publicNetworkAccess: true, privateLink: { subnetInfo: { subnetId: PE_SUBNET } } },
    });

    expect(service.inputs.publicNetworkAccess).toBe('Enabled');
  });

  test('S6 vnetRules pass the first subnet to the virtual network configuration', async () => {
    const { service } = await deployApim({ network: { vnetRules: [{ subnetId: 'subnet-1' }] } });

    expect(service.inputs.virtualNetworkConfiguration).toEqual({ subnetResourceId: 'subnet-1' });
  });
});

describe('Apim — logs and products', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  const logs = { appInsight: { id: 'insight_id', instrumentationKey: 'INSIGHT-KEY' } };

  test('S7 logs.appInsight adds one applicationInsights logger', async () => {
    const { byType } = await deployApim({ logs });

    const loggers = byType(LOGGER);
    expect(loggers).toHaveLength(1);
    expect(loggers[0].inputs.loggerType).toBe('applicationInsights');
    expect(loggers[0].inputs.resourceId).toBe('insight_id');
    expect(loggers[0].inputs.loggerId).toBe('apim-1-appInsight');
    expect(loggers[0].inputs.credentials).toEqual({ instrumentationKey: 'INSIGHT-KEY' });
  });

  test('S7 no logs adds no logger', async () => {
    const { byType } = await deployApim({});

    expect(byType(LOGGER)).toHaveLength(0);
  });

  test('S8 products add one ApimProduct child each', async () => {
    const { byType } = await deployApim({ logs, products: [{ name: 'product-1' }] });

    const products = byType(APIM_PRODUCT);
    expect(products).toHaveLength(1);
    expect(products[0].name).toBe('product-1');
    expect(products[0].inputs.enableDiagnostic).toBe(true);
    expect(byType('azure-native:apimanagement:Product')[0].inputs.serviceName).toBe('apim-1');
  });

  test('S8 products without logs.appInsight get enableDiagnostic false', async () => {
    const { byType } = await deployApim({ products: [{ name: 'product-1' }] });

    expect(byType(APIM_PRODUCT)[0].inputs.enableDiagnostic).toBe(false);
  });

  test('S8 no products adds no ApimProduct', async () => {
    const { byType } = await deployApim({});

    expect(byType(APIM_PRODUCT)).toHaveLength(0);
  });
});

describe('Apim — service inputs', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('S9 hostnameConfigurations become KeyVault Proxy entries with the vault secret id', async () => {
    const { service } = await deployApim({
      vaultInfo,
      hostnameConfigurations: [
        { hostName: 'api.example.com', defaultSslBinding: true, cert: { vaultCertName: 'api-cert', version: 'v1' } },
      ],
    });

    expect(service.inputs.hostnameConfigurations).toEqual([
      {
        hostName: 'api.example.com',
        defaultSslBinding: true,
        certificateSource: 'KeyVault',
        keyVaultId: 'https://vault1.vault.azure.net/secrets/api-cert/v1',
        type: 'Proxy',
      },
    ]);
  });

  test('S9 applies the publisher, api version and custom property defaults', async () => {
    const { service } = await deployApim({});

    expect(service.inputs.publisherEmail).toBe('apimgmt-noreply@mail.windowsazure.com');
    expect(service.inputs.notificationSenderEmail).toBe('apimgmt-noreply@mail.windowsazure.com');
    expect(service.inputs.apiVersionConstraint).toEqual({ minApiVersion: '2019-12-01' });
    expect(service.inputs.customProperties).toEqual({
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Protocols.Server.Http2': 'true',
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Backend.Protocols.Ssl30': 'false',
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Backend.Protocols.Tls10': 'false',
      'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Backend.Protocols.Tls11': 'false',
    });
    expect(service.inputs.identity).toBeUndefined();
  });

  test('S9 resource identity without a user-assigned id is SystemAssigned', async () => {
    const { service } = await deployApim({ enableResourceIdentity: true });

    expect(service.inputs.identity).toEqual({ type: 'SystemAssigned' });
  });

  test('S9 resource identity with a user-assigned id is SystemAssigned, UserAssigned with that id', async () => {
    const { service } = await deployApim({
      enableResourceIdentity: true,
      defaultUAssignedId: { id: 'uid-default-id', clientId: 'CLIENT-DEFAULT' },
    });

    expect(service.inputs.identity).toEqual({
      type: 'SystemAssigned, UserAssigned',
      userAssignedIdentities: { 'uid-default-id': {} },
    });
  });

  test('S10 Premium with additionalLocations carries the sku and prd default zones', async () => {
    const sku = { name: 'Premium', capacity: 1 };
    const { service } = await deployApim({ sku, additionalLocations: [{ location: 'westus' }] }, { stack: 'prd' });

    expect(service.inputs.zones).toEqual(['1', '2', '3']);
    expect(service.inputs.additionalLocations).toEqual([
      { location: 'westus', sku: { name: 'Premium', capacity: 1 }, zones: ['1', '2', '3'] },
    ]);
  });

  test('S10 a non-Premium sku drops additionalLocations', async () => {
    const { service } = await deployApim({ additionalLocations: [{ location: 'westus' }] }, { stack: 'prd' });

    expect(service.inputs.additionalLocations).toBeUndefined();
    expect(service.inputs.zones).toEqual(['1', '2', '3']);
  });

  test('S10 Consumption sku gets no zones even in prd', async () => {
    const { service } = await deployApim({ sku: { name: 'Consumption', capacity: 0 } }, { stack: 'prd' });

    expect(service.inputs.zones).toBeUndefined();
  });

  test('S10 permissions grant one role to the service identity', async () => {
    const { byType } = await deployApim({
      enableResourceIdentity: true,
      permissions: [{ resource: { id: 'vault1_id', resourceName: 'vault1' }, roleNames: ['Key Vault Secrets User'] }],
    });

    const roles = byType(ROLE_ASSIGNMENT);
    expect(roles).toHaveLength(1);
    expect(roles[0].inputs.principalId).toBe('apim-1_principal');
    expect(roles[0].inputs.scope).toBe('vault1_id');
  });

  test('getOutputs returns the service id, name and resource group', async () => {
    const { pulumi, apim } = await deployApim({});

    const outputs = apim.getOutputs();
    expect(await pulumi.output(outputs.id).promise()).toBe('apim-1_id');
    expect(await pulumi.output(outputs.resourceName).promise()).toBe('apim-1');
    expect(await pulumi.output(outputs.resourceGroupName).promise()).toBe('rg');
  });
});
