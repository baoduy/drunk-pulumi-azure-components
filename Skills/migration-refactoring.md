# Migration & Refactoring Skill

This skill guides you through migrating existing infrastructure and refactoring Drunk Pulumi Azure Components.

## Skill Purpose

Successfully migrate from other Infrastructure as Code tools or raw Azure resources to Drunk Pulumi Azure Components, and refactor existing Pulumi code to use best practices.

## When to Use This Skill

- Migrating from Terraform/ARM/Bicep to Pulumi
- Migrating from raw Pulumi to Drunk Components
- Refactoring existing component implementations
- Upgrading component versions
- Restructuring infrastructure code
- Improving code organization

## Migration Strategies

### Strategy 1: Greenfield (New Infrastructure)

Best for: New projects, testing environments, or when existing infra can be recreated.

**Approach:**
1. Define infrastructure using Drunk Components
2. Deploy to new environment
3. Test thoroughly
4. Switch over when ready
5. Destroy old infrastructure

**Example:**
```typescript
// New stack with Drunk Components
const builder = new ResourceBuilder('app-v2', {
  groupRoles: { createWithName: 'rg-app-v2' },
  vault: { sku: 'standard' },
  vnet: {
    addressSpace: ['10.1.0.0/16'],
    subnets: [/* ... */],
  },
});
```

### Strategy 2: Import Existing Resources

Best for: Production systems, resources that can't be recreated easily.

**Approach:**
1. Identify existing Azure resources
2. Define in Pulumi code
3. Import resources into Pulumi state
4. Gradually refactor to use Drunk Components

**Example:**
```bash
# Step 1: List existing resources
az resource list --resource-group my-existing-rg

# Step 2: Define in Pulumi
# (Create component definition)

# Step 3: Import into state
pulumi import azure-native:resources:ResourceGroup my-rg \
  /subscriptions/{sub-id}/resourceGroups/my-existing-rg

pulumi import azure-native:storage:StorageAccount my-storage \
  /subscriptions/{sub-id}/resourceGroups/my-rg/providers/Microsoft.Storage/storageAccounts/mystorageacct
```

### Strategy 3: Parallel Migration

Best for: Complex systems requiring gradual transition.

**Approach:**
1. Run old and new IaC side by side
2. Migrate resources incrementally
3. Validate each migration step
4. Decomission old IaC when complete

**Example:**
```typescript
// Use existing resources while creating new ones
const existingVnet = azureNative.network.getVirtualNetwork({
  resourceGroupName: 'existing-rg',
  virtualNetworkName: 'existing-vnet',
});

// Create new components that integrate
const builder = new ResourceBuilder('new-app', {
  groupRoles: { 
    useExisting: {
      resourceGroupName: 'existing-rg',
      location: 'eastus',
    },
  },
  vnet: existingVnet, // Reference existing
});
```

### Strategy 4: Hybrid Approach

Best for: Migrating piece by piece with minimal disruption.

**Approach:**
1. Keep existing infrastructure running
2. Create new components alongside
3. Migrate connections/dependencies
4. Remove old resources when safe

## Migration from Terraform

### Comparison: Terraform vs Drunk Pulumi

| Aspect | Terraform | Drunk Pulumi Components |
|--------|-----------|------------------------|
| Language | HCL | TypeScript |
| State | Backend (S3, Azure, etc.) | Pulumi Service/Backend |
| Resources | Direct provider resources | Higher-level components |
| Secrets | Variable files | Pulumi secrets + Key Vault |
| Modules | Terraform modules | TypeScript classes |

### Step-by-Step Terraform Migration

#### Step 1: Export Terraform State

```bash
# Export current Terraform state
terraform show -json > terraform-state.json

# List all resources
terraform state list
```

#### Step 2: Map Resources to Components

```hcl
# Terraform
resource "azurerm_resource_group" "main" {
  name     = "rg-myapp"
  location = "eastus"
}

resource "azurerm_key_vault" "main" {
  name                = "kv-myapp"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  tenant_id           = data.azurerm_client_config.current.tenant_id
  sku_name            = "standard"
}

resource "azurerm_storage_account" "main" {
  name                     = "stmyapp"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}
```

Maps to:

```typescript
// Drunk Pulumi Components
import { ResourceBuilder } from '@drunk-pulumi/azure-components';
import { StorageAccount } from '@drunk-pulumi/azure-components/storage';

const builder = new ResourceBuilder('myapp', {
  groupRoles: { createWithName: 'rg-myapp' },
  vault: { sku: 'standard' },
});

const storage = new StorageAccount('main', {
  group: builder.getResourceGroup()!,
  sku: { name: 'Standard_LRS' },
  kind: 'StorageV2',
});
```

#### Step 3: Import Resources

```bash
# Import using Pulumi
pulumi import azure-native:resources:ResourceGroup main \
  /subscriptions/{sub}/resourceGroups/rg-myapp

pulumi import azure-native:storage:StorageAccount main \
  /subscriptions/{sub}/resourceGroups/rg-myapp/providers/Microsoft.Storage/storageAccounts/stmyapp
```

#### Step 4: Validate and Test

```bash
# Preview changes (should show no changes if mapping is correct)
pulumi preview

# Apply if needed
pulumi up
```

#### Step 5: Remove Terraform State

```bash
# Once validated, remove from Terraform
terraform state rm azurerm_resource_group.main
terraform state rm azurerm_storage_account.main

# Eventually destroy Terraform state
terraform destroy
```

## Migration from Raw Pulumi

### Before: Raw Azure Native

```typescript
import * as pulumi from '@pulumi/pulumi';
import * as azureNative from '@pulumi/azure-native';

// Create resource group
const resourceGroup = new azureNative.resources.ResourceGroup('myapp-rg', {
  location: 'eastus',
  tags: { environment: 'production' },
});

// Create Key Vault
const vault = new azureNative.keyvault.Vault('myapp-vault', {
  resourceGroupName: resourceGroup.name,
  location: resourceGroup.location,
  properties: {
    tenantId: azureNative.authorization.getClientConfig().then(c => c.tenantId),
    sku: { family: 'A', name: 'standard' },
    enabledForDiskEncryption: true,
    enableSoftDelete: true,
    softDeleteRetentionInDays: 90,
  },
});

// Create storage account
const storage = new azureNative.storage.StorageAccount('myappstorage', {
  resourceGroupName: resourceGroup.name,
  location: resourceGroup.location,
  sku: { name: 'Standard_LRS' },
  kind: 'StorageV2',
  properties: {
    supportsHttpsTrafficOnly: true,
    minimumTlsVersion: 'TLS1_2',
    encryption: {
      services: {
        blob: { enabled: true },
        file: { enabled: true },
      },
      keySource: 'Microsoft.Storage',
    },
  },
});

// Create managed identity
const identity = new azureNative.managedidentity.UserAssignedIdentity('myapp-identity', {
  resourceGroupName: resourceGroup.name,
  location: resourceGroup.location,
});

// Create role assignment
const roleAssignment = new azureNative.authorization.RoleAssignment('storage-access', {
  principalId: identity.principalId,
  principalType: 'ServicePrincipal',
  roleDefinitionId: '/subscriptions/.../roleDefinitions/...', // Blob Contributor
  scope: storage.id,
});

export const storageId = storage.id;
export const vaultUri = vault.properties.vaultUri;
```

### After: Drunk Components

```typescript
import { ResourceBuilder } from '@drunk-pulumi/azure-components';
import { StorageAccount } from '@drunk-pulumi/azure-components/storage';
import { RoleAssignment } from '@drunk-pulumi/azure-components/azAd';

// All of the above in a few lines
const builder = new ResourceBuilder('myapp', {
  groupRoles: { 
    createWithName: 'myapp-rg',
    tags: { environment: 'production' },
  },
  vault: { 
    sku: 'standard',
    enabledForDiskEncryption: true,
    enableSoftDelete: true,
    softDeleteRetentionInDays: 90,
  },
  enableDefaultUAssignId: true,
});

const storage = new StorageAccount('myappstorage', {
  group: builder.getResourceGroup()!,
  sku: { name: 'Standard_LRS' },
  supportsHttpsTrafficOnly: true,
  minimumTlsVersion: 'TLS1_2',
});

// Role assignment handled by component
new RoleAssignment('storage-access', {
  principalId: builder.getDefaultUAssignId()!.principalId,
  roleName: 'Storage Blob Data Contributor',
  scope: storage.id,
});

// Outputs
export const outputs = builder.getOutputs();
export const storageId = storage.id;
```

**Benefits:**
- 80% less code
- Built-in best practices
- Automatic Key Vault integration
- Consistent patterns
- Better error handling

## Refactoring Patterns

### Pattern 1: Extract Common Configuration

**Before:**
```typescript
const storage1 = new StorageAccount('storage1', {
  group: resourceGroup,
  sku: { name: 'Standard_LRS' },
  supportsHttpsTrafficOnly: true,
  minimumTlsVersion: 'TLS1_2',
  encryption: { /* ... */ },
});

const storage2 = new StorageAccount('storage2', {
  group: resourceGroup,
  sku: { name: 'Standard_LRS' },
  supportsHttpsTrafficOnly: true,
  minimumTlsVersion: 'TLS1_2',
  encryption: { /* ... */ },
});
```

**After:**
```typescript
const commonStorageConfig = {
  group: resourceGroup,
  sku: { name: 'Standard_LRS' as const },
  supportsHttpsTrafficOnly: true,
  minimumTlsVersion: 'TLS1_2' as const,
  encryption: { /* ... */ },
};

const storage1 = new StorageAccount('storage1', {
  ...commonStorageConfig,
  // Override specific values if needed
});

const storage2 = new StorageAccount('storage2', {
  ...commonStorageConfig,
});
```

### Pattern 2: Component Composition

**Before:**
```typescript
// Repetitive resource creation
const vault1 = new KeyVault('vault1', { /* ... */ });
const logs1 = new LogAnalytics('logs1', { /* ... */ });
const storage1 = new StorageAccount('storage1', { /* ... */ });

const vault2 = new KeyVault('vault2', { /* ... */ });
const logs2 = new LogAnalytics('logs2', { /* ... */ });
const storage2 = new StorageAccount('storage2', { /* ... */ });
```

**After:**
```typescript
// Use ResourceBuilder for common patterns
function createAppInfra(name: string, config: AppConfig) {
  const builder = new ResourceBuilder(name, {
    vault: { sku: 'standard' },
    logs: { retentionInDays: 90 },
  });
  
  const storage = new StorageAccount(`${name}-storage`, {
    group: builder.getResourceGroup()!,
    vaultInfo: builder.getVault(),
    ...config.storageConfig,
  });
  
  return { builder, storage };
}

const app1 = createAppInfra('app1', app1Config);
const app2 = createAppInfra('app2', app2Config);
```

### Pattern 3: Replace Magic Strings with Types

**Before:**
```typescript
const storage = new StorageAccount('storage', {
  tier: 'standard', // Could typo as 'standrd'
  location: 'eastus', // Could typo as 'east-us'
});
```

**After:**
```typescript
// Define types
type Tier = 'Basic' | 'Standard' | 'Premium';
type AzureLocation = 'eastus' | 'westus' | 'westeurope' | /* ... */;

interface StorageConfig {
  tier: Tier;
  location: AzureLocation;
}

const config: StorageConfig = {
  tier: 'Standard', // Type-checked
  location: 'eastus', // Type-checked
};

const storage = new StorageAccount('storage', config);
```

### Pattern 4: Eliminate Duplication with Helpers

**Before:**
```typescript
// Repeated logic
const name1 = `${env}-${app}-storage1`.toLowerCase().substring(0, 24);
const name2 = `${env}-${app}-storage2`.toLowerCase().substring(0, 24);
const name3 = `${env}-${app}-storage3`.toLowerCase().substring(0, 24);
```

**After:**
```typescript
// Create helper
function getStorageName(base: string): string {
  const full = `${env}-${app}-${base}`;
  return full.toLowerCase().substring(0, 24);
}

const name1 = getStorageName('storage1');
const name2 = getStorageName('storage2');
const name3 = getStorageName('storage3');
```

### Pattern 5: Improve Error Handling

**Before:**
```typescript
constructor(name: string, args: MyArgs) {
  super('MyComponent', name, args);
  
  // No validation
  const resource = new AzureResource(name, {
    property: args.value, // Could be undefined or invalid
  });
}
```

**After:**
```typescript
constructor(name: string, args: MyArgs) {
  super('MyComponent', name, args);
  
  // Validate early
  if (!args.value) {
    throw new Error(`MyComponent '${name}' requires 'value' property`);
  }
  
  if (!['valid1', 'valid2'].includes(args.value)) {
    throw new Error(
      `MyComponent '${name}' received invalid value '${args.value}'. ` +
      `Expected one of: 'valid1', 'valid2'`
    );
  }
  
  const resource = new AzureResource(name, {
    property: args.value,
  });
}
```

## Component Upgrade Guide

### Version Changes

When upgrading component versions:

1. **Review changelog** for breaking changes
2. **Update dependencies** in package.json
3. **Update imports** if paths changed
4. **Refactor deprecated APIs** to new equivalents
5. **Test thoroughly** before deploying

### Handling Breaking Changes

```typescript
// Old version (deprecated)
const component = new OldComponent('name', {
  oldProperty: 'value',
});

// New version (with migration)
const component = new NewComponent('name', {
  newProperty: 'value', // Renamed from oldProperty
  // Add new required properties
  requiredNewProperty: 'default-value',
});
```

### Gradual Migration

```typescript
// Step 1: Run both old and new in parallel
const oldComponent = new OldComponent('old', oldConfig);
const newComponent = new NewComponent('new', newConfig);

// Step 2: Validate new component works
export const oldOutput = oldComponent.id;
export const newOutput = newComponent.id;

// Step 3: Switch traffic to new component
// Step 4: Remove old component when validated
```

## Infrastructure Refactoring Checklist

Before starting refactoring:

- [ ] Have backup of current state
- [ ] Document current infrastructure
- [ ] Identify dependencies
- [ ] Plan migration strategy
- [ ] Create test environment for validation
- [ ] Set up rollback plan

During refactoring:

- [ ] Make incremental changes
- [ ] Test after each change
- [ ] Use `pulumi preview` extensively
- [ ] Document changes made
- [ ] Update tests
- [ ] Verify no unintended changes

After refactoring:

- [ ] Run full test suite
- [ ] Verify in test environment
- [ ] Compare before/after outputs
- [ ] Update documentation
- [ ] Train team on changes
- [ ] Monitor production deployment

## Migration Best Practices

### 1. Always Preview First

```bash
# See what will change
pulumi preview --diff

# Save preview output
pulumi preview --diff > preview.txt
```

### 2. Use Stack References

```typescript
// Reference existing stack
const sharedStack = new pulumi.StackReference('organization/shared/prod');

const vaultId = sharedStack.getOutput('vaultId');
const vnetId = sharedStack.getOutput('vnetId');

// Use in new components
const component = new MyComponent('name', {
  vaultId: vaultId,
  vnetId: vnetId,
});
```

### 3. Implement Feature Flags

```typescript
const config = new pulumi.Config();
const useNewComponent = config.getBoolean('useNewComponent') ?? false;

if (useNewComponent) {
  const newComponent = new NewComponent('component', args);
  export const componentId = newComponent.id;
} else {
  const oldComponent = new OldComponent('component', args);
  export const componentId = oldComponent.id;
}
```

### 4. Maintain State Consistency

```bash
# Before major changes, export state
pulumi stack export > state-backup-$(date +%Y%m%d).json

# If something goes wrong, restore
pulumi stack import < state-backup-20240101.json
```

### 5. Use Aliases for Renames

```typescript
// When renaming resources
const component = new MyComponent('new-name', args, {
  aliases: [{ name: 'old-name' }],
});

// Pulumi will understand it's the same resource
```

## Common Migration Pitfalls

### Pitfall 1: Changing Resource Names

❌ **Don't:**
```typescript
// This will destroy and recreate!
const storage = new StorageAccount('new-name', args);
```

✅ **Do:**
```typescript
// Use aliases
const storage = new StorageAccount('new-name', args, {
  aliases: [{ name: 'old-name' }],
});
```

### Pitfall 2: Ignoring Dependencies

❌ **Don't:**
```typescript
// Remove resource without checking dependencies
// This might break other resources!
```

✅ **Do:**
```bash
# Check what depends on resource
pulumi stack graph | grep "resource-name"

# Carefully handle dependencies before removal
```

### Pitfall 3: Not Testing in Non-Prod First

❌ **Don't:**
```bash
# Migrating directly in production
pulumi up --stack prod
```

✅ **Do:**
```bash
# Test in dev/staging first
pulumi up --stack dev
pulumi up --stack staging
# Only then apply to prod
pulumi up --stack prod
```

## Migration Tools & Scripts

### Resource Import Script

```bash
#!/bin/bash
# import-resources.sh

RESOURCES=(
  "azure-native:resources:ResourceGroup:rg:/subscriptions/.../resourceGroups/my-rg"
  "azure-native:storage:StorageAccount:storage:/subscriptions/.../storageAccounts/mystorage"
)

for RESOURCE in "${RESOURCES[@]}"; do
  IFS=':' read -r TYPE NAME ID <<< "$RESOURCE"
  echo "Importing $NAME..."
  pulumi import "$TYPE" "$NAME" "$ID"
done
```

### State Comparison Script

```bash
#!/bin/bash
# compare-states.sh

# Export current state
pulumi stack export > current-state.json

# Apply changes
pulumi up

# Export new state
pulumi stack export > new-state.json

# Compare
diff -u current-state.json new-state.json > state-diff.txt
```

## Additional Resources

- Pulumi migration guides: https://www.pulumi.com/docs/guides/adopting/
- Terraform converter: https://www.pulumi.com/tf2pulumi/
- Azure import guide: https://www.pulumi.com/registry/packages/azure-native/how-to-guides/importing/
- Component examples: See `pulumi-test/` directory
