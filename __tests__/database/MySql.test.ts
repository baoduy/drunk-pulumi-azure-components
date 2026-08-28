import { withStack, restoreStack } from '../testUtils/pulumiMocks';

// DRK-770 §3.5 / §5: the availabilityZone precedence bug — `(this.args.availabilityZone ?? azureEnv.isPrd) ? '3' : '1'`
// coerced ANY truthy engineer-supplied zone string to '3', discarding the actual value. Fixed to
// `this.args.availabilityZone ?? (azureEnv.isPrd ? '3' : '1')`.

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
  administratorLogin: 'admin',
  version: '16',
  sku: { name: 'Standard_B2ms', tier: 'Burstable' },
  enableAzureADAdmin: false,
  // Supplying this avoids the component creating its own UserAssignedIdentity child resource.
  defaultUAssignedId: { id: 'uid_id', clientId: 'c', objectId: 'o', resourceName: 'uid', resourceGroupName: 'rg' },
};

function createMySql(
  pulumi: typeof import('@pulumi/pulumi'),
  MySql: typeof import('../../src/database/MySql').MySql,
  props: any,
) {
  return new MySql('mysql1', { ...baseArgs, ...props } as any);
}

describe('MySql — availability zone defaulting', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('prd with no engineer zone defaults to zone 3', async () => {
    const { pulumi, MySql, captured } = withStack('prd', (p) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod: typeof import('../../src/database/MySql') = require('../../src/database/MySql');
      return { pulumi: p, MySql: mod.MySql };
    });

    const db = createMySql(pulumi, MySql, {});
    await pulumi.output(db.id).promise();
    const server = captured.find((c) => c.type === 'azure-native:dbformysql:Server')!;
    expect(server.inputs.availabilityZone).toBe('3');
  });

  test('outside prd with no engineer zone defaults to zone 1', async () => {
    const { pulumi, MySql, captured } = withStack('dev', (p) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod: typeof import('../../src/database/MySql') = require('../../src/database/MySql');
      return { pulumi: p, MySql: mod.MySql };
    });

    const db = createMySql(pulumi, MySql, {});
    await pulumi.output(db.id).promise();
    const server = captured.find((c) => c.type === 'azure-native:dbformysql:Server')!;
    expect(server.inputs.availabilityZone).toBe('1');
  });

  // Regression guard for the precedence bug: a prd engineer-supplied zone of '2' must stay '2',
  // not be coerced to '3' by the old `(zone ?? isPrd) ? '3' : '1'` truthiness check.
  test('an engineer-supplied zone in prd is honoured verbatim, not forced to 3', async () => {
    const { pulumi, MySql, captured } = withStack('prd', (p) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod: typeof import('../../src/database/MySql') = require('../../src/database/MySql');
      return { pulumi: p, MySql: mod.MySql };
    });

    const db = createMySql(pulumi, MySql, { availabilityZone: '2' });
    await pulumi.output(db.id).promise();
    const server = captured.find((c) => c.type === 'azure-native:dbformysql:Server')!;
    expect(server.inputs.availabilityZone).toBe('2');
  });
});

// Pre-existing behaviour, untouched by DRK-770, but this file is a touched class this cycle
// (the availabilityZone line above) so its other branches need coverage too.
describe('MySql — network rules, managed identity, AD admin and databases (pre-existing behaviour)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('creates an allow-all firewall rule, its own managed identity, an AD admin and databases', async () => {
    const { pulumi, MySql, captured } = withStack('dev', (p) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod: typeof import('../../src/database/MySql') = require('../../src/database/MySql');
      return { pulumi: p, MySql: mod.MySql };
    });

    const db = createMySql(pulumi, MySql, {
      defaultUAssignedId: undefined,
      enableResourceIdentity: true,
      enableAzureADAdmin: true,
      groupRoles: {
        admin: { objectId: 'admin_object_id', displayName: 'admins' },
        contributor: { objectId: 'contrib_object_id', displayName: 'contributors' },
        readOnly: { objectId: 'read_object_id', displayName: 'readers' },
      },
      network: { allowAllInbound: true },
      databases: [{ name: 'appdb' }],
    });
    await pulumi.output(db.id).promise();
    // FirewallRule/AzureADAdministrator/Database are fire-and-forget siblings of `server`, not
    // wired back through any MySql output — give their promise chains one more tick to settle.
    await new Promise((resolve) => setImmediate(resolve));

    expect(captured.find((c) => c.type === 'azure-native:dbformysql:FirewallRule')).toBeDefined();
    expect(captured.find((c) => c.type === 'azure-native:managedidentity:UserAssignedIdentity')).toBeDefined();
    expect(captured.find((c) => c.type === 'azure-native:dbformysql:AzureADAdministrator')).toBeDefined();
    expect(captured.find((c) => c.type === 'azure-native:dbformysql:Database')).toBeDefined();
  });

  test('creates a firewall rule per supplied IP', async () => {
    const { pulumi, MySql, captured } = withStack('dev', (p) => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod: typeof import('../../src/database/MySql') = require('../../src/database/MySql');
      return { pulumi: p, MySql: mod.MySql };
    });

    const db = createMySql(pulumi, MySql, { network: { ipRules: ['1.2.3.4'] } });
    await pulumi.output(db.id).promise();
    await new Promise((resolve) => setImmediate(resolve));

    const rule = captured.find((c) => c.type === 'azure-native:dbformysql:FirewallRule');
    expect(rule?.inputs.startIpAddress).toBe('1.2.3.4');
    expect(rule?.inputs.endIpAddress).toBe('1.2.3.4');
  });
});
