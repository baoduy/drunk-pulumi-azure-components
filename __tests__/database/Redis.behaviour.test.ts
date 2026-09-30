import { withStack, restoreStack, Captured } from '../testUtils/pulumiMocks';

// DRK-1844: pins the pre-existing behaviour of the Redis component (server, network, maintenance
// schedule and vault connection strings). The access-policy ATs live in Redis.test.ts.

const REDIS = 'azure-native:redis:Redis';
const FIREWALL_RULE = 'azure-native:redis:FirewallRule';
const PATCH_SCHEDULE = 'azure-native:redis:PatchSchedule';
const PRIVATE_ENDPOINT = 'azure-native:network:PrivateEndpoint';

const PE_SUBNET = '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet/subnets/snet';
const HOST = 'cache-1.redis.cache.windows.net';

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
  sku: { name: 'Standard', family: 'C', capacity: 1 },
  disableAccessKeyAuthentication: true,
};

const vaultInfo = { resourceGroupName: 'vault-rg', resourceName: 'vault1', id: 'vault1_id' };

const defaultUAssignedId = {
  id: 'uid-default-id',
  clientId: 'CLIENT-DEFAULT',
  principalId: 'PRINCIPAL-DEFAULT',
  resourceName: 'uid-default',
  resourceGroupName: 'rg',
};

// Every withStack call reloads @pulumi/pulumi, and each copy holds a process `exit` listener while
// its RPCs settle. This file runs more than 10 such reloads, so lift the limit for this file only.
const ORIGINAL_MAX_LISTENERS = process.getMaxListeners();
beforeAll(() => process.setMaxListeners(50));
afterAll(() => process.setMaxListeners(ORIGINAL_MAX_LISTENERS));

async function deployRedis(props: any, { stack = 'dev', hostName }: { stack?: string; hostName?: string } = {}) {
  const { pulumi, Redis, captured } = withStack(stack, (p) => {
    const mod: typeof import('../../src/database/Redis') = require('../../src/database/Redis');
    return { pulumi: p, Redis: mod.Redis };
  });

  // Same resource capture as withStack, plus literal keys for the listRedisKeys invoke.
  pulumi.runtime.setMocks({
    newResource: (args: any) => {
      captured.push({ type: args.type, name: args.name, inputs: args.inputs });
      return {
        id: `${args.name}_id`,
        state: {
          ...args.inputs,
          name: args.name,
          ...(args.type === REDIS && hostName ? { hostName } : {}),
          // PrivateEndpoint reads customDnsConfigs[].ipAddresses back off its own resource state.
          ...(args.type === PRIVATE_ENDPOINT ? { customDnsConfigs: [{ ipAddresses: ['10.0.0.4'] }] } : {}),
        },
      };
    },
    call: (args: any) => {
      if (args.token !== 'azure-native:redis:listRedisKeys') return args.inputs;
      // Keys come back only when the invoke names this cache in its resource group.
      const { name, resourceGroupName } = args.inputs;
      return name === 'cache-1' && resourceGroupName === 'rg'
        ? { primaryKey: 'PRIMARY-KEY', secondaryKey: 'SECONDARY-KEY' }
        : {};
    },
  });

  const redis = new Redis('cache-1', { ...baseArgs, ...props } as any);
  await pulumi.output(redis.id).promise();
  // Firewall rules from ipRules and the vault secrets are built inside `apply` callbacks.
  await new Promise((resolve) => setTimeout(resolve, 50));

  const byType = (type: string) => captured.filter((c: Captured) => c.type === type);
  return { pulumi, redis, captured, byType, server: byType(REDIS)[0] };
}

async function resolveSecrets(pulumi: typeof import('@pulumi/pulumi'), redis: any) {
  const secrets: Record<string, unknown> = redis._secrets;
  const resolved: Record<string, unknown> = {};
  for (const key of Object.keys(secrets)) resolved[key] = await pulumi.output(secrets[key]).promise();
  return resolved;
}

describe('Redis — server', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('applies the secure defaults when the caller sets none', async () => {
    const { server } = await deployRedis({});

    expect(server.inputs.redisVersion).toBe('6.0');
    expect(server.inputs.minimumTlsVersion).toBe('1.2');
    expect(server.inputs.enableNonSslPort).toBe(false);
    expect(server.inputs.updateChannel).toBe('Stable');
    expect(server.inputs.publicNetworkAccess).toBe('Enabled');
    expect(server.inputs.sku).toEqual({ name: 'Standard', family: 'C', capacity: 1 });
    expect(server.inputs.zones).toBeUndefined();
    expect(server.inputs.identity).toBeUndefined();
  });

  test('keeps the caller redisVersion', async () => {
    const { server } = await deployRedis({ redisVersion: '7.2' });

    expect(server.inputs.redisVersion).toBe('7.2');
  });

  test('defaults the sku to Basic C0 when none is given', async () => {
    const { server } = await deployRedis({ sku: undefined });

    expect(server.inputs.sku).toEqual({ name: 'Basic', family: 'C', capacity: 0 });
  });

  test('Premium in prd defaults to zones 1, 2 and 3', async () => {
    const { server } = await deployRedis({ sku: { name: 'Premium', family: 'P', capacity: 1 } }, { stack: 'prd' });

    expect(server.inputs.zones).toEqual(['1', '2', '3']);
  });

  test('Premium keeps the caller zones', async () => {
    const { server } = await deployRedis({ sku: { name: 'Premium', family: 'P', capacity: 1 }, zones: ['2'] });

    expect(server.inputs.zones).toEqual(['2']);
  });

  test('a non-Premium sku gets no zones even in prd', async () => {
    const { server } = await deployRedis({ zones: ['2'] }, { stack: 'prd' });

    expect(server.inputs.zones).toBeUndefined();
  });

  test('resource identity without a user-assigned id is SystemAssigned', async () => {
    const { server } = await deployRedis({ enableResourceIdentity: true });

    expect(server.inputs.identity).toEqual({ type: 'SystemAssigned' });
  });

  test('resource identity with a user-assigned id is UserAssigned with that id', async () => {
    const { server } = await deployRedis({ enableResourceIdentity: true, defaultUAssignedId });

    expect(server.inputs.identity).toEqual({ type: 'UserAssigned', userAssignedIdentities: ['uid-default-id'] });
  });

  test('passes the network subnet and static IP to the server', async () => {
    const { server } = await deployRedis({ network: { subnetId: 'subnet-1', staticIP: '10.0.0.5' } });

    expect(server.inputs.subnetId).toBe('subnet-1');
    expect(server.inputs.staticIP).toBe('10.0.0.5');
  });

  test('registers as a drunk:azure:Redis component', async () => {
    const { captured } = await deployRedis({});

    expect(captured[0]).toMatchObject({ type: 'drunk:azure:Redis', name: 'cache-1' });
  });

  test('getOutputs returns the server id, name and resource group', async () => {
    const { pulumi, redis } = await deployRedis({});

    const outputs = redis.getOutputs();
    expect(await pulumi.output(outputs.id).promise()).toBe('cache-1_id');
    expect(await pulumi.output(outputs.resourceName).promise()).toBe('cache-1');
    expect(await pulumi.output(outputs.resourceGroupName).promise()).toBe('rg');
    expect(outputs.privateLink).toBeUndefined();
  });
});

describe('Redis — network', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('no network args means no firewall rule and no private endpoint', async () => {
    const { byType } = await deployRedis({});

    expect(byType(FIREWALL_RULE)).toHaveLength(0);
    expect(byType(PRIVATE_ENDPOINT)).toHaveLength(0);
  });

  test('allowAllInbound adds one allow-all rule and ignores ipRules', async () => {
    const { byType } = await deployRedis({ network: { allowAllInbound: true, ipRules: ['1.2.3.4'] } });

    const rules = byType(FIREWALL_RULE);
    expect(rules).toHaveLength(1);
    expect(rules[0].name).toBe('cache_1-firewall-allow-all');
    expect(rules[0].inputs).toEqual({
      resourceGroupName: 'rg',
      ruleName: 'cache_1_firewall_allow_all',
      cacheName: 'cache-1',
      startIP: '0.0.0.0',
      endIP: '255.255.255.255',
    });
  });

  test('ipRules add one rule per address or range', async () => {
    const { byType } = await deployRedis({ network: { ipRules: ['10.0.0.0/24', '1.2.3.4'] } });

    const rules = byType(FIREWALL_RULE);
    expect(rules.map((r) => r.name)).toEqual(['cache_1-firewall-0', 'cache_1-firewall-1']);
    expect(rules[0].inputs).toEqual({
      resourceGroupName: 'rg',
      ruleName: 'cache_1_firewall_0',
      cacheName: 'cache-1',
      startIP: '10.0.0.0',
      endIP: '10.0.0.255',
    });
    expect(rules[1].inputs.ruleName).toBe('cache_1_firewall_1');
    expect(rules[1].inputs.startIP).toBe('1.2.3.4');
    expect(rules[1].inputs.endIP).toBe('1.2.3.4');
  });

  test('privateLink adds a private endpoint and disables public access', async () => {
    const { redis, byType, server } = await deployRedis({
      network: { privateLink: { subnetInfo: { subnetId: PE_SUBNET } } },
    });

    expect(byType(PRIVATE_ENDPOINT)).toHaveLength(1);
    expect(server.inputs.publicNetworkAccess).toBe('Disabled');
    expect(redis.getOutputs().privateLink).toBeDefined();
  });

  test('publicNetworkAccess keeps public access on alongside privateLink', async () => {
    const { server } = await deployRedis({
      network: { publicNetworkAccess: true, privateLink: { subnetInfo: { subnetId: PE_SUBNET } } },
    });

    expect(server.inputs.publicNetworkAccess).toBe('Enabled');
  });
});

describe('Redis — maintenance schedule', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('defaults to a 5 hour Sunday 00:00 UTC window', async () => {
    const { byType } = await deployRedis({});

    const schedules = byType(PATCH_SCHEDULE);
    expect(schedules).toHaveLength(1);
    expect(schedules[0].inputs.name).toBe('cache-1');
    expect(schedules[0].inputs.default).toBe('default');
    expect(schedules[0].inputs.scheduleEntries).toEqual([
      { dayOfWeek: 'Sunday', startHourUtc: 0, maintenanceWindow: 'PT5H' },
    ]);
  });

  test('keeps the caller schedule', async () => {
    const scheduleEntries = [{ dayOfWeek: 'Wednesday', startHourUtc: 3, maintenanceWindow: 'PT6H' }];
    const { byType } = await deployRedis({ scheduleEntries });

    expect(byType(PATCH_SCHEDULE)[0].inputs.scheduleEntries).toEqual([
      { dayOfWeek: 'Wednesday', startHourUtc: 3, maintenanceWindow: 'PT6H' },
    ]);
  });
});

describe('Redis — vault connection strings', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('access keys enabled: connection strings carry the primary key', async () => {
    const { pulumi, redis } = await deployRedis(
      { vaultInfo, disableAccessKeyAuthentication: false },
      { hostName: HOST },
    );

    expect(await resolveSecrets(pulumi, redis)).toEqual({
      'cache-1-redis-host': HOST,
      'cache-1-redis-pass': 'PRIMARY-KEY',
      'cache-1-redis-port': '6380',
      'cache-1-redis-conn-nodejs': `rediss://:PRIMARY-KEY@${HOST}:6380`,
      'cache-1-redis-conn-dotnet': `${HOST}:6380,password=PRIMARY-KEY,ssl=True,abortConnect=False`,
      'cache-1-redis-conn-python': `rediss://:PRIMARY-KEY@${HOST}:6380`,
      'cache-1-redis-conn': `${HOST}:6380,password=PRIMARY-KEY,ssl=True,abortConnect=False`,
    });
  });

  test('access keys disabled: connection strings carry no key', async () => {
    const { pulumi, redis } = await deployRedis(
      { vaultInfo, disableAccessKeyAuthentication: true },
      { hostName: HOST },
    );

    expect(await resolveSecrets(pulumi, redis)).toEqual({
      'cache-1-redis-host': HOST,
      'cache-1-redis-pass': 'PRIMARY-KEY',
      'cache-1-redis-port': '6380',
      'cache-1-redis-conn-nodejs': `rediss://${HOST}:6380`,
      'cache-1-redis-conn-dotnet': `${HOST}:6380,ssl=True,abortConnect=False`,
      'cache-1-redis-conn-python': `rediss://${HOST}:6380`,
      'cache-1-redis-conn': `${HOST}:6380,ssl=True,abortConnect=False`,
    });
  });

  test('no host name yet means no secrets', async () => {
    const { pulumi, redis } = await deployRedis({ vaultInfo });

    expect(await resolveSecrets(pulumi, redis)).toEqual({});
  });

  test('no vaultInfo means no secrets', async () => {
    const { pulumi, redis } = await deployRedis({}, { hostName: HOST });

    expect(await resolveSecrets(pulumi, redis)).toEqual({});
  });
});
