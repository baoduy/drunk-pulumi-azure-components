# AppContainerEnv

Azure Container Apps Managed Environment component providing isolated hosting infrastructure for container applications with integrated networking, monitoring, and scaling capabilities.

## Features

- **Isolated Environment**: Secure boundary for container apps with shared resources
- **VNet Integration**: Optional VNet injection for private networking
- **Monitoring**: Integrated Log Analytics and Application Insights support
- **Dapr Support**: Built-in Dapr sidecar configuration
- **Zone Redundancy**: High availability across availability zones
- **Workload Profiles**: Dedicated compute options for different workloads
- **Custom Domains**: Support for custom domain configuration
- **mTLS**: Mutual TLS peer authentication

## Usage

### Basic Managed Environment

```typescript
import { AppContainerEnv } from '@drunk-pulumi/azure-components';

const environment = new AppContainerEnv('my-env', {
  rsGroup: {
    resourceGroupName: 'my-rg',
    location: 'eastus',
  },
  logAnalyticsWorkspace: {
    id: workspace.id,
    resourceName: workspace.name,
  },
});

export const envId = environment.id;
export const defaultDomain = environment.defaultDomain;
```

### VNet-Integrated Environment

```typescript
import { AppContainerEnv } from '@drunk-pulumi/azure-components';

const environment = new AppContainerEnv('my-env', {
  rsGroup: {
    resourceGroupName: 'my-rg',
    location: 'eastus',
  },
  vnetConfiguration: {
    infrastructureSubnet: {
      id: subnet.id,
    },
    internal: true, // Internal-only ingress
    platformReservedCidr: '10.1.0.0/23',
    platformReservedDnsIP: '10.1.0.10',
  },
  logAnalyticsWorkspace: {
    id: workspace.id,
    resourceName: workspace.name,
  },
  zoneRedundant: true, // High availability
});
```

### With Dapr and Diagnostics

```typescript
import { AppContainerEnv } from '@drunk-pulumi/azure-components';

const environment = new AppContainerEnv('my-env', {
  rsGroup: {
    resourceGroupName: 'my-rg',
    location: 'eastus',
  },
  logAnalyticsWorkspace: {
    id: workspace.id,
    resourceName: workspace.name,
  },
  dapr: {
    connectionString: appInsights.connectionString,
    instrumentationKey: appInsights.instrumentationKey,
  },
  diagnosticSettings: {
    workspaceId: workspace.id,
    enableLogs: true,
    enableMetrics: true,
  },
});
```

### With Workload Profiles

```typescript
import { AppContainerEnv } from '@drunk-pulumi/azure-components';

const environment = new AppContainerEnv('my-env', {
  rsGroup: {
    resourceGroupName: 'my-rg',
    location: 'eastus',
  },
  logAnalyticsWorkspace: {
    id: workspace.id,
    resourceName: workspace.name,
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
```

## Properties

### AppContainerEnvArgs

| Property                                  | Type                | Required | Description                                     |
| ----------------------------------------- | ------------------- | -------- | ----------------------------------------------- |
| `rsGroup`                                 | `ResourceGroupType` | Yes      | Resource group configuration                    |
| `vnetConfiguration`                       | `object`            | No       | VNet integration settings                       |
| `vnetConfiguration.infrastructureSubnet`  | `SubResourceInputs` | Yes\*    | Subnet for infrastructure components            |
| `vnetConfiguration.internal`              | `boolean`           | No       | Enable internal-only ingress (default: false)   |
| `vnetConfiguration.platformReservedCidr`  | `string`            | No       | Platform-reserved CIDR range                    |
| `vnetConfiguration.platformReservedDnsIP` | `string`            | No       | Platform-reserved DNS IP                        |
| `logAnalyticsWorkspace`                   | `ResourceInputs`    | No       | Log Analytics workspace for monitoring          |
| `appInsightsInstrumentationKey`           | `string`            | No       | App Insights key (alternative to Log Analytics) |
| `dapr.connectionString`                   | `string`            | No       | Dapr telemetry connection string                |
| `dapr.instrumentationKey`                 | `string`            | No       | Dapr telemetry instrumentation key              |
| `diagnosticSettings`                      | `object`            | No       | Azure Monitor diagnostic settings               |
| `diagnosticSettings.workspaceId`          | `string`            | Yes\*    | Workspace for diagnostics                       |
| `diagnosticSettings.enableLogs`           | `boolean`           | No       | Enable log collection                           |
| `diagnosticSettings.enableMetrics`        | `boolean`           | No       | Enable metrics collection                       |
| `customDomainConfiguration`               | `object`            | No       | Custom domain settings                          |
| `infrastructureResourceGroup`             | `string`            | No       | Separate RG for managed resources               |
| `kedaConfiguration`                       | `object`            | No       | KEDA autoscaling configuration                  |
| `peerAuthentication`                      | `object`            | No       | mTLS peer authentication settings               |
| `peerTrafficConfiguration`                | `object`            | No       | Peer traffic encryption settings                |
| `workloadProfiles`                        | `array`             | No       | Dedicated compute workload profiles             |
| `zoneRedundant`                           | `boolean`           | No       | Enable zone redundancy (default: false)         |

\* Required when parent object is specified

## Outputs

| Output          | Type                   | Description                          |
| --------------- | ---------------------- | ------------------------------------ |
| `id`            | `Output<string>`       | Managed environment resource ID      |
| `resourceName`  | `Output<string>`       | Managed environment name             |
| `defaultDomain` | `Output<string>`       | Default domain for container apps    |
| `staticIp`      | `Output<string>`       | Static IP address of the environment |
| `vaultSecrets`  | `VaultSecretOutputs[]` | Key Vault secret references          |

## VNet Configuration

When using VNet integration:

1. **Infrastructure Subnet**: Must be a dedicated subnet with sufficient IP space (minimum /23 recommended)
2. **Platform Reserved CIDR**: Must not overlap with the infrastructure subnet (e.g., if subnet is 10.0.0.0/24, use 10.1.0.0/23)
3. **Platform Reserved DNS IP**: Must be within the platformReservedCidr range
4. **Internal Mode**: Routes all ingress through the VNet (no public endpoints)

## Workload Profiles

Workload profiles allow dedicated compute resources:

- **Consumption**: Serverless, pay-per-use (default)
- **D4, D8, D16, D32**: Dedicated general-purpose compute
- **E4, E8, E16, E32**: Dedicated memory-optimized compute

## Best Practices

1. **Use Log Analytics**: Enable comprehensive monitoring and diagnostics
2. **Enable Zone Redundancy**: For production workloads requiring high availability
3. **VNet Integration**: Use for private networking and compliance requirements
4. **Separate Infrastructure RG**: Isolate managed resources from application resources
5. **Workload Profiles**: Use dedicated profiles for predictable performance requirements
6. **Diagnostic Settings**: Enable for production environments to track logs and metrics

## Integration with AppContainer

```typescript
import { AppContainerEnv, AppContainer } from '@drunk-pulumi/azure-components';

// Create environment
const environment = new AppContainerEnv('my-env', {
  rsGroup: {
    resourceGroupName: 'my-rg',
    location: 'eastus',
  },
  logAnalyticsWorkspace: {
    id: workspace.id,
    resourceName: workspace.name,
  },
});

// Deploy container app to the environment
const app = new AppContainer('my-app', {
  rsGroup: {
    resourceGroupName: 'my-rg',
    location: 'eastus',
  },
  managedEnvironmentId: environment.id,
  template: {
    containers: [
      {
        name: 'main',
        image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest',
      },
    ],
  },
  configuration: {
    ingress: {
      external: true,
      targetPort: 80,
    },
  },
});
```

## Related Components

- [AppContainer](./AppContainer.md) - Deploy container apps to managed environments
- [LogAnalyticsWorkspace](../logs/LogAnalyticsWorkspace.md) - Workspace for monitoring
- [VirtualNetwork](../vnet/VirtualNetwork.md) - VNet integration

## References

- [Azure Container Apps Environments](https://learn.microsoft.com/en-us/azure/container-apps/environment)
- [VNet Integration](https://learn.microsoft.com/en-us/azure/container-apps/vnet-custom)
- [Workload Profiles](https://learn.microsoft.com/en-us/azure/container-apps/workload-profiles-overview)
