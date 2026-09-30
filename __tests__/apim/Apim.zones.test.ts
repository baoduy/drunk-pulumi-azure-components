import { withStack, restoreStack, Captured } from '../testUtils/pulumiMocks';

/**
 * DRK-1822 Section A, programmer tests beside the frozen ATs in Apim.tiering.test.ts:
 * the Basic arm of R3, the Premium-only additional locations (§3 row 2, KEEP), the dev arm of
 * R5 for AppContainerEnv, and the Apim child resources the ATs do not reach.
 */

const SERVICE = 'azure-native:apimanagement:ApiManagementService';

async function createApim(stackName: string, props: any): Promise<Captured[]> {
  const { pulumi, service, captured } = withStack(stackName, (p) => {
    const mod: typeof import('../../src/apim/Apim') = require('../../src/apim/Apim');
    const service = new mod.Apim('apim1', {
      rsGroup: { resourceGroupName: 'rg', location: 'southeastasia' },
      sku: { name: 'Developer', capacity: 1 },
      publisherName: 'drunk',
      disableSignIn: true,
      ...props,
    });
    return { pulumi: p, service };
  });
  await pulumi.output(service.id).promise();
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
  return captured;
}

const serviceInputs = async (stackName: string, props: any) =>
  (await createApim(stackName, props)).find((c) => c.type === SERVICE)!.inputs;

describe('Apim — zones on Basic and on additional locations (DRK-1822)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test("prd Basic with caller zones ['1'] sends no zones (R3)", async () => {
    const inputs = await serviceInputs('prd', { sku: { name: 'Basic', capacity: 1 }, zones: ['1'] });
    expect(inputs.zones).toBeUndefined();
  });

  test('prd Premium additional locations carry the service sku and zones 1, 2 and 3', async () => {
    const inputs = await serviceInputs('prd', {
      sku: { name: 'Premium', capacity: 3 },
      additionalLocations: [{ location: 'eastasia' }],
    });
    expect(inputs.additionalLocations).toEqual([
      { location: 'eastasia', sku: { name: 'Premium', capacity: 3 }, zones: ['1', '2', '3'] },
    ]);
  });

  test('prd Developer drops additional locations', async () => {
    const inputs = await serviceInputs('prd', { additionalLocations: [{ location: 'eastasia' }] });
    expect(inputs.additionalLocations).toBeUndefined();
  });
});

describe('Apim — child resources and hostnames', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('logs.appInsight creates an Application Insights logger with the instrumentation key', async () => {
    const captured = await createApim('dev', {
      logs: { appInsight: { id: 'insight_id', resourceName: 'insight1', instrumentationKey: 'ikey' } },
    });
    const logger = captured.find((c) => c.type === 'azure-native:apimanagement:Logger');
    expect(logger!.inputs.loggerType).toBe('applicationInsights');
    expect(logger!.inputs.resourceId).toBe('insight_id');
    expect(logger!.inputs.credentials).toEqual({ instrumentationKey: 'ikey' });
  });

  test('permissions grant the service identity the named role on the resource', async () => {
    const captured = await createApim('dev', {
      permissions: [
        { roleNames: ['Reader'], resource: { id: 'res_id', resourceName: 'res1', resourceGroupName: 'rg' } },
      ],
    });
    const roles = captured.filter((c) => c.inputs?.roleName === 'Reader');
    expect(roles).toHaveLength(1);
    expect(roles[0].inputs.scope).toBe('res_id');
    expect(roles[0].inputs.principalId).toBe('apim1_principal');
  });

  test('a hostname configuration becomes a Key Vault proxy hostname using the user-assigned client id', async () => {
    const inputs = await serviceInputs('dev', {
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
});

describe('AppContainerEnv — caller zoneRedundant wins outside PRD (DRK-1822 R5)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('dev caller zoneRedundant true without vnetConfiguration is sent as true', async () => {
    const { pulumi, env, captured } = withStack('dev', (p) => {
      const mod: typeof import('../../src/app/AppContainerEnv') = require('../../src/app/AppContainerEnv');
      const env = new mod.AppContainerEnv('ace1', {
        rsGroup: { resourceGroupName: 'rg', location: 'southeastasia' },
        zoneRedundant: true,
      } as any);
      return { pulumi: p, env };
    });
    await pulumi.output(env.id).promise();
    expect(captured.find((c) => c.type === 'azure-native:app:ManagedEnvironment')!.inputs.zoneRedundant).toBe(true);
  });
});
