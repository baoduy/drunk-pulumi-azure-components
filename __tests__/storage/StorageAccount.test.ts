import { withStack, restoreStack } from '../testUtils/pulumiMocks';

/**
 * DRK-782 / PULUMI-SEC-007 §7: StorageAccount.createLifeCycleManagement must register
 * BlobServiceProperties with retention + versioning defaulted from the stack's prd-ness,
 * even when the caller supplies no `policies` at all — that default path is the whole
 * point of this cycle, since it is what every downstream stack inherits unasked.
 *
 * `azureEnv.isPrd` is computed once at module load from PULUMI_NODEJS_STACK
 * (src/helpers/azureEnv.ts / stackEnv.ts), so each scenario forces the stack and reloads
 * the component fresh via `withStack` (jest.resetModules + require) rather than a plain
 * import, which would just replay whichever stack happened to load first.
 */

const baseArgs = {
  rsGroup: { resourceGroupName: 'rg' },
};

function createStorageAccount(
  StorageAccount: typeof import('../../src/storage/StorageAccount').StorageAccount,
  props: any = {},
) {
  return new StorageAccount('sa1', { ...baseArgs, ...props } as any);
}

function blobProperties(captured: { type: string; name: string; inputs: any }[]) {
  return captured.find((c) => c.type === 'azure-native:storage:BlobServiceProperties')!;
}

// BlobServiceProperties/ManagementPolicy are fire-and-forget siblings of `stg`, not wired back
// through any StorageAccount output — give their promise chains one more tick to settle before
// asserting on `captured` (mirrors __tests__/database/MySql.test.ts).
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('StorageAccount — blob data-protection defaults (PULUMI-SEC-007)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('prd stack with no policies still registers BlobServiceProperties with retention and versioning on', async () => {
    const { pulumi, StorageAccount, captured } = withStack('prd', (p) => {
      const mod: typeof import('../../src/storage/StorageAccount') = require('../../src/storage/StorageAccount');
      return { pulumi: p, StorageAccount: mod.StorageAccount };
    });

    const sa = createStorageAccount(StorageAccount);
    await pulumi.output(sa.id).promise();
    await settle();

    const props = blobProperties(captured);
    expect(props).toBeDefined();
    expect(props.inputs.deleteRetentionPolicy).toEqual({ enabled: true, days: 7 });
    expect(props.inputs.containerDeleteRetentionPolicy).toEqual({ enabled: true, days: 7 });
    expect(props.inputs.isVersioningEnabled).toBe(true);
  });

  test('non-prd stack with no policies registers BlobServiceProperties with retention and versioning off', async () => {
    const { pulumi, StorageAccount, captured } = withStack('dev', (p) => {
      const mod: typeof import('../../src/storage/StorageAccount') = require('../../src/storage/StorageAccount');
      return { pulumi: p, StorageAccount: mod.StorageAccount };
    });

    const sa = createStorageAccount(StorageAccount);
    await pulumi.output(sa.id).promise();
    await settle();

    const props = blobProperties(captured);
    expect(props).toBeDefined();
    expect(props.inputs.deleteRetentionPolicy).toEqual({ enabled: false, days: 7 });
    expect(props.inputs.containerDeleteRetentionPolicy).toEqual({ enabled: false, days: 7 });
    expect(props.inputs.isVersioningEnabled).toBe(false);
  });

  test('a caller-supplied policies.blob override wins over the prd default', async () => {
    const { pulumi, StorageAccount, captured } = withStack('prd', (p) => {
      const mod: typeof import('../../src/storage/StorageAccount') = require('../../src/storage/StorageAccount');
      return { pulumi: p, StorageAccount: mod.StorageAccount };
    });

    const sa = createStorageAccount(StorageAccount, {
      policies: { blob: { isVersioningEnabled: false, deleteRetentionPolicy: { enabled: false, days: 30 } } },
    });
    await pulumi.output(sa.id).promise();
    await settle();

    const props = blobProperties(captured);
    expect(props.inputs.isVersioningEnabled).toBe(false);
    expect(props.inputs.deleteRetentionPolicy).toEqual({ enabled: false, days: 30 });
    // Untouched by the override — still the prd default.
    expect(props.inputs.containerDeleteRetentionPolicy).toEqual({ enabled: true, days: 7 });
  });

  test('the existing caller-supplied defaultManagementPolicyRules path still creates a ManagementPolicy', async () => {
    const { pulumi, StorageAccount, captured } = withStack('dev', (p) => {
      const mod: typeof import('../../src/storage/StorageAccount') = require('../../src/storage/StorageAccount');
      return { pulumi: p, StorageAccount: mod.StorageAccount };
    });

    const rules = [{ name: 'expire', enabled: true, type: 'Lifecycle', definition: {} }];
    const sa = createStorageAccount(StorageAccount, {
      policies: { defaultManagementPolicyRules: rules },
    });
    await pulumi.output(sa.id).promise();
    await settle();

    const policy = captured.find((c) => c.type === 'azure-native:storage:ManagementPolicy');
    expect(policy).toBeDefined();
    expect(policy?.inputs.policy.rules).toEqual(rules);

    // No policies.blob supplied alongside the rules — the default retention path stays intact.
    const props = blobProperties(captured);
    expect(props.inputs.isVersioningEnabled).toBe(false);
  });
});

// Pre-existing behaviour, untouched by DRK-782, but this file is a touched class this cycle
// (createLifeCycleManagement above), so its other branches need coverage too.
describe('StorageAccount — network rules, private link, static website, vault secrets and containers (pre-existing behaviour)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;

  afterEach(() => {
    restoreStack(ORIGINAL_STACK);
    jest.restoreAllMocks();
  });

  function setup() {
    process.env.PULUMI_NODEJS_STACK = 'dev';
    jest.resetModules();
    const pulumi: typeof import('@pulumi/pulumi') = require('@pulumi/pulumi');
    const captured: { type: string; name: string; inputs: any }[] = [];

    pulumi.runtime.setMocks({
      newResource: (args: any) => {
        captured.push({ type: args.type, name: args.name, inputs: args.inputs });
        return {
          id: `${args.name}_id`,
          state: {
            ...args.inputs,
            name: args.name,
            identity: { principalId: `${args.name}_principal`, type: 'SystemAssigned' },
            // PrivateEndpoint reads customDnsConfigs[].ipAddresses back off its own resource state.
            ...(args.type === 'azure-native:network:PrivateEndpoint'
              ? { customDnsConfigs: [{ ipAddresses: ['10.0.0.4'] }] }
              : {}),
          },
        };
      },
      call: (args: any) => {
        if (args.token === 'azure-native:storage:listStorageAccountKeys') {
          return { keys: [{ keyName: 'key1', value: 'secret-value', permissions: 'Full' }] };
        }
        return args.inputs;
      },
    });

    const mod: typeof import('../../src/storage/StorageAccount') = require('../../src/storage/StorageAccount');
    return { pulumi, StorageAccount: mod.StorageAccount, captured };
  }

  test('network ipRules/vnetRules, private link, resource identity, static website, vault secrets and containers all wire up their child resources', async () => {
    const { pulumi, StorageAccount, captured } = setup();

    const sa = new StorageAccount('sa-full', {
      rsGroup: { resourceGroupName: 'rg' },
      enableResourceIdentity: true,
      vaultInfo: { resourceGroupName: 'vault-rg', resourceName: 'vault1', id: 'vault1_id' },
      network: {
        ipRules: ['1.2.3.4'],
        vnetRules: [{ subnetId: '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet/subnets/snet' }],
        privateLink: { subnetInfo: { subnetId: '/subscriptions/s/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet/subnets/snet' } },
      },
      policies: {
        staticWebsite: { enabled: true },
      },
      containers: {
        containers: [{ name: 'Public', isPublic: true }],
        queues: ['MyQueue'],
        fileShares: ['MyShare'],
      },
    } as any);

    await pulumi.output(sa.id).promise();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    const stg = captured.find((c) => c.type === 'azure-native:storage:StorageAccount')!;
    expect(stg.inputs.networkRuleSet.ipRules).toEqual([{ iPAddressOrRange: '1.2.3.4', action: 'Allow' }]);
    expect(stg.inputs.networkRuleSet.virtualNetworkRules[0].action).toBe('Allow');

    expect(captured.find((c) => c.type.includes('PrivateEndpoint'))).toBeDefined();
    expect(captured.find((c) => c.type === 'azure-native:storage:StorageAccountStaticWebsite')).toBeDefined();
    expect(captured.find((c) => c.type === 'azure-native:storage:BlobContainer')?.inputs.publicAccess).toBe('Blob');
    expect(captured.find((c) => c.type === 'azure-native:storage:Queue')?.inputs.queueName).toBe('myqueue');
    expect(captured.find((c) => c.type === 'azure-native:storage:FileShare')?.inputs.shareName).toBe('myshare');
  }, 15000);
});
