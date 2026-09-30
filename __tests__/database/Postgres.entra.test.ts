import { asSecret, withStack, restoreStack } from '../testUtils/pulumiMocks';

// DRK-1819 (PULUMI-SEC-005): a Postgres server with Entra auth on must register the admin group as
// its Entra administrator (mirroring MySql.enableADAdmin), and the `<name>-postgres-login` vault
// secret must hold the login the server actually uses — the generated one when the caller omits it.

const ENTRA_ADMIN_TYPE = 'azure-native:dbforpostgresql:AdministratorsMicrosoftEntra';
const VAULT_SECRET_TYPE = 'drunk-pulumi:vault:VaultSecretResourceMock';
const TENANT_ID = 'TENANT-1';

const groupRoles = {
  admin: { objectId: 'GRP-ADMIN-OID', displayName: 'grp-admin' },
  contributor: { objectId: 'GRP-CONTRIB-OID', displayName: 'grp-contributor' },
  readOnly: { objectId: 'GRP-READONLY-OID', displayName: 'grp-readonly' },
};

const vaultInfo = { resourceGroupName: 'vault-rg', resourceName: 'vault1', id: 'vault1_id' };

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
  administratorLogin: 'admin',
  version: '16',
  sku: { name: 'Standard_B2ms', tier: 'Burstable' },
  enableAzureADAdmin: false,
  // Supplying this avoids the component creating its own UserAssignedIdentity child resource.
  defaultUAssignedId: { id: 'uid_id', clientId: 'c', objectId: 'o', resourceName: 'uid', resourceGroupName: 'rg' },
};

// Pins the generated login's random suffix so the expected login is a literal.
const pinRandomString = (args: { type: string }) =>
  args.type === 'random:index/randomString:RandomString' ? { result: 'RND' } : {};

async function buildPostgres(props: any) {
  const { pulumi, Postgres, captured } = withStack(
    'dev',
    (p) => {
      const mod: typeof import('../../src/database/Postgres') = require('../../src/database/Postgres');
      return { pulumi: p, Postgres: mod.Postgres };
    },
    pinRandomString,
  );

  const pg = new Postgres('pg1', { ...baseArgs, ...props } as any);
  await pulumi.output(pg.id).promise();
  // Admin and vault secrets are siblings of `server`, not wired back through any Postgres output —
  // give their promise chains one more tick to settle after the server resolves.
  await new Promise((resolve) => setImmediate(resolve));
  return captured;
}

describe('Postgres — Entra administrator and login secret (DRK-1819)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  const ORIGINAL_CONFIG = process.env.PULUMI_CONFIG;

  beforeEach(() => {
    // azureEnv.tenantId is read from PULUMI_CONFIG at module load; withStack reloads the modules.
    process.env.PULUMI_CONFIG = JSON.stringify({ 'azure-native:config:tenantId': TENANT_ID });
  });

  afterEach(() => {
    restoreStack(ORIGINAL_STACK);
    if (ORIGINAL_CONFIG === undefined) delete process.env.PULUMI_CONFIG;
    else process.env.PULUMI_CONFIG = ORIGINAL_CONFIG;
  });

  test('S1 — enableAzureADAdmin with groupRoles registers the admin group as the Entra administrator', async () => {
    const captured = await buildPostgres({ enableAzureADAdmin: true, groupRoles });

    const admins = captured.filter((c) => c.type === ENTRA_ADMIN_TYPE);
    expect(admins).toHaveLength(1);
    expect(admins[0].inputs.objectId).toBe('GRP-ADMIN-OID');
    expect(admins[0].inputs.principalName).toBe('grp-admin');
    expect(admins[0].inputs.principalType).toBe('group');
    expect(admins[0].inputs.tenantId).toBe(TENANT_ID);
    expect(admins[0].inputs.serverName).toBe('pg1');
    expect(admins[0].inputs.resourceGroupName).toBe('rg');
  });

  test('S2 — groupRoles with enableAzureADAdmin false registers no Entra administrator', async () => {
    const captured = await buildPostgres({ enableAzureADAdmin: false, groupRoles });

    expect(captured.find((c) => c.type === 'azure-native:dbforpostgresql:Server')).toBeDefined();
    expect(captured.filter((c) => c.type === ENTRA_ADMIN_TYPE)).toHaveLength(0);
  });

  test('S3 — enableAzureADAdmin without groupRoles registers no Entra administrator and does not throw', async () => {
    const captured = await buildPostgres({ enableAzureADAdmin: true, groupRoles: undefined });

    expect(captured.find((c) => c.type === 'azure-native:dbforpostgresql:Server')).toBeDefined();
    expect(captured.filter((c) => c.type === ENTRA_ADMIN_TYPE)).toHaveLength(0);
  });

  test('S4 — omitted administratorLogin writes the generated login to the login secret', async () => {
    const captured = await buildPostgres({ vaultInfo, administratorLogin: undefined });

    const server = captured.find((c) => c.type === 'azure-native:dbforpostgresql:Server')!;
    const loginSecret = captured.find((c) => c.type === VAULT_SECRET_TYPE && c.name === 'pg1-postgres-login');
    expect(server.inputs.administratorLogin).toBe('pg1-admin-RND');
    expect(loginSecret).toBeDefined();
    expect(loginSecret!.inputs.value).toEqual(asSecret('pg1-admin-RND'));
  });

  test('S5 — supplied administratorLogin is written to the login secret', async () => {
    const captured = await buildPostgres({ vaultInfo, administratorLogin: 'admin' });

    const loginSecret = captured.find((c) => c.type === VAULT_SECRET_TYPE && c.name === 'pg1-postgres-login');
    expect(loginSecret).toBeDefined();
    expect(loginSecret!.inputs.value).toEqual(asSecret('admin'));
  });
});
