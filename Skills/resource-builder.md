# ResourceBuilder Usage Skill

This skill helps you effectively use and extend the ResourceBuilder orchestrator for composing complex Azure infrastructure.

## Skill Purpose

Master the ResourceBuilder pattern for rapidly composing Azure infrastructure with minimal boilerplate while maintaining best practices for security, networking, and identity management.

## When to Use This Skill

- Setting up new Azure environments or stacks
- Composing multiple related Azure resources
- Need integrated Key Vault, logging, and identity management
- Building repeatable infrastructure patterns
- Extending ResourceBuilder with new capabilities

## Understanding ResourceBuilder

ResourceBuilder is the main orchestration component that composes commonly-used Azure resources into a cohesive infrastructure stack. It handles:

- **Resource Groups**: Logical containers for resources
- **Key Vault**: Secret management and encryption
- **Log Analytics**: Centralized logging and monitoring  
- **Managed Identities**: User-assigned identities for resources
- **Role Assignments**: Azure AD role management
- **Disk Encryption**: VM disk encryption sets
- **Networking**: VNet, subnets, firewall, DNS

## Basic Usage

### Minimal Example

```typescript
import { ResourceBuilder } from '@drunk-pulumi/azure-components';

// Simplest possible setup
const builder = new ResourceBuilder('my-stack', {
  // Resource group is created automatically
});

export const outputs = builder.getOutputs();
```

### Common Configuration

```typescript
import { ResourceBuilder } from '@drunk-pulumi/azure-components';

const builder = new ResourceBuilder('my-app-prod', {
  // Create resource group with custom name
  groupRoles: {
    createWithName: 'rg-myapp-prod',
  },
  
  // Enable Key Vault for secrets
  vault: {
    sku: 'standard',
    enabledForDiskEncryption: true,
    enabledForDeployment: true,
  },
  
  // Enable Log Analytics
  logs: {
    sku: 'PerGB2018',
    retentionInDays: 90,
  },
  
  // Create default user-assigned managed identity
  enableDefaultUAssignId: true,
  
  // Enable disk encryption for VMs
  diskEncryptionSet: {
    enabled: true,
  },
});

// Export all outputs
export const vaultUrl = builder.getVault()?.vaultUri;
export const logWorkspaceId = builder.getLogWorkspace()?.id;
export const identityId = builder.getDefaultUAssignId()?.id;
```

## Configuration Options Deep Dive

### Resource Group Configuration

```typescript
{
  groupRoles: {
    // Option 1: Create with custom name
    createWithName: 'rg-myapp-prod',
    
    // Option 2: Use existing resource group
    useExisting: {
      resourceGroupName: 'existing-rg',
      location: 'eastus',
    },
  },
}
```

### Key Vault Configuration

```typescript
{
  vault: {
    // SKU selection
    sku: 'standard' | 'premium',
    
    // Feature flags
    enabledForDiskEncryption?: boolean,
    enabledForDeployment?: boolean,
    enabledForTemplateDeployment?: boolean,
    enableSoftDelete?: boolean,
    enablePurgeProtection?: boolean,
    
    // Networking
    networkRules?: {
      defaultAction: 'Allow' | 'Deny',
      ipRules?: string[],
      virtualNetworkRules?: { id: string }[],
    },
    
    // Custom access policies
    policies?: Array<{
      objectId: pulumi.Input<string>,
      permissions: {
        certificates?: string[],
        keys?: string[],
        secrets?: string[],
        storage?: string[],
      },
    }>,
    
    // Soft delete retention
    softDeleteRetentionInDays?: number,
  },
}
```

### Log Analytics Configuration

```typescript
{
  logs: {
    // Pricing tier
    sku: 'Free' | 'PerGB2018' | 'PerNode',
    
    // Retention period
    retentionInDays?: number, // 30-730 days
    
    // Daily cap
    dailyQuotaGb?: number,
    
    // Enable public network access
    publicNetworkAccessForIngestion?: 'Enabled' | 'Disabled',
    publicNetworkAccessForQuery?: 'Enabled' | 'Disabled',
  },
}
```

### User-Assigned Identity Configuration

```typescript
{
  // Simple: Create default identity
  enableDefaultUAssignId: true,
  
  // Advanced: Custom identity configuration
  defaultUAssignId: {
    name: 'custom-identity-name',
    roleNames?: ['Contributor', 'Reader'],
  },
}
```

### Disk Encryption Configuration

```typescript
{
  diskEncryptionSet: {
    enabled: true,
    
    // Optional: Use existing encryption key
    encryptionKey?: {
      keyVaultId: pulumi.Input<string>,
      keyUrl: pulumi.Input<string>,
    },
    
    // Optional: Custom identity for encryption
    identityId?: pulumi.Input<string>,
  },
}
```

### VNet Configuration

```typescript
{
  vnet: {
    // Address space
    addressSpace: ['10.0.0.0/16'],
    
    // Subnets
    subnets: [
      {
        name: 'default',
        addressPrefix: '10.0.1.0/24',
      },
      {
        name: 'aks',
        addressPrefix: '10.0.2.0/23',
      },
    ],
    
    // DNS servers
    dnsServers?: string[],
    
    // Enable DDoS protection
    enableDdosProtection?: boolean,
    
    // Firewall
    firewall?: {
      enabled: true,
      sku: 'Standard',
      managementSubnet: {
        name: 'AzureFirewallManagementSubnet',
        addressPrefix: '10.0.250.0/26',
      },
    },
  },
}
```

## Accessing ResourceBuilder Outputs

### Getting Components

```typescript
const builder = new ResourceBuilder('stack', { /* ... */ });

// Access created components
const resourceGroup = builder.getResourceGroup();
const vault = builder.getVault();
const logWorkspace = builder.getLogWorkspace();
const identity = builder.getDefaultUAssignId();
const encryptionSet = builder.getDiskEncryptionSet();
const vnet = builder.getVnet();
```

### Exporting Outputs

```typescript
// Option 1: Export individual values
export const resourceGroupName = builder.getResourceGroup()?.resourceGroupName;
export const vaultUrl = builder.getVault()?.vaultUri;
export const logId = builder.getLogWorkspace()?.id;

// Option 2: Export all outputs as object
export const outputs = builder.getOutputs();
// outputs.resourceGroup, outputs.vault, outputs.logs, etc.

// Option 3: Destructure specific outputs
export const { resourceGroup, vault, logs } = builder.getOutputs();
```

## Common Patterns

### Pattern 1: Multi-Environment Setup

```typescript
import * as pulumi from '@pulumi/pulumi';
import { ResourceBuilder } from '@drunk-pulumi/azure-components';

const stack = pulumi.getStack();
const config = new pulumi.Config();

const builder = new ResourceBuilder(`myapp-${stack}`, {
  groupRoles: {
    createWithName: `rg-myapp-${stack}`,
  },
  vault: {
    sku: stack === 'prod' ? 'premium' : 'standard',
  },
  logs: {
    retentionInDays: stack === 'prod' ? 365 : 30,
  },
  enableDefaultUAssignId: true,
});

export const outputs = builder.getOutputs();
```

### Pattern 2: Shared Infrastructure

```typescript
// Create shared infrastructure builder
const sharedInfra = new ResourceBuilder('shared', {
  groupRoles: { createWithName: 'rg-shared' },
  vault: { sku: 'premium' },
  logs: { retentionInDays: 365 },
  vnet: {
    addressSpace: ['10.0.0.0/16'],
    subnets: [
      { name: 'shared', addressPrefix: '10.0.1.0/24' },
    ],
  },
});

// Use shared resources in application builder
const appBuilder = new ResourceBuilder('app', {
  groupRoles: { createWithName: 'rg-app' },
  // Reuse vault from shared infra
  vault: sharedInfra.getVault(),
  logs: sharedInfra.getLogWorkspace(),
});
```

### Pattern 3: Complex Networking

```typescript
const builder = new ResourceBuilder('enterprise', {
  vnet: {
    addressSpace: ['10.0.0.0/16'],
    subnets: [
      {
        name: 'gateway',
        addressPrefix: '10.0.1.0/24',
      },
      {
        name: 'aks',
        addressPrefix: '10.0.2.0/23',
        serviceEndpoints: ['Microsoft.Storage', 'Microsoft.Sql'],
      },
      {
        name: 'private-endpoints',
        addressPrefix: '10.0.4.0/24',
      },
    ],
    firewall: {
      enabled: true,
      sku: 'Premium',
      threatIntelMode: 'Alert',
    },
  },
});
```

## Extending ResourceBuilder

### Adding New Optional Components

To add a new component to ResourceBuilder:

#### Step 1: Define Args Interface

```typescript
// In ResourceBuilder.ts
export interface ResourceBuilderArgs {
  // ... existing args
  
  /**
   * Optional configuration for [YourComponent]
   */
  yourComponent?: YourComponentArgs;
}
```

#### Step 2: Add Component Property

```typescript
export class ResourceBuilder extends BaseComponent<ResourceBuilderArgs> {
  // ... existing properties
  
  private yourComponent?: YourComponent;
  
  // ... constructor
}
```

#### Step 3: Conditional Instantiation

```typescript
constructor(name: string, args: ResourceBuilderArgs, opts?: pulumi.ComponentResourceOptions) {
  super('ResourceBuilder', name, args, opts);
  
  // ... existing initialization
  
  // Add your component
  if (args.yourComponent) {
    this.yourComponent = new YourComponent(
      `${this.name}-yourcomp`,
      {
        ...args.yourComponent,
        group: this.resourceGroup,
        vaultInfo: this.vault,
      },
      { parent: this }
    );
  }
  
  // ... rest of constructor
}
```

#### Step 4: Add Getter Method

```typescript
/**
 * Gets the YourComponent instance if created
 */
public getYourComponent(): YourComponent | undefined {
  return this.yourComponent;
}
```

#### Step 5: Expose in Outputs

```typescript
public getOutputs() {
  return {
    // ... existing outputs
    
    yourComponent: this.yourComponent
      ? {
          id: this.yourComponent.id,
          name: this.yourComponent.name,
        }
      : undefined,
  };
}
```

#### Step 6: Add Tests

```typescript
// In __tests__/ResourceBuilder.test.ts
test('creates YourComponent when configured', () => {
  const builder = new ResourceBuilder('test', {
    yourComponent: { /* args */ },
  });
  
  expect(builder.getYourComponent()).toBeDefined();
});
```

## Integration with Other Components

### Using Builder Resources in Custom Components

```typescript
import { ResourceBuilder } from '@drunk-pulumi/azure-components';
import { StorageAccount } from '@drunk-pulumi/azure-components/storage';

// Create infrastructure
const builder = new ResourceBuilder('myapp', {
  vault: { sku: 'standard' },
  enableDefaultUAssignId: true,
});

// Use builder resources in custom component
const storage = new StorageAccount('mystorage', {
  group: builder.getResourceGroup()!,
  vaultInfo: builder.getVault(),
  identity: {
    type: 'UserAssigned',
    userAssignedIdentities: [builder.getDefaultUAssignId()!.id],
  },
});

export const storageId = storage.id;
```

### Chaining Builders

```typescript
// Network infrastructure
const networkBuilder = new ResourceBuilder('network', {
  vnet: {
    addressSpace: ['10.0.0.0/16'],
    subnets: [{ name: 'default', addressPrefix: '10.0.1.0/24' }],
  },
});

// Application infrastructure using network
const appBuilder = new ResourceBuilder('app', {
  // Reference network components
  vnet: networkBuilder.getVnet(),
});
```

## Best Practices

### 1. Resource Group Management

✅ **Do:**
- Use descriptive, environment-specific names
- Use `createWithName` for new environments
- Use `useExisting` for shared/pre-created groups

❌ **Don't:**
- Create multiple resource groups per stack unnecessarily
- Use random suffixes in resource group names

### 2. Key Vault Configuration

✅ **Do:**
- Enable soft delete and purge protection in production
- Use network rules to restrict access
- Enable for disk encryption when using VMs
- Use premium SKU for HSM-backed keys

❌ **Don't:**
- Disable purge protection in production
- Allow unrestricted public access
- Share vaults across completely unrelated applications

### 3. Networking

✅ **Do:**
- Plan CIDR blocks to avoid conflicts
- Use service endpoints for Azure services
- Enable firewall for enterprise scenarios
- Implement proper subnet segmentation

❌ **Don't:**
- Use overlapping CIDR ranges
- Create tiny subnets that will run out of IPs
- Skip planning for future growth

### 4. Identity & Access

✅ **Do:**
- Use managed identities over service principals
- Follow principle of least privilege
- Enable default identity for resource access
- Use role assignments properly

❌ **Don't:**
- Store credentials in code or config
- Grant overly permissive roles
- Create unnecessary service principals

## Troubleshooting

### Common Issues

**Issue**: ResourceBuilder creates too many resources I don't need

**Solution**: Only specify the args for resources you need. ResourceBuilder creates resources conditionally based on provided configuration.

```typescript
// Minimal - only resource group
const builder = new ResourceBuilder('minimal', {});

// With vault only
const builder = new ResourceBuilder('vault-only', {
  vault: { sku: 'standard' },
});
```

---

**Issue**: Can't access vault/logs/identity after creation

**Solution**: Use getter methods, and check if resource was created:

```typescript
const vault = builder.getVault();
if (vault) {
  // Vault was created, use it
  export const vaultUrl = vault.vaultUri;
}
```

---

**Issue**: Resources aren't in the expected resource group

**Solution**: Ensure you're passing the resource group to child components:

```typescript
const storage = new StorageAccount('storage', {
  group: builder.getResourceGroup()!, // Pass the group
  // ... other args
});
```

## Checklist for ResourceBuilder Usage

- [ ] Chosen appropriate resource group strategy
- [ ] Configured only needed components
- [ ] Enabled appropriate security features (soft delete, purge protection)
- [ ] Planned network CIDR blocks if using VNet
- [ ] Enabled managed identity if resources need Azure access
- [ ] Configured log retention appropriately for environment
- [ ] Exported necessary outputs
- [ ] Tested with `pnpm run build`

## Performance Considerations

- ResourceBuilder creates resources in parallel where possible
- Network dependencies (VNet → Subnets → Resources) are handled automatically
- Use conditional creation to minimize unused resources
- Reuse builders for shared infrastructure to reduce duplication

## Security Checklist

- [ ] Secrets stored in Key Vault, not code
- [ ] Managed identities used instead of credentials
- [ ] Network rules configured for vault/storage where appropriate
- [ ] Least privilege role assignments
- [ ] Soft delete and purge protection enabled for production vaults
- [ ] Audit logging enabled via Log Analytics
- [ ] Firewall rules configured if using VNet

## Additional Resources

- See `src/ResourceBuilder.ts` for complete implementation
- Review `pulumi-test/` for real-world examples
- Check `.github/copilot-instructions.md` section 15 for extension guide
- Consult component-specific skills for detailed resource usage
