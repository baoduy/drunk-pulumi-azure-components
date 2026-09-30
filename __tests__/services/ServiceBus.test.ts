import * as pulumi from '@pulumi/pulumi';

type Captured = { type: string; name: string; inputs: any };
const captured: Captured[] = [];

pulumi.runtime.setMocks({
  newResource: (args: pulumi.runtime.MockResourceArgs) => {
    captured.push({ type: args.type, name: args.name, inputs: args.inputs });
    // PrivateEndpoint reads customDnsConfigs[].ipAddresses back off its own resource state.
    const dns =
      args.type === 'azure-native:network:PrivateEndpoint' ? { customDnsConfigs: [{ ipAddresses: ['10.0.0.4'] }] } : {};
    return { id: `${args.name}_id`, state: { ...args.inputs, name: args.name, ...dns } };
  },
  call: (args: pulumi.runtime.MockCallArgs) =>
    args.token === 'azure-native:servicebus:listNamespaceKeys'
      ? { primaryConnectionString: 'primary-conn', secondaryConnectionString: 'secondary-conn' }
      : args.inputs,
});

// Imported after setMocks so module-level resources register against the mock monitor.
import { ServiceBus } from '../../src/services/ServiceBus';

const rsGroup = { resourceGroupName: 'rg', location: 'eastus' };
const vaultInfo = { resourceGroupName: 'rg', resourceName: 'kv1', id: 'kv1_id' };
const premium = { name: 'Premium', tier: 'Premium', capacity: 1 } as const;
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

const ofType = (type: string) => captured.filter((c) => c.type === type);
const named = (type: string, name: string) => ofType(type).find((c) => c.name === name)?.inputs;

describe('ServiceBus', () => {
  beforeEach(() => {
    captured.length = 0;
  });

  test('creates queues, topics and subscriptions with the default options, caller values winning', async () => {
    const bus = new ServiceBus('sb-q', {
      rsGroup,
      disableLocalAuth: true,
      sku: premium,
      queues: { orders: { maxDeliveryCount: 3 } },
      topics: { events: { subscriptions: { audit: { maxDeliveryCount: 7 } } } },
    } as any);
    await pulumi.output(bus.id).promise();
    await settle();

    const queue = named('azure-native:servicebus:Queue', 'sb-q-orders');
    expect(queue.queueName).toBe('orders');
    expect(queue.maxDeliveryCount).toBe(3);
    expect(queue.defaultMessageTimeToLive).toBe('P5D');

    const topic = named('azure-native:servicebus:Topic', 'sb-q-events');
    expect(topic.topicName).toBe('events');
    expect(topic.defaultMessageTimeToLive).toBe('P5D');

    const sub = ofType('azure-native:servicebus:Subscription')[0];
    expect(sub.name).toBe('sb-q-sb-q-events-audit');
    expect(sub.inputs.subscriptionName).toBe('audit');
    expect(sub.inputs.topicName).toBe('sb-q-events');
    expect(sub.inputs.maxDeliveryCount).toBe(7);
  });

  test('with local auth and a vault it creates listen/send rules and stores their connection strings', async () => {
    const bus = new ServiceBus('sb-auth', { rsGroup, disableLocalAuth: false, vaultInfo, sku: premium } as any);
    await pulumi.output(bus.id).promise();
    await settle();

    expect(named('azure-native:servicebus:NamespaceAuthorizationRule', 'sb-auth-listen').rights).toEqual(['Listen']);
    expect(named('azure-native:servicebus:NamespaceAuthorizationRule', 'sb-auth-send').rights).toEqual([
      'Listen',
      'Send',
    ]);

    const secretNames = ofType('drunk:azure:VaultSecret').map((c) => c.name);
    expect(secretNames).toEqual(
      expect.arrayContaining([
        'sb-auth-RootManageSharedAccessKey-primary-conn',
        'sb-auth-sb-auth-listen-primary-conn',
        'sb-auth-sb-auth-send-secondary-conn',
      ]),
    );
  });

  test('with disableLocalAuth it creates no authorization rules', async () => {
    const bus = new ServiceBus('sb-noauth', { rsGroup, disableLocalAuth: true, sku: premium } as any);
    await pulumi.output(bus.id).promise();
    await settle();

    expect(ofType('azure-native:servicebus:NamespaceAuthorizationRule')).toEqual([]);
  });

  test('with privateLink it disables public access and creates a private endpoint', async () => {
    const bus = new ServiceBus('sb-pl', {
      rsGroup,
      disableLocalAuth: true,
      sku: premium,
      network: { privateLink: { subnetInfo: { subnetId: 'snet' } } },
    } as any);
    await pulumi.output(bus.id).promise();
    await settle();

    expect(named('azure-native:servicebus:Namespace', 'sb-pl').publicNetworkAccess).toBe('Disabled');
    // R2: no rules, so defaultAction stays Allow; the rule set's own publicNetworkAccess (SDK default Enabled)
    // must match the namespace, or it reopens the private-link-only bus (DRK-1842 B1).
    const ruleSet = named('azure-native:servicebus:NamespaceNetworkRuleSet', 'sb-pl');
    expect(ruleSet.defaultAction).toBe('Allow');
    expect(ruleSet.publicNetworkAccess).toBe('Disabled');
    expect(ofType('azure-native:network:PrivateEndpoint').length).toBe(1);
  });

  test('with publicNetworkAccess true it keeps public access enabled', async () => {
    const bus = new ServiceBus('sb-pub', {
      rsGroup,
      disableLocalAuth: true,
      sku: premium,
      network: { publicNetworkAccess: true },
    } as any);
    await pulumi.output(bus.id).promise();
    await settle();

    expect(named('azure-native:servicebus:Namespace', 'sb-pub').publicNetworkAccess).toBe('Enabled');
    expect(named('azure-native:servicebus:NamespaceNetworkRuleSet', 'sb-pub').publicNetworkAccess).toBe('Enabled');
  });

  test('with ipRules only it keeps public access enabled on the namespace and its rule set', async () => {
    const bus = new ServiceBus('sb-ip', {
      rsGroup,
      disableLocalAuth: true,
      sku: premium,
      network: { ipRules: ['1.2.3.4'] },
    } as any);
    await pulumi.output(bus.id).promise();
    await settle();

    expect(named('azure-native:servicebus:Namespace', 'sb-ip').publicNetworkAccess).toBe('Enabled');
    const ruleSet = named('azure-native:servicebus:NamespaceNetworkRuleSet', 'sb-ip');
    expect(ruleSet.publicNetworkAccess).toBe('Enabled');
    expect(ruleSet.defaultAction).toBe('Deny');
    expect(ruleSet.trustedServiceAccessEnabled).toBe(true);
  });
});
