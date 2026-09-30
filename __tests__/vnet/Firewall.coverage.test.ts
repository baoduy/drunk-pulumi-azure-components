import { Captured, restoreStack, withStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1852 coverage: Firewall branches the DRK-1821 acceptance tests do not reach (insights,
 * transport security, SNAT route server, rule collection groups, outputs). Pins today's behaviour.
 */

const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
const POLICY = 'azure-native:network:FirewallPolicy';
const FIREWALL = 'azure-native:network:AzureFirewall';
const RULE_GROUP = 'azure-native:network:FirewallPolicyRuleCollectionGroup';

const STANDARD = { name: 'AZFW_VNet', tier: 'Standard' } as const;
const BASIC = { name: 'AZFW_VNet', tier: 'Basic' } as const;

const { Firewall, captured } = withStack(
  'dev',
  () => {
    const mod: typeof import('../../src/vnet/Firewall') = require('../../src/vnet/Firewall');
    return { Firewall: mod.Firewall };
  },
  ({ type }) => (type === FIREWALL ? { ipConfigurations: [{ privateIPAddress: '10.0.1.4' }] } : {}),
);

let deployments = 0;

const resolve = <T>(output: { apply: (fn: (v: T) => unknown) => unknown }) =>
  new Promise<T>((done) => output.apply((v) => done(v)));

async function deploy(args: Record<string, unknown>) {
  const name = `cov-fw-${++deployments}`;
  const fw = new Firewall(name, { rsGroup: { resourceGroupName: 'rg', location: 'eastus' }, ...args } as any);
  await resolve(fw.firewall.id);
  await resolve(fw.policy.id);

  const all = (type: string) => (captured as Captured[]).filter((c) => c.type === type && c.name.startsWith(name));
  const find = (type: string) => (captured as Captured[]).find((c) => c.type === type && c.name === name)!.inputs;
  return { fw, name, policy: find(POLICY), firewall: find(FIREWALL), ruleGroups: all(RULE_GROUP) };
}

describe('Firewall — untouched branches (DRK-1852 coverage)', () => {
  afterAll(() => restoreStack(ORIGINAL_STACK));

  test('logs with regional workspaces: policy insights point at the default and regional workspaces', async () => {
    const { policy } = await deploy({
      sku: STANDARD,
      policy: {},
      logs: {
        defaultWorkspace: { id: '/ws/default', resourceName: 'default', resourceGroupName: 'rg' },
        regionalWorkspaces: [{ id: '/ws/sea', region: 'southeastasia' }],
      },
    });

    expect(policy.insights).toEqual({
      isEnabled: true,
      logAnalyticsResources: {
        defaultWorkspaceId: { id: '/ws/default' },
        workspaces: [{ region: 'southeastasia', workspaceId: { id: '/ws/sea' } }],
      },
    });
  });

  test('logs without regional workspaces: insights carry only the default workspace', async () => {
    const { policy } = await deploy({
      sku: STANDARD,
      policy: {},
      logs: { defaultWorkspace: { id: '/ws/default', resourceName: 'default', resourceGroupName: 'rg' } },
    });

    expect(policy.insights).toEqual({
      isEnabled: true,
      logAnalyticsResources: { defaultWorkspaceId: { id: '/ws/default' } },
    });
  });

  test('no logs: insights undefined, snat auto-learn and default threat-intel whitelist applied', async () => {
    const { policy } = await deploy({ sku: STANDARD, policy: {} });

    expect(policy.insights).toBeUndefined();
    expect(policy.snat).toEqual({ autoLearnPrivateRanges: 'Enabled', privateRanges: ['IANAPrivateRanges'] });
    expect(policy.threatIntelWhitelist).toEqual({ fqdns: ['*.microsoft.com'], ipAddresses: ['20.3.4.5'] });
    expect(policy.sku).toEqual({ name: 'AZFW_VNet', tier: 'Standard' });
    expect(policy.resourceGroupName).toBe('rg');
  });

  test('caller threatIntelWhitelist is applied verbatim', async () => {
    const { policy } = await deploy({ sku: STANDARD, policy: { threatIntelWhitelist: { fqdns: ['*.contoso.com'] } } });

    expect(policy.threatIntelWhitelist).toEqual({ fqdns: ['*.contoso.com'] });
  });

  test('transportSecurityCA on Standard tier: policy transportSecurity carries the CA', async () => {
    const { policy } = await deploy({
      sku: STANDARD,
      policy: { transportSecurityCA: { name: 'ca', keyVaultSecretId: '/kv/ca' } },
    });

    expect(policy.transportSecurity).toEqual({ certificateAuthority: { name: 'ca', keyVaultSecretId: '/kv/ca' } });
  });

  test('transportSecurityCA on Basic tier: policy transportSecurity is undefined', async () => {
    const { policy } = await deploy({
      sku: BASIC,
      policy: { transportSecurityCA: { name: 'ca', keyVaultSecretId: '/kv/ca' } },
    });

    expect(policy.transportSecurity).toBeUndefined();
  });

  test('snat routeServerId: firewall additionalProperties carry the route server id and caller properties', async () => {
    const { firewall } = await deploy({
      sku: STANDARD,
      policy: {},
      snat: { routeServerId: '/rs/1' },
      additionalProperties: { 'Network.DNS.EnableProxy': 'true' },
    });

    expect(firewall.additionalProperties).toEqual({
      'Network.DNS.EnableProxy': 'true',
      'Network.RouteServerInfo.RouteServerID': '/rs/1',
    });
  });

  test('snat without routeServerId: firewall additionalProperties stay empty', async () => {
    const { firewall } = await deploy({ sku: STANDARD, policy: {}, snat: {} });

    expect(firewall.additionalProperties).toEqual({});
  });

  test('Basic tier: firewall pinned to zone 1 and linked to its policy', async () => {
    const { firewall, name } = await deploy({ sku: BASIC, policy: {} });

    expect(firewall.zones).toEqual(['1']);
    expect(firewall.firewallPolicy).toEqual({ id: `${name}_id` });
    expect(firewall.sku).toEqual({ name: 'AZFW_VNet', tier: 'Basic' });
  });

  test('rules: one rule collection group per rule, in priority order, on the policy', async () => {
    const { ruleGroups, name } = await deploy({
      sku: STANDARD,
      policy: {
        rules: [
          { name: 'second', priority: 200 },
          { name: 'first', priority: 100 },
        ],
      },
    });

    expect(ruleGroups.map((g) => g.name)).toEqual([`${name}-first`, `${name}-second`]);
    expect(ruleGroups[0].inputs).toMatchObject({
      name: 'first',
      priority: 100,
      resourceGroupName: 'rg',
      firewallPolicyName: name,
    });
  });

  test('no rules: no rule collection group is created', async () => {
    const { ruleGroups } = await deploy({ sku: STANDARD, policy: {} });

    expect(ruleGroups).toHaveLength(0);
  });

  test('Standard tier on a non-prd stack: firewall has no zones', async () => {
    const { firewall } = await deploy({ sku: STANDARD, policy: {} });

    expect(firewall.zones).toBeUndefined();
  });

  test('getOutputs: firewall and policy ids, names, resource group and private IP', async () => {
    const { fw, name } = await deploy({ sku: STANDARD, policy: {} });
    const outputs = fw.getOutputs();

    expect(await resolve(outputs.firewall.id)).toBe(`${name}_id`);
    expect(await resolve(outputs.firewall.resourceName)).toBe(name);
    expect(await resolve(outputs.firewall.resourceGroupName)).toBe('rg');
    expect(await resolve(outputs.policy.id)).toBe(`${name}_id`);
    expect(await resolve(outputs.policy.resourceName)).toBe(name);
    expect(await resolve(outputs.policy.resourceGroupName)).toBe('rg');
    expect(await resolve(outputs.privateIpAddress)).toBe('10.0.1.4');
  });
});
