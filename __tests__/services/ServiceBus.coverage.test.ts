import { withStack, restoreStack, Captured } from '../testUtils/pulumiMocks';

/**
 * DRK-1821 §3 row 8: coverage for the ServiceBus branches the caller-input ATs do not reach
 * (queue defaults, topic defaults, local-auth rules, identity). Runs on a non-prd stack (`withStack('dev')`).
 */

jest.setTimeout(30000);

// Every withStack() reloads @pulumi/pulumi, which adds one process 'exit' listener; this file loads it
// more than the default 10 times. Raise the limit for this file only and restore it afterwards.
const ORIGINAL_MAX_LISTENERS = process.getMaxListeners();
beforeAll(() => process.setMaxListeners(ORIGINAL_MAX_LISTENERS + 20));
afterAll(() => process.setMaxListeners(ORIGINAL_MAX_LISTENERS));

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
  sku: { name: 'Standard' },
  disableLocalAuth: true,
};

async function createServiceBus(props: any, stack = 'dev'): Promise<Captured[]> {
  const { pulumi, ServiceBus, captured } = withStack(stack, (p) => {
    const mod: typeof import('../../src/services/ServiceBus') = require('../../src/services/ServiceBus');
    return { pulumi: p, ServiceBus: mod.ServiceBus };
  });
  const sb = new ServiceBus('sb1', { ...baseArgs, ...props } as any);
  await pulumi.output(sb.id).promise();
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
  return captured;
}

const namespaceInputs = async (props: any) =>
  (await createServiceBus(props)).find((c) => c.type === 'azure-native:servicebus:Namespace')!.inputs;

describe('ServiceBus — namespace, queues, topics and auth rules', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('a queue with no options gets the queue defaults', async () => {
    const captured = await createServiceBus({ queues: { jobs: {} } });
    const queue = captured.find((c) => c.type === 'azure-native:servicebus:Queue');
    expect(queue).toBeDefined();
    expect(queue!.inputs).toMatchObject({
      queueName: 'jobs',
      maxDeliveryCount: 10,
      enableBatchedOperations: true,
      enablePartitioning: false,
      maxSizeInMegabytes: 1024,
      lockDuration: 'PT1M',
      defaultMessageTimeToLive: 'P5D',
    });
  });

  test('a caller queue option wins over the queue default', async () => {
    const captured = await createServiceBus({ queues: { jobs: { maxDeliveryCount: 2 } } });
    expect(captured.find((c) => c.type === 'azure-native:servicebus:Queue')!.inputs.maxDeliveryCount).toBe(2);
  });

  test('a topic with no options gets the topic defaults and no subscription', async () => {
    const captured = await createServiceBus({ topics: { orders: {} } });
    const topic = captured.find((c) => c.type === 'azure-native:servicebus:Topic');
    expect(topic).toBeDefined();
    expect(topic!.inputs.topicName).toBe('orders');
    expect(topic!.inputs).toMatchObject({
      defaultMessageTimeToLive: 'P5D',
      enablePartitioning: false,
      maxSizeInMegabytes: 1024,
      enableBatchedOperations: true,
    });
    expect(topic!.inputs.deadLetteringOnMessageExpiration).toBeUndefined();
    expect(captured.find((c) => c.type === 'azure-native:servicebus:Subscription')).toBeUndefined();
  });

  test('local auth enabled creates listen and send authorization rules', async () => {
    const captured = await createServiceBus({ disableLocalAuth: false });
    const rules = captured.filter((c) => c.type === 'azure-native:servicebus:NamespaceAuthorizationRule');
    expect(rules.map((r) => [r.inputs.authorizationRuleName, r.inputs.rights])).toEqual([
      ['sb1-listen', ['Listen']],
      ['sb1-send', ['Listen', 'Send']],
    ]);
  });

  test('local auth disabled creates no authorization rule', async () => {
    const captured = await createServiceBus({});
    expect(captured.filter((c) => c.type === 'azure-native:servicebus:NamespaceAuthorizationRule')).toHaveLength(0);
  });

  test('resource identity with a user-assigned id is SystemAssigned, UserAssigned', async () => {
    const inputs = await namespaceInputs({
      enableResourceIdentity: true,
      defaultUAssignedId: { id: 'uai_id', clientId: 'uai_client', principalId: 'uai_principal' },
    });
    expect(inputs.identity).toEqual({ type: 'SystemAssigned, UserAssigned', userAssignedIdentities: ['uai_id'] });
  });

  test('resource identity without a user-assigned id is SystemAssigned', async () => {
    const inputs = await namespaceInputs({ enableResourceIdentity: true });
    expect(inputs.identity).toEqual({ type: 'SystemAssigned' });
  });

  test('encryption on a non-Premium sku sends no encryption block', async () => {
    const inputs = await namespaceInputs({
      enableEncryption: true,
      vaultInfo: { id: 'vault_id', resourceName: 'vault1', resourceGroupName: 'rg' },
    });
    expect(inputs.encryption).toBeUndefined();
  });

  test('a subscription with no options gets the dev TTL and batched operations', async () => {
    const captured = await createServiceBus({ topics: { orders: { subscriptions: { audit: {} } } } });
    const sub = captured.find((c) => c.type === 'azure-native:servicebus:Subscription');
    expect(sub).toBeDefined();
    expect(sub!.inputs.defaultMessageTimeToLive).toBe('P5D');
    expect(sub!.inputs.enableBatchedOperations).toBe(true);
  });

  test('a subscription on a prd stack gets the 14-day TTL', async () => {
    const captured = await createServiceBus(
      {
        topics: { orders: { subscriptions: { audit: {} } } },
        network: { defaultAction: 'Deny', ipRules: ['10.0.0.1'] },
      },
      'prd',
    );
    const sub = captured.find((c) => c.type === 'azure-native:servicebus:Subscription');
    expect(sub).toBeDefined();
    expect(sub!.inputs.defaultMessageTimeToLive).toBe('P14D');
  });

  test('Premium encryption uses the Key Vault key source with infrastructure encryption', async () => {
    const inputs = await namespaceInputs({
      sku: { name: 'Premium', capacity: 1 },
      enableEncryption: true,
      vaultInfo: { id: 'vault_id', resourceName: 'vault1', resourceGroupName: 'rg' },
    });
    expect(inputs.encryption.keySource).toBe('Microsoft.KeyVault');
    expect(inputs.encryption.requireInfrastructureEncryption).toBe(true);
    expect(inputs.encryption.keyVaultProperties[0].identity).toBeUndefined();
  });
});
