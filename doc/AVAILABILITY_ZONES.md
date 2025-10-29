# Availability Zones Configuration for Production

This document describes how availability zones are automatically configured for Azure resources in Production (PRD) environments.

## Overview

Starting from this version, all Azure components that support availability zones will automatically be configured with 3 zones (`['1', '2', '3']`) when deployed to a Production environment. This enhances reliability and high availability for production workloads.

## How It Works

The system detects the environment using the `isPrd` flag from `src/helpers/azureEnv.ts`, which checks if the stack name contains "prd".

- **Production Environment** (stack name contains "prd"): Resources are automatically configured with zones `['1', '2', '3']`
- **Non-Production Environments** (dev, sandbox): Resources are not configured with zones by default

## Supported Components

The following Azure components now support automatic zone configuration:

| Component | Property | Default for PRD | Can Override |
|-----------|----------|-----------------|--------------|
| API Management | `zones` | `['1', '2', '3']` | Yes |
| Bastion Host | `zones` | `['1', '2', '3']` | Yes |
| Azure Firewall | `zones` | `['1', '2', '3']` | Yes |
| Redis Cache | `zones` | `['1', '2', '3']` | Yes |
| Public IP Addresses | `zones` | `['1', '2', '3']` | Yes |
| NAT Gateway | `zones` | `['1', '2', '3']` | Yes |
| Container Registry | `zoneRedundancy` | `Enabled` | Yes |
| Service Bus | `zoneRedundant` | `true` | Yes |

## Usage Examples

### Using Default Zones (PRD Environment)

```typescript
import { Redis } from '@drunk-pulumi/azure-components';

// In PRD environment, this will automatically use 3 zones
const redis = new Redis('my-redis', {
  rsGroup: { resourceGroupName: 'my-rg' },
  sku: { name: 'Premium', family: 'P', capacity: 1 },
});
```

### Overriding Zones

You can always override the default zone configuration:

```typescript
import { Redis } from '@drunk-pulumi/azure-components';

// Use only zone 1, even in PRD
const redis = new Redis('my-redis', {
  rsGroup: { resourceGroupName: 'my-rg' },
  sku: { name: 'Premium', family: 'P', capacity: 1 },
  zones: ['1'], // Override default
});

// Disable zones completely
const redisNoZones = new Redis('my-redis-no-zones', {
  rsGroup: { resourceGroupName: 'my-rg' },
  sku: { name: 'Premium', family: 'P', capacity: 1 },
  zones: [], // Explicitly disable zones
});
```

### Container Registry (Zone Redundancy)

```typescript
import { ContainerRegistry } from '@drunk-pulumi/azure-components';

// In PRD, zoneRedundancy is automatically set to 'Enabled'
const acr = new ContainerRegistry('myacr', {
  rsGroup: { resourceGroupName: 'my-rg' },
  sku: 'Premium',
});

// Override to disable zone redundancy
const acrNoRedundancy = new ContainerRegistry('myacr-no-redundancy', {
  rsGroup: { resourceGroupName: 'my-rg' },
  sku: 'Premium',
  zoneRedundancy: 'Disabled', // Override
});
```

### Service Bus

```typescript
import { ServiceBus } from '@drunk-pulumi/azure-components';

// In PRD, zoneRedundant is automatically set to true
const serviceBus = new ServiceBus('my-bus', {
  rsGroup: { resourceGroupName: 'my-rg' },
  sku: { name: 'Premium', capacity: 1 },
});

// Override to disable zone redundancy
const serviceBusNoRedundancy = new ServiceBus('my-bus-no-redundancy', {
  rsGroup: { resourceGroupName: 'my-rg' },
  sku: { name: 'Premium', capacity: 1 },
  zoneRedundant: false, // Override
});
```

## Benefits

1. **High Availability**: Production resources automatically gain zone redundancy
2. **Cost Optimization**: Non-production environments don't incur zone-related costs
3. **Flexibility**: Easy to override when needed for specific use cases
4. **Consistency**: Uniform zone configuration across all supported components

## Environment Detection

The environment is determined by the Pulumi stack name:

- Stack name contains "prd" → Production environment → Zones enabled by default
- Stack name contains "dev" → Development environment → Zones not enabled
- Stack name contains "sandbox" → Sandbox environment → Zones not enabled

## Limitations

- Zone support depends on the Azure region. Not all regions support availability zones.
- Some SKUs may not support zones (e.g., Basic tier resources).
- Check Azure documentation for region and SKU-specific zone support.

## Migration Guide

For existing deployments:

1. **Non-PRD environments**: No changes needed. Behavior remains the same.
2. **PRD environments**: Resources will automatically gain zone configuration on next deployment.
3. **To maintain current behavior**: Explicitly set `zones: undefined` or appropriate value in resource configuration.

## Implementation Details

The core logic is in `src/helpers/zoneHelper.ts`:

```typescript
export function getDefaultZones(
  zones?: pulumi.Input<pulumi.Input<string>[]>
): pulumi.Input<pulumi.Input<string>[]> | undefined {
  // If zones are explicitly provided, always use them (allows override)
  if (zones !== undefined) {
    return zones;
  }
  
  // Only default to 3 zones for PRD environment
  return isPrd ? ['1', '2', '3'] : undefined;
}
```

This ensures that:
- Explicit zone configurations are always respected
- PRD environments get zones by default
- Non-PRD environments remain unchanged
