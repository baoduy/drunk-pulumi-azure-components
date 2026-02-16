# Security Best Practices Skill

This skill guides you through implementing secure Azure infrastructure using Drunk Pulumi Azure Components.

## Skill Purpose

Ensure Azure infrastructure deployments follow security best practices, protect sensitive data, implement proper access controls, and maintain compliance with security standards.

## When to Use This Skill

- Designing new infrastructure components
- Reviewing security configurations
- Implementing access controls
- Managing secrets and credentials
- Configuring network security
- Ensuring compliance requirements
- Responding to security vulnerabilities

## Core Security Principles

### 1. Defense in Depth

Implement multiple layers of security controls:

- **Identity**: Managed identities, Azure AD authentication
- **Network**: VNets, NSGs, firewalls, private endpoints
- **Data**: Encryption at rest and in transit
- **Application**: Secure coding, input validation
- **Operations**: Monitoring, logging, alerting

### 2. Least Privilege

Grant minimum permissions necessary:

```typescript
// ✅ Good: Specific role for specific resource
new RoleAssignment('storage-reader', {
  principalId: identity.principalId,
  roleName: 'Storage Blob Data Reader',
  scope: storageAccount.id,
});

// ❌ Bad: Overly broad permissions
new RoleAssignment('contributor', {
  principalId: identity.principalId,
  roleName: 'Contributor', // Too broad
  scope: subscriptionId,
});
```

### 3. Zero Trust

Never assume trust, always verify:

- Use managed identities instead of credentials
- Implement network segmentation
- Enable conditional access
- Monitor and audit all access
- Encrypt all data

## Secret Management

### Rule #1: Never Hardcode Secrets

❌ **NEVER do this:**

```typescript
// WRONG - Secret in code
const connectionString = 'Server=myserver;User=admin;Password=secret123';

// WRONG - Secret in config
const config = new pulumi.Config();
const apiKey = 'sk-1234567890abcdef'; // Hardcoded

// WRONG - Secrets in exports
export const databasePassword = 'MyP@ssw0rd!';
```

✅ **DO this instead:**

```typescript
import { VaultSecret } from '@drunk-pulumi/azure-components/vault';
import * as pulumi from '@pulumi/pulumi';

// Store secrets in Key Vault
const secret = new VaultSecret('db-password', {
  vaultInfo: vault,
  value: pulumi.secret(randomPassword.result), // Mark as secret
  contentType: 'password',
});

// Use Pulumi secrets for configuration
const config = new pulumi.Config();
const apiKey = config.requireSecret('api-key'); // From Pulumi config

// Don't export secrets directly
export const secretId = secret.id; // ✅ OK - just the ID
// export const secretValue = secret.value; // ❌ NEVER
```

### Secret Generation

Use cryptographically secure random generation:

```typescript
import { RandomPassword } from '@drunk-pulumi/azure-components/common';

const password = new RandomPassword('admin-password', {
  length: 32,
  special: true,
  minSpecial: 2,
  minNumeric: 2,
  minUpper: 2,
  minLower: 2,
});

// Store in Key Vault automatically
const vault = builder.getVault();
if (vault) {
  new VaultSecret('admin-pwd', {
    vaultInfo: vault,
    value: pulumi.secret(password.result),
  });
}
```

### Key Vault Configuration

Secure Key Vault setup:

```typescript
const builder = new ResourceBuilder('secure-app', {
  vault: {
    sku: 'premium', // Use premium for HSM-backed keys
    
    // Enable security features
    enableSoftDelete: true, // Prevent permanent deletion
    enablePurgeProtection: true, // Prevent purge during soft-delete
    softDeleteRetentionInDays: 90,
    
    // Network security
    networkRules: {
      defaultAction: 'Deny', // Block by default
      ipRules: ['203.0.113.0/24'], // Only allow known IPs
      virtualNetworkRules: [{ id: subnet.id }],
    },
    
    // Enable for specific use cases
    enabledForDiskEncryption: true,
    enabledForTemplateDeployment: false, // Only if needed
    enabledForDeployment: false, // Only if needed
  },
});
```

### Accessing Secrets Securely

```typescript
// Use managed identity to access vault
const identity = builder.getDefaultUAssignId();

// Grant access to specific secrets only
new KeyVaultAccessPolicy('app-access', {
  keyVaultId: vault.id,
  tenantId: vault.tenantId,
  objectId: identity.principalId,
  secretPermissions: ['Get', 'List'], // Minimal permissions
});

// Application retrieves secret at runtime
// Never expose secret value in IaC code
```

## Identity & Access Management

### Use Managed Identities

Always prefer managed identities over credentials:

```typescript
// ✅ Good: Managed identity
const identity = builder.getDefaultUAssignId();

const appService = new AppService('myapp', {
  identity: {
    type: 'UserAssigned',
    userAssignedIdentities: [identity.id],
  },
});

// Grant permissions
new RoleAssignment('storage-access', {
  principalId: identity.principalId,
  roleName: 'Storage Blob Data Contributor',
  scope: storageAccount.id,
});

// ❌ Bad: Service principal with credentials
const servicePrincipal = new azuread.ServicePrincipal('app-sp', {});
const password = new azuread.ServicePrincipalPassword('app-sp-pwd', {
  servicePrincipalId: servicePrincipal.id,
});
// Now you have to manage and rotate credentials
```

### Role-Based Access Control (RBAC)

Implement granular access control:

```typescript
import { RoleAssignment } from '@drunk-pulumi/azure-components/azAd';

// Principle: Use built-in roles when possible
const roleAssignments = [
  // Storage access
  {
    name: 'storage-reader',
    role: 'Storage Blob Data Reader',
    scope: storageAccount.id,
  },
  // SQL access
  {
    name: 'sql-contributor',
    role: 'SQL DB Contributor',
    scope: sqlDatabase.id,
  },
  // Key Vault access
  {
    name: 'vault-secrets-user',
    role: 'Key Vault Secrets User',
    scope: vault.id,
  },
];

roleAssignments.forEach(({ name, role, scope }) => {
  new RoleAssignment(name, {
    principalId: identity.principalId,
    roleName: role,
    scope: scope,
  });
});
```

### Azure AD Group Roles

Use groups for team-based access:

```typescript
const builder = new ResourceBuilder('app', {
  groupRoles: {
    createWithName: 'rg-app-prod',
    
    // Assign team groups
    roles: [
      {
        groupNames: ['DevTeam'],
        roleName: 'Contributor',
      },
      {
        groupNames: ['SRETeam'],
        roleName: 'Monitoring Reader',
      },
      {
        groupNames: ['SecurityTeam'],
        roleName: 'Security Reader',
      },
    ],
  },
});
```

## Network Security

### Virtual Network Isolation

Implement proper network segmentation:

```typescript
const builder = new ResourceBuilder('secure-network', {
  vnet: {
    addressSpace: ['10.0.0.0/16'],
    
    // Segment by security requirements
    subnets: [
      {
        name: 'frontend',
        addressPrefix: '10.0.1.0/24',
        // Public-facing resources
      },
      {
        name: 'backend',
        addressPrefix: '10.0.2.0/24',
        // Application tier
        serviceEndpoints: [
          'Microsoft.Storage',
          'Microsoft.Sql',
          'Microsoft.KeyVault',
        ],
      },
      {
        name: 'data',
        addressPrefix: '10.0.3.0/24',
        // Data tier - most restricted
        privateEndpointNetworkPolicies: 'Enabled',
        privateLinkServiceNetworkPolicies: 'Enabled',
      },
    ],
  },
});
```

### Network Security Groups (NSGs)

Control traffic with NSG rules:

```typescript
import { NetworkSecurityGroup } from '@drunk-pulumi/azure-components/vnet';

const nsg = new NetworkSecurityGroup('backend-nsg', {
  group: resourceGroup,
  
  securityRules: [
    {
      name: 'allow-https',
      priority: 100,
      direction: 'Inbound',
      access: 'Allow',
      protocol: 'Tcp',
      sourceAddressPrefix: '10.0.1.0/24', // Only from frontend
      sourcePortRange: '*',
      destinationAddressPrefix: '10.0.2.0/24',
      destinationPortRange: '443',
    },
    {
      name: 'deny-internet',
      priority: 4096,
      direction: 'Outbound',
      access: 'Deny',
      protocol: '*',
      sourceAddressPrefix: '*',
      sourcePortRange: '*',
      destinationAddressPrefix: 'Internet',
      destinationPortRange: '*',
    },
  ],
});
```

### Azure Firewall

Enterprise-grade network protection:

```typescript
const builder = new ResourceBuilder('enterprise', {
  vnet: {
    addressSpace: ['10.0.0.0/16'],
    
    firewall: {
      enabled: true,
      sku: 'Premium', // For TLS inspection
      
      // Threat intelligence
      threatIntelMode: 'Alert', // or 'Deny'
      
      // DNS settings
      dnsServers: ['168.63.129.16'], // Azure DNS
      
      // Configure policies
      policies: {
        applicationRules: [
          {
            name: 'allow-azure',
            protocols: [{ port: 443, protocolType: 'Https' }],
            targetFqdns: ['*.azure.com', '*.microsoft.com'],
            sourceAddresses: ['10.0.0.0/16'],
          },
        ],
        networkRules: [
          {
            name: 'allow-dns',
            protocols: ['UDP'],
            destinationPorts: ['53'],
            destinationAddresses: ['168.63.129.16'],
          },
        ],
      },
    },
  },
});
```

### Private Endpoints

Use private endpoints for Azure PaaS services:

```typescript
import { PrivateEndpoint } from '@drunk-pulumi/azure-components/vnet';

// Storage private endpoint
const storagePrivateEndpoint = new PrivateEndpoint('storage-pe', {
  group: resourceGroup,
  subnet: dataSubnet,
  
  privateLinkServiceConnections: [{
    name: 'storage-connection',
    privateLinkServiceId: storageAccount.id,
    groupIds: ['blob'], // or 'file', 'table', etc.
  }],
});

// Disable public access
const secureStorage = new StorageAccount('secure-storage', {
  group: resourceGroup,
  
  networkRules: {
    defaultAction: 'Deny', // Block public access
    bypass: 'AzureServices',
  },
  
  // Enable private endpoint only
  publicNetworkAccess: 'Disabled',
});
```

## Data Encryption

### Encryption at Rest

Encrypt all data stored in Azure:

```typescript
// Option 1: Microsoft-managed keys (default, easier)
const storage = new StorageAccount('storage', {
  group: resourceGroup,
  
  encryption: {
    keySource: 'Microsoft.Storage', // Microsoft-managed
    requireInfrastructureEncryption: true, // Double encryption
  },
});

// Option 2: Customer-managed keys (more control)
const builder = new ResourceBuilder('encrypted', {
  vault: {
    sku: 'premium',
    enabledForDiskEncryption: true,
  },
  diskEncryptionSet: {
    enabled: true, // Creates encryption key in vault
  },
});

const storage = new StorageAccount('cmk-storage', {
  group: resourceGroup,
  vaultInfo: builder.getVault(),
  
  encryption: {
    keySource: 'Microsoft.KeyVault',
    keyVaultProperties: {
      keyName: encryptionKey.name,
      keyVaultUri: vault.vaultUri,
    },
  },
});
```

### Encryption in Transit

Enforce TLS/HTTPS:

```typescript
const storage = new StorageAccount('secure-storage', {
  group: resourceGroup,
  
  // Require HTTPS
  supportsHttpsTrafficOnly: true,
  
  // Minimum TLS version
  minimumTlsVersion: 'TLS1_2',
});

const appService = new AppService('secure-app', {
  group: resourceGroup,
  
  siteConfig: {
    // Require HTTPS
    httpsOnly: true,
    
    // TLS version
    minTlsVersion: '1.2',
    
    // HTTP 2.0
    http20Enabled: true,
  },
});
```

### Disk Encryption

Encrypt VM disks:

```typescript
const builder = new ResourceBuilder('vm-infra', {
  vault: { sku: 'premium' },
  
  diskEncryptionSet: {
    enabled: true,
    // Uses Key Vault key automatically
  },
});

const vm = new VirtualMachine('app-vm', {
  group: resourceGroup,
  
  // Reference encryption set
  diskEncryptionSetId: builder.getDiskEncryptionSet()?.id,
  
  osDisk: {
    caching: 'ReadWrite',
    storageAccountType: 'Premium_LRS',
  },
});
```

## Logging & Monitoring

### Enable Comprehensive Logging

```typescript
const builder = new ResourceBuilder('monitored-app', {
  logs: {
    sku: 'PerGB2018',
    retentionInDays: 90, // Compliance requirement
    
    // Daily cap to control costs
    dailyQuotaGb: 10,
  },
});

// Enable diagnostic logs for resources
const diagnosticSettings = new DiagnosticSettings('storage-logs', {
  name: 'storage-diagnostics',
  targetResourceId: storageAccount.id,
  workspaceId: builder.getLogWorkspace()?.id,
  
  logs: [
    {
      category: 'StorageRead',
      enabled: true,
      retentionPolicy: { enabled: true, days: 90 },
    },
    {
      category: 'StorageWrite',
      enabled: true,
      retentionPolicy: { enabled: true, days: 90 },
    },
  ],
  
  metrics: [
    {
      category: 'Transaction',
      enabled: true,
      retentionPolicy: { enabled: true, days: 90 },
    },
  ],
});
```

### Security Monitoring

```typescript
// Enable Microsoft Defender for Cloud
const securityCenter = new SecurityCenterSubscriptionPricing('defender', {
  tier: 'Standard',
  resourceType: 'VirtualMachines', // Also StorageAccounts, SqlServers, etc.
});

// Alert on security events
const securityAlert = new MetricAlert('security-alert', {
  description: 'Alert on suspicious activity',
  scopes: [resourceGroup.id],
  criteria: {
    metricName: 'FailedAuthentication',
    operator: 'GreaterThan',
    threshold: 5,
    timeAggregation: 'Total',
  },
});
```

## Compliance & Governance

### Azure Policy

Enforce organizational standards:

```typescript
import { PolicyAssignment } from '@drunk-pulumi/azure-components/common';

// Require encryption
const encryptionPolicy = new PolicyAssignment('require-encryption', {
  scope: resourceGroup.id,
  policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/...',
  parameters: {
    effect: { value: 'Deny' },
  },
});

// Require tags
const tagsPolicy = new PolicyAssignment('require-tags', {
  scope: resourceGroup.id,
  policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/...',
  parameters: {
    tagName: { value: 'Environment' },
  },
});
```

### Resource Locks

Prevent accidental deletion:

```typescript
import { ResourceLock } from '@drunk-pulumi/azure-components/common';

// Lock critical resources
const lock = new ResourceLock('vault-lock', {
  scope: vault.id,
  level: 'CanNotDelete', // or 'ReadOnly'
  notes: 'Critical vault - do not delete',
});
```

### Resource Tagging

Implement consistent tagging:

```typescript
const standardTags = {
  Environment: pulumi.getStack(),
  Project: 'MyApp',
  ManagedBy: 'Pulumi',
  CostCenter: 'Engineering',
  Owner: 'platform-team@company.com',
  Compliance: 'PCI-DSS',
};

const builder = new ResourceBuilder('app', {
  groupRoles: {
    createWithName: 'rg-app',
    tags: standardTags,
  },
});

// Tags are inherited by child resources
```

## Security Checklist

### Infrastructure Setup

- [ ] Managed identities used instead of credentials
- [ ] All secrets stored in Key Vault
- [ ] Key Vault has soft delete and purge protection enabled
- [ ] Network isolation implemented (VNet, subnets)
- [ ] NSG rules configured with least privilege
- [ ] Private endpoints used for PaaS services
- [ ] Public access disabled where not needed

### Data Protection

- [ ] Encryption at rest enabled
- [ ] Customer-managed keys used where appropriate
- [ ] HTTPS/TLS enforced (minimum TLS 1.2)
- [ ] Disk encryption enabled for VMs
- [ ] Backup and disaster recovery configured

### Access Control

- [ ] RBAC configured with least privilege
- [ ] Azure AD groups used for team access
- [ ] Role assignments scoped appropriately
- [ ] Service principals avoided (use managed identities)
- [ ] Admin access properly restricted

### Monitoring & Compliance

- [ ] Diagnostic logging enabled
- [ ] Log Analytics workspace configured
- [ ] Security alerts configured
- [ ] Microsoft Defender for Cloud enabled
- [ ] Azure Policy assignments in place
- [ ] Resource locks on critical resources
- [ ] Consistent tagging implemented

### Code Security

- [ ] No secrets in source code
- [ ] No secrets in exports
- [ ] Secrets marked with pulumi.secret()
- [ ] Random generation uses secure methods
- [ ] Input validation implemented
- [ ] Error messages don't leak sensitive data

## Common Security Mistakes

### Mistake #1: Exposing Secrets

```typescript
// ❌ Bad
export const dbPassword = password.result;
export const connectionString = storageAccount.primaryConnectionString;

// ✅ Good
// Don't export secrets at all
// If needed, export only references
export const passwordSecretId = passwordSecret.id;
```

### Mistake #2: Overly Permissive Access

```typescript
// ❌ Bad
new RoleAssignment('broad-access', {
  principalId: identity.principalId,
  roleName: 'Owner', // Way too broad
  scope: subscriptionId,
});

// ✅ Good
new RoleAssignment('specific-access', {
  principalId: identity.principalId,
  roleName: 'Storage Blob Data Reader',
  scope: storageAccount.id,
});
```

### Mistake #3: Unencrypted Data

```typescript
// ❌ Bad
const storage = new StorageAccount('storage', {
  group: resourceGroup,
  // No encryption configuration
});

// ✅ Good
const storage = new StorageAccount('storage', {
  group: resourceGroup,
  supportsHttpsTrafficOnly: true,
  minimumTlsVersion: 'TLS1_2',
  encryption: {
    requireInfrastructureEncryption: true,
  },
});
```

### Mistake #4: No Network Security

```typescript
// ❌ Bad
const storage = new StorageAccount('storage', {
  group: resourceGroup,
  // Public access allowed by default
});

// ✅ Good
const storage = new StorageAccount('storage', {
  group: resourceGroup,
  networkRules: {
    defaultAction: 'Deny',
    bypass: 'AzureServices',
    virtualNetworkRules: [{ id: subnet.id }],
  },
});
```

## Additional Resources

- Azure Security Baseline: https://docs.microsoft.com/azure/security/
- Azure Security Best Practices: https://docs.microsoft.com/azure/security/fundamentals/
- CIS Azure Foundations Benchmark
- Microsoft Defender for Cloud recommendations
- Azure Policy samples
