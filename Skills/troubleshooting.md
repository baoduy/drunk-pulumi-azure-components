# Troubleshooting & Debugging Skill

This skill helps you diagnose and resolve common issues when working with Drunk Pulumi Azure Components.

## Skill Purpose

Quickly identify, diagnose, and resolve issues that arise during development, deployment, and operation of Azure infrastructure using Pulumi.

## When to Use This Skill

- Deployment failures
- Type errors
- Component not behaving as expected
- Azure resource errors
- Network connectivity issues
- Permission errors
- Build or test failures

## Diagnostic Approach

### Step 1: Identify the Error Type

Errors typically fall into these categories:

1. **Compile-time errors** - TypeScript/JavaScript issues
2. **Pulumi runtime errors** - Infrastructure as code issues
3. **Azure provider errors** - Azure API/resource issues
4. **Configuration errors** - Missing or incorrect configuration
5. **Network errors** - Connectivity and firewall issues
6. **Permission errors** - RBAC and access control issues

### Step 2: Gather Information

```bash
# Check Pulumi status
pulumi stack

# View stack outputs
pulumi stack output

# Check recent operations
pulumi history

# View detailed logs
pulumi up --debug --logtostderr -v=9 2> debug.log

# Check Azure CLI connection
az account show

# Verify TypeScript compilation
npx tsc --noEmit
```

### Step 3: Isolate the Issue

- Identify the specific component causing the problem
- Check if issue is reproducible
- Test with minimal configuration
- Verify in clean environment

## Common Issues & Solutions

### TypeScript & Compilation Issues

#### Issue: Type Error - Property Missing

```
Error: Property 'group' does not exist on type 'MyComponentArgs'
```

**Diagnosis:**
Component requires `group` property but it wasn't provided.

**Solution:**
```typescript
// ❌ Missing required property
const component = new MyComponent('test', {
  tier: 'Standard',
});

// ✅ Include required property
const component = new MyComponent('test', {
  group: {
    resourceGroupName: 'my-rg',
    location: 'eastus',
  },
  tier: 'Standard',
});
```

---

#### Issue: Type Error - Invalid Enum Value

```
Type '"invalid"' is not assignable to type '"Basic" | "Standard" | "Premium"'
```

**Diagnosis:**
Using a value that's not in the allowed set.

**Solution:**
```typescript
// ❌ Invalid value
const component = new MyComponent('test', {
  tier: 'invalid',
});

// ✅ Use valid enum value
const component = new MyComponent('test', {
  tier: 'Standard', // One of: 'Basic' | 'Standard' | 'Premium'
});
```

---

#### Issue: Cannot Find Module

```
Cannot find module '@drunk-pulumi/azure-components/vault'
```

**Diagnosis:**
Module path incorrect or dependencies not installed.

**Solution:**
```bash
# Reinstall dependencies
pnpm install

# Check imports
# ✅ Correct
import { Vault } from '@drunk-pulumi/azure-components/vault';

# ❌ Incorrect (extra /vault in path when importing from package)
import { Vault } from '@drunk-pulumi/azure-components/src/vault';
```

---

#### Issue: Circular Dependency

```
ReferenceError: Cannot access 'X' before initialization
```

**Diagnosis:**
Components referencing each other creating a cycle.

**Solution:**
```typescript
// ❌ Circular dependency
const componentA = new ComponentA('a', {
  dependsOn: componentB, // References B
});

const componentB = new ComponentB('b', {
  dependsOn: componentA, // References A - circular!
});

// ✅ Proper dependency order
const componentA = new ComponentA('a', {});

const componentB = new ComponentB('b', {
  dependsOn: componentA, // One-way dependency
});
```

### Pulumi Runtime Issues

#### Issue: Resource Already Exists

```
error: resource already exists: 'resource-name'
```

**Diagnosis:**
Attempting to create a resource that already exists in Azure.

**Solution:**
```bash
# Option 1: Import existing resource
pulumi import <type> <name> <id>

# Option 2: Use different name
# Change the resource name in code

# Option 3: Delete and recreate
pulumi destroy --target urn:pulumi:stack::project::type::name
pulumi up
```

---

#### Issue: Resource Not Found During Update

```
error: resource not found: 'resource-name'
```

**Diagnosis:**
Resource was deleted outside of Pulumi or state is out of sync.

**Solution:**
```bash
# Refresh state to sync with Azure
pulumi refresh

# If resource truly doesn't exist, remove from state
pulumi state delete <urn>

# Then recreate
pulumi up
```

---

#### Issue: Outputs Not Available

```
TypeError: Cannot read property 'id' of undefined
```

**Diagnosis:**
Trying to access output of a component that wasn't created or is undefined.

**Solution:**
```typescript
// ❌ No null check
const vaultId = builder.getVault().id; // Error if vault not created

// ✅ Check if component exists
const vault = builder.getVault();
if (vault) {
  const vaultId = vault.id;
}

// ✅ Use optional chaining
const vaultId = builder.getVault()?.id;
```

---

#### Issue: Output Values in Conditionals

```
Error: Cannot use output values in conditionals
```

**Diagnosis:**
Trying to use `pulumi.Output<T>` in an if statement directly.

**Solution:**
```typescript
// ❌ Can't use Output directly in conditional
if (myOutput === 'value') { // Error!
  // ...
}

// ✅ Use apply() for conditional logic
myOutput.apply(value => {
  if (value === 'expected') {
    // Handle the case
  }
});

// ✅ Or use pulumi.all for multiple outputs
pulumi.all([output1, output2]).apply(([val1, val2]) => {
  if (val1 === val2) {
    // ...
  }
});
```

### Azure Provider Issues

#### Issue: Insufficient Permissions

```
Status=403, Code="AuthorizationFailed", Message="The client does not have authorization to perform action..."
```

**Diagnosis:**
The identity running Pulumi doesn't have required Azure permissions.

**Solution:**
```bash
# Check current identity
az account show

# Verify role assignments
az role assignment list --assignee <object-id>

# Grant required permissions
az role assignment create \
  --assignee <object-id> \
  --role Contributor \
  --scope /subscriptions/<subscription-id>/resourceGroups/<rg-name>
```

---

#### Issue: Resource Name Already Taken

```
Status=409, Code="StorageAccountAlreadyTaken", Message="The storage account named 'myaccount' is already taken"
```

**Diagnosis:**
Azure resource name must be globally unique but is already in use.

**Solution:**
```typescript
// ❌ Common name likely taken
const storage = new StorageAccount('storage', {
  name: 'myapp', // Too generic
});

// ✅ Use unique naming
import { getResourceName } from './helpers';

const storage = new StorageAccount('storage', {
  name: getResourceName('myapp-storage', { 
    suffix: pulumi.getStack(),
    maxLength: 24,
  }),
});
```

---

#### Issue: Invalid Resource Configuration

```
Status=400, Code="InvalidParameter", Message="The value of parameter X is invalid"
```

**Diagnosis:**
Azure resource configuration violates Azure service constraints.

**Solution:**
```typescript
// Check Azure documentation for valid values
// Common issues:

// ❌ Invalid SKU combination
const storage = new StorageAccount('storage', {
  sku: { name: 'Premium_LRS' },
  kind: 'BlobStorage', // Premium doesn't support BlobStorage
});

// ✅ Valid combination
const storage = new StorageAccount('storage', {
  sku: { name: 'Premium_LRS' },
  kind: 'BlockBlobStorage',
});
```

---

#### Issue: Quota Exceeded

```
Status=409, Code="OperationNotAllowed", Message="Quota exceeded for CPUs in region"
```

**Diagnosis:**
Azure subscription quota limit reached.

**Solution:**
```bash
# Check current quotas
az vm list-usage --location eastus

# Request quota increase through Azure Portal
# Or choose different region or VM size
```

### Network & Connectivity Issues

#### Issue: Cannot Access Private Resource

```
Error: dial tcp: lookup mystorageaccount.blob.core.windows.net: no such host
```

**Diagnosis:**
Trying to access private endpoint resource without proper network access.

**Solution:**
```typescript
// Ensure proper DNS and network configuration
const privateEndpoint = new PrivateEndpoint('storage-pe', {
  subnet: privateSubnet,
  privateLinkServiceId: storage.id,
});

// Add private DNS zone
const dnsZone = new PrivateDnsZone('blob-dns', {
  name: 'privatelink.blob.core.windows.net',
  vnetLinks: [{
    virtualNetworkId: vnet.id,
    registrationEnabled: false,
  }],
});
```

---

#### Issue: Firewall Blocking Access

```
Status=403, Code="Forbidden", Message="This request is not authorized to perform this operation"
```

**Diagnosis:**
Resource firewall rules blocking access.

**Solution:**
```typescript
const storage = new StorageAccount('storage', {
  networkRules: {
    defaultAction: 'Deny',
    bypass: 'AzureServices',
    
    // Add your IP
    ipRules: ['203.0.113.0/24'],
    
    // Or allow from VNet
    virtualNetworkRules: [{
      id: subnet.id,
    }],
  },
});
```

---

#### Issue: NSG Rules Blocking Traffic

**Diagnosis:**
Network Security Group rules preventing traffic flow.

**Solution:**
```typescript
// Review NSG rules
const nsg = new NetworkSecurityGroup('nsg', {
  securityRules: [
    {
      name: 'allow-app-traffic',
      priority: 100, // Lower priority = evaluated first
      direction: 'Inbound',
      access: 'Allow',
      protocol: 'Tcp',
      sourceAddressPrefix: '10.0.1.0/24',
      destinationPortRange: '443',
    },
  ],
});

// Debug: Check effective security rules
// az network nic show-effective-nsg --name <nic-name> --resource-group <rg>
```

### Key Vault Issues

#### Issue: Cannot Access Key Vault

```
Error: access denied - The user, group or application does not have secrets get permission
```

**Diagnosis:**
Missing Key Vault access policy or RBAC permissions.

**Solution:**
```typescript
// Option 1: Access Policy
const policy = new KeyVaultAccessPolicy('app-policy', {
  vaultId: vault.id,
  tenantId: vault.tenantId,
  objectId: identity.principalId,
  
  secretPermissions: ['Get', 'List'],
  keyPermissions: ['Get', 'List'],
});

// Option 2: RBAC (if enabled)
new RoleAssignment('vault-secrets-user', {
  principalId: identity.principalId,
  roleName: 'Key Vault Secrets User',
  scope: vault.id,
});
```

---

#### Issue: Key Vault in Soft-Delete State

```
Error: existing soft-deleted key vault with the same name
```

**Diagnosis:**
Previously deleted Key Vault still in soft-delete period.

**Solution:**
```bash
# Option 1: Recover deleted vault
az keyvault recover --name <vault-name>

# Option 2: Purge deleted vault (if purge protection not enabled)
az keyvault purge --name <vault-name>

# Option 3: Wait for retention period to expire (up to 90 days)
# Option 4: Use different name
```

### Build & Test Issues

#### Issue: Build Fails

```
error TS2307: Cannot find module or its corresponding type declarations
```

**Diagnosis:**
Missing types or incorrect tsconfig.json.

**Solution:**
```bash
# Clean and rebuild
rm -rf node_modules bin/
pnpm install
pnpm run build

# Update tsconfig
pnpm run update-tsconfig

# Check tsconfig.json includes all source files
```

---

#### Issue: Tests Timeout

```
Error: Timeout - Async callback was not invoked within the 5000 ms timeout
```

**Diagnosis:**
Test not completing, possibly missing Pulumi mocks.

**Solution:**
```typescript
// Add Pulumi mocks at top of test file
import * as pulumi from '@pulumi/pulumi';

pulumi.runtime.setMocks({
  newResource: (args: pulumi.runtime.MockResourceArgs) => ({
    id: args.name + '_id',
    state: args.inputs,
  }),
  call: (args: pulumi.runtime.MockCallArgs) => args.inputs,
});

// Or increase timeout
jest.setTimeout(10000);
```

---

#### Issue: Jest Cannot Find Module

```
Cannot find module '@drunk-pulumi/azure-components' from '__tests__/...'
```

**Diagnosis:**
Jest module resolution issue.

**Solution:**
```javascript
// Check jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@drunk-pulumi/azure-components/(.*)$': '<rootDir>/src/$1',
    '^@drunk-pulumi/azure-components$': '<rootDir>/src',
  },
};
```

## Debugging Techniques

### Enable Verbose Logging

```bash
# Maximum verbosity
pulumi up --debug --logtostderr -v=9

# Save logs to file
pulumi up --debug --logtostderr -v=9 2> deployment.log

# View specific resource logs
pulumi logs --follow
```

### Interactive Debugging

```typescript
// Add console.log for debugging (remove before commit)
constructor(name: string, args: MyArgs, opts?: pulumi.ComponentResourceOptions) {
  super('MyComponent', name, args, opts);
  
  console.log('Args:', JSON.stringify(args, null, 2));
  console.log('Name:', name);
  
  // ... rest of constructor
}

// Debug outputs
pulumi.Output.all([output1, output2]).apply(([val1, val2]) => {
  console.log('Output values:', { val1, val2 });
});
```

### State Inspection

```bash
# View current state
pulumi stack export

# Save state to file
pulumi stack export > state.json

# Compare with previous state
pulumi stack history
pulumi stack export --version <number>

# View specific resource
pulumi stack export | jq '.deployment.resources[] | select(.type=="azure-native:storage:StorageAccount")'
```

### Network Debugging

```bash
# Test connectivity from Azure VM
az vm run-command invoke \
  --resource-group myRG \
  --name myVM \
  --command-id RunShellScript \
  --scripts "curl -v https://mystorageaccount.blob.core.windows.net"

# Check DNS resolution
az vm run-command invoke \
  --resource-group myRG \
  --name myVM \
  --command-id RunShellScript \
  --scripts "nslookup mystorageaccount.privatelink.blob.core.windows.net"

# Test from local machine
curl -v https://mystorageaccount.blob.core.windows.net
nslookup mystorageaccount.blob.core.windows.net
```

## Prevention Strategies

### 1. Use Strong Typing

```typescript
// ✅ Define explicit types
interface MyConfig {
  tier: 'Basic' | 'Standard' | 'Premium';
  location: string;
}

const config: MyConfig = {
  tier: 'Standard',
  location: 'eastus',
};

// Catch errors at compile time, not runtime
```

### 2. Validate Early

```typescript
constructor(name: string, args: MyArgs, opts?: pulumi.ComponentResourceOptions) {
  super('MyComponent', name, args, opts);
  
  // Validate immediately
  if (!args.group) {
    throw new Error('group is required');
  }
  
  if (args.tier && !['Basic', 'Standard', 'Premium'].includes(args.tier)) {
    throw new Error(`Invalid tier: ${args.tier}`);
  }
  
  // Continue with resource creation
}
```

### 3. Use Pulumi Preview

```bash
# Always preview before applying
pulumi preview

# Review planned changes carefully
# Look for unexpected creates, updates, or deletes
```

### 4. Test in Isolation

```bash
# Test components independently
pnpm run test

# Test specific component
pnpm run test MyComponent.test.ts

# Use integration tests for complex scenarios
```

### 5. Implement Monitoring

```typescript
// Add alerts for failures
const alert = new MetricAlert('deployment-alert', {
  description: 'Alert on resource failures',
  criteria: {
    metricName: 'ResourceHealth',
    operator: 'LessThan',
    threshold: 1,
  },
  actions: [{
    actionGroupId: actionGroup.id,
  }],
});
```

## Getting Help

### Information to Provide

When asking for help, include:

1. **Error message** - Full text including stack trace
2. **Component code** - Relevant component definition
3. **Pulumi version** - `pulumi version`
4. **Node version** - `node --version`
5. **Azure CLI version** - `az version`
6. **Steps to reproduce** - Minimal reproducible example
7. **Expected vs actual behavior**

### Resources

- **Project Documentation**: See `README.md` and `doc/` folder
- **Copilot Instructions**: `.github/copilot-instructions.md`
- **Pulumi Docs**: https://www.pulumi.com/docs/
- **Azure Docs**: https://docs.microsoft.com/azure/
- **GitHub Issues**: Check existing issues in repository

## Quick Troubleshooting Checklist

- [ ] Run `npx tsc --noEmit` to check for type errors
- [ ] Run `pnpm run test` to verify tests pass
- [ ] Check Pulumi logs with `--debug` flag
- [ ] Verify Azure credentials: `az account show`
- [ ] Check resource exists in Azure Portal
- [ ] Review security rules (NSG, firewall, access policies)
- [ ] Verify sufficient Azure permissions
- [ ] Check resource quotas and limits
- [ ] Review recent Pulumi history: `pulumi history`
- [ ] Refresh state: `pulumi refresh`
- [ ] Check for naming conflicts
- [ ] Verify network connectivity
- [ ] Review Key Vault access policies
- [ ] Check for circular dependencies
- [ ] Validate configuration values

## Debug Commands Reference

```bash
# Pulumi
pulumi up --debug -v=9
pulumi preview --diff
pulumi refresh
pulumi stack export
pulumi logs --follow

# Azure CLI
az account show
az resource list
az group show --name <rg>
az network nsg show --name <nsg> --resource-group <rg>
az keyvault show --name <vault>

# TypeScript
npx tsc --noEmit
npx tsc --listFiles

# Node/NPM
node --version
pnpm list --depth=0
pnpm install
pnpm run build

# Git (check for uncommitted changes)
git status
git diff
```
