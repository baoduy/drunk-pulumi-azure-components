import * as pulumi from '@pulumi/pulumi';
import { AppContainerEnv } from '../src/app/AppContainerEnv';
import { withStack, restoreStack } from './testUtils/pulumiMocks';

pulumi.runtime.setMocks({
  newResource: (args: pulumi.runtime.MockResourceArgs): { id: string; state: any } => {
    return {
      id: `${args.name}_id`,
      state: {
        ...args.inputs,
        name: args.name,
        id: `${args.name}_id`,
        resourceName: args.name,
        defaultDomain: `${args.name}.azurecontainerapps.io`,
        staticIp: '10.0.0.1',
      },
    };
  },
  call: (args: pulumi.runtime.MockCallArgs) => {
    return args.inputs;
  },
});

describe('AppContainerEnv', () => {
  test('should create a basic managed environment', async () => {
    const env = new AppContainerEnv('test-env', {
      rsGroup: {
        resourceGroupName: 'test-rg',
        location: 'eastus',
      },
      logs: {
        workspace: {
          id: 'workspace_id',
          resourceName: 'workspace',
          resourceGroupName: 'test-rg',
          customerId: 'workspace-customer-id',
        },
      },
    });

    const outputs = env.getOutputs();

    await pulumi.output(outputs.id).apply((id) => {
      expect(id).toBe('test-env_id');
    });
    await pulumi.output(outputs.resourceName).apply((name) => {
      expect(name).toBe('test-env');
    });
    await pulumi.output(outputs.defaultDomain).apply((domain) => {
      expect(domain).toBe('test-env.azurecontainerapps.io');
    });
  });

  test('should create environment with VNet configuration', async () => {
    const env = new AppContainerEnv('test-vnet-env', {
      rsGroup: {
        resourceGroupName: 'test-rg',
        location: 'eastus',
      },
      vnetConfiguration: {
        infrastructureSubnet: {
          id: 'subnet_id',
        },
        internal: true,
        platformReservedCidr: '10.1.0.0/23',
        platformReservedDnsIP: '10.1.0.10',
      },
      logs: {
        workspace: {
          id: 'workspace_id',
          resourceName: 'workspace',
          resourceGroupName: 'test-rg',
          customerId: 'workspace-customer-id',
        },
      },
      zoneRedundant: true,
    });

    const outputs = env.getOutputs();

    await pulumi.output(outputs.id).apply((id) => {
      expect(id).toBe('test-vnet-env_id');
    });
  });

  test('should create environment with Dapr configuration', async () => {
    const env = new AppContainerEnv('test-dapr-env', {
      rsGroup: {
        resourceGroupName: 'test-rg',
        location: 'eastus',
      },
      logs: {
        workspace: {
          id: 'workspace_id',
          resourceName: 'workspace',
          resourceGroupName: 'test-rg',
          customerId: 'workspace-customer-id',
        },
      },
      dapr: {
        connectionString: 'InstrumentationKey=xxx',
        instrumentationKey: 'xxx',
      },
    });

    const outputs = env.getOutputs();

    await pulumi.output(outputs.id).apply((id) => {
      expect(id).toBe('test-dapr-env_id');
    });
  });

  test('should create environment with workload profiles', async () => {
    const env = new AppContainerEnv('test-workload-env', {
      rsGroup: {
        resourceGroupName: 'test-rg',
        location: 'eastus',
      },
      logs: {
        workspace: {
          id: 'workspace_id',
          resourceName: 'workspace',
          resourceGroupName: 'test-rg',
          customerId: 'workspace-customer-id',
        },
      },
      workloadProfiles: [
        {
          name: 'Consumption',
          workloadProfileType: 'Consumption',
        },
        {
          name: 'D4',
          workloadProfileType: 'D4',
          minimumCount: 1,
          maximumCount: 3,
        },
      ],
    });

    const outputs = env.getOutputs();

    await pulumi.output(outputs.id).apply((id) => {
      expect(id).toBe('test-workload-env_id');
    });
  });
});

// DRK-1822 Section A: Container Apps zone redundancy requires a VNet-injected environment and
// cannot be changed after creation (Microsoft Learn, "Reliability in Azure Container Apps"), so the
// PRD default applies only when `vnetConfiguration` is set. A caller value always wins.
describe('AppContainerEnv — zoneRedundant default gated on VNet (DRK-1822 S4-S6)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  // Drain the RPCs still queued by the tests above before `withStack` swaps in fresh mocks, so
  // their late output registrations do not reach a mock monitor that never saw their resources.
  beforeAll(() => pulumi.runtime.disconnect());
  afterEach(() => restoreStack(ORIGINAL_STACK));

  const vnetConfiguration = { infrastructureSubnet: { id: 'subnet_id' } };

  async function sentZoneRedundant(stackName: string, props: object) {
    const { pulumi, env, captured } = withStack(stackName, (p) => {
      const mod: typeof import('../src/app/AppContainerEnv') = require('../src/app/AppContainerEnv');
      const env = new mod.AppContainerEnv('zone-env', {
        rsGroup: { resourceGroupName: 'test-rg', location: 'eastus' },
        ...props,
      });
      return { pulumi: p, env };
    });
    await pulumi.output(env.id).promise();
    return captured.find((c) => c.type === 'azure-native:app:ManagedEnvironment')!.inputs.zoneRedundant;
  }

  test('S4: prd without vnetConfiguration sends zoneRedundant false', async () => {
    expect(await sentZoneRedundant('prd', {})).toBe(false);
  });

  test('S5: prd with vnetConfiguration sends zoneRedundant true', async () => {
    expect(await sentZoneRedundant('prd', { vnetConfiguration })).toBe(true);
  });

  test('S5: dev with vnetConfiguration sends zoneRedundant false', async () => {
    expect(await sentZoneRedundant('dev', { vnetConfiguration })).toBe(false);
  });

  test('S6: prd caller zoneRedundant true without vnetConfiguration is sent as true', async () => {
    expect(await sentZoneRedundant('prd', { zoneRedundant: true })).toBe(true);
  });

  test('S6: prd caller zoneRedundant false with vnetConfiguration is sent as false', async () => {
    expect(await sentZoneRedundant('prd', { zoneRedundant: false, vnetConfiguration })).toBe(false);
  });
});
