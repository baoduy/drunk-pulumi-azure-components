import * as pulumi from '@pulumi/pulumi';
import { AppContainerEnv } from '../src/app/AppContainerEnv';

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
