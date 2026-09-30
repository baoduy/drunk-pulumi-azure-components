import { withStack, restoreStack, Captured } from '../testUtils/pulumiMocks';

// Each test cold-loads the component via jest.resetModules() + require, which can exceed 5000 ms under parallel load.
jest.setTimeout(30000);

/**
 * DRK-1821 rows 4 and 5.
 * - R2/R3: every topic subscription starts from the subscription defaults (dead-lettering on,
 *   1-minute lock, 10 deliveries, 10-minute duplicate window); a caller field in the subscription wins.
 * - R4: Premium + enableEncryption sends a complete Key Vault reference: keyName, keyVaultUri, identity.
 *
 * Runs on a non-prd stack (`withStack('dev')`). Subscriptions are created inside `topic.name.apply`,
 * which no ServiceBus output waits for, so the test settles a few extra ticks before asserting.
 */

const VAULT_URL = 'https://vault1.vault.azure.net/';

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
  sku: { name: 'Standard' },
  disableLocalAuth: true,
};

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};

function loadServiceBus() {
  return withStack(
    'dev',
    (p) => {
      const mod: typeof import('../../src/services/ServiceBus') = require('../../src/services/ServiceBus');
      return { pulumi: p, ServiceBus: mod.ServiceBus };
    },
    // The encryption key's dynamic resource reports the Key Vault key name and the vault URL it lives in,
    // as the real VaultKeyResourceProvider does (the mock's default `name` is the Pulumi resource name).
    ({ name }) => (name.endsWith('-encryptKey') ? { name: 'sb1-encryptKey', vaultUrl: VAULT_URL } : {}),
  );
}

async function createServiceBus(props: any): Promise<Captured[]> {
  const { pulumi, ServiceBus, captured } = loadServiceBus();
  const sb = new ServiceBus('sb1', { ...baseArgs, ...props } as any);
  await pulumi.output(sb.id).promise();
  await settle();
  return captured;
}

async function subscriptionInputs(subscription: object) {
  const captured = await createServiceBus({ topics: { orders: { subscriptions: { audit: subscription } } } });
  const sub = captured.find((c) => c.type === 'azure-native:servicebus:Subscription');
  expect(sub).toBeDefined();
  return sub!.inputs;
}

describe('ServiceBus — subscription defaults (DRK-1821 R2, R3)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('S3 — a subscription with no options dead-letters expired messages, locks for 1 minute and allows 10 deliveries', async () => {
    const inputs = await subscriptionInputs({});
    expect(inputs.deadLetteringOnMessageExpiration).toBe(true);
    expect(inputs.lockDuration).toBe('PT1M');
    expect(inputs.maxDeliveryCount).toBe(10);
  });

  test('S4 — a subscription with no options gets a 10-minute duplicate-detection window', async () => {
    const inputs = await subscriptionInputs({});
    expect(inputs.duplicateDetectionHistoryTimeWindow).toBe('PT10M');
  });

  test('S5 — a caller maxDeliveryCount on the subscription wins over the default', async () => {
    const inputs = await subscriptionInputs({ maxDeliveryCount: 3 });
    expect(inputs.maxDeliveryCount).toBe(3);
  });
});

describe('ServiceBus — Premium customer-managed key (DRK-1821 R4)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('S6 — Premium with encryption sends keyName, keyVaultUri and identity, and no other key fields', async () => {
    const captured = await createServiceBus({
      sku: { name: 'Premium', capacity: 1 },
      enableEncryption: true,
      vaultInfo: { id: 'vault_id', resourceName: 'vault1', resourceGroupName: 'rg' },
      defaultUAssignedId: { id: 'uai_id', clientId: 'uai_client', principalId: 'uai_principal' },
    });
    const ns = captured.find((c) => c.type === 'azure-native:servicebus:Namespace');
    expect(ns).toBeDefined();
    expect(ns!.inputs.encryption.keyVaultProperties).toEqual([
      {
        keyName: 'sb1-encryptKey',
        keyVaultUri: VAULT_URL,
        identity: { userAssignedIdentity: 'uai_id' },
      },
    ]);
  });
});
