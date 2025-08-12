# Documentation Index

This directory contains auto-generated documentation for all source files in the `src/` directory.

## File Structure

### Root Files

- [index.ts](./index.md) - Main module entry point that exports components and utilities.
- [ResourceBuilder.ts](./ResourceBuilder.md) - Provides resource builder functionality and related utilities.
- [types.ts](./types.md) - Provides types functionality and related utilities.

### aks/

- [AzKubernetes.ts](./aks/AzKubernetes.md) - Provides az kubernetes functionality and related utilities.
- [ContainerRegistry.ts](./aks/ContainerRegistry.md) - Provides container registry functionality and related utilities.
- [helpers.ts](./aks/helpers.md) - Provides helpers functionality and related utilities.
- [index.ts](./aks/index.md) - Main module entry point that exports components and utilities.

### app/

- [AppCert.ts](./app/AppCert.md) - Provides app cert functionality and related utilities.
- [AppConfig.ts](./app/AppConfig.md) - Provides app config functionality and related utilities.
- [AppService.ts](./app/AppService.md) - Represents different kinds of Azure App Service configurations
- [index.ts](./app/index.md) - Main module entry point that exports components and utilities.
- [IoTHub.ts](./app/IoTHub.md) - Provides io t hub functionality and related utilities.
- [LogicApp.ts](./app/LogicApp.md) - Provides logic app functionality and related utilities.
- [SignalR.ts](./app/SignalR.md) - Provides signal r functionality and related utilities.

### azAd/

- [AppRegistration.ts](./azAd/AppRegistration.md) - Provides app registration functionality and related utilities.
- [AzRole.ts](./azAd/AzRole.md) - Provides az role functionality and related utilities.
- [CustomRoles.ts](./azAd/CustomRoles.md) - Provides custom roles functionality and related utilities.
- [GroupRole.ts](./azAd/GroupRole.md) - Provides group role functionality and related utilities.
- [index.ts](./azAd/index.md) - Main module entry point that exports components and utilities.
- [RoleAssignment.ts](./azAd/RoleAssignment.md) - Provides role assignment functionality and related utilities.
- [UserAssignedIdentity.ts](./azAd/UserAssignedIdentity.md) - Provides user assigned identity functionality and related utilities.

### azAd/helpers/

- [graphBuiltIn.ts](./azAd/helpers/graphBuiltIn.md) - Provides graph built in functionality and related utilities.
- [index.ts](./azAd/helpers/index.md) - Main module entry point that exports components and utilities.
- [rolesBuiltIn.ts](./azAd/helpers/rolesBuiltIn.md) - Provides roles built in functionality and related utilities.
- [rsRoleDefinition.ts](./azAd/helpers/rsRoleDefinition.md) - Provides rs role definition functionality and related utilities.

### base/

- [BaseComponent.ts](./base/BaseComponent.md) - BaseComponent serves as an abstract foundation class for Pulumi resource components.
- [BaseResourceComponent.ts](./base/BaseResourceComponent.md) - Provides base resource component functionality and related utilities.
- [helpers.ts](./base/helpers.md) - Formats the component resource type to ensure it follows the drunk-pulumi naming convention
- [index.ts](./base/index.md) - Main module entry point that exports components and utilities.

### common/

- [index.ts](./common/index.md) - Main module entry point that exports components and utilities.
- [PGPGenerator.ts](./common/PGPGenerator.md) - Provides p g p generator functionality and related utilities.
- [RandomPassword.ts](./common/RandomPassword.md) - Provides random password functionality and related utilities.
- [RandomString.ts](./common/RandomString.md) - Provides random string functionality and related utilities.
- [ResourceLocker.ts](./common/ResourceLocker.md) - Provides resource locker functionality and related utilities.
- [RsGroup.ts](./common/RsGroup.md) - if the role definition is not provided the readonly role will be added to this group by default  */
- [SshGenerator.ts](./common/SshGenerator.md) - if vaultInfo is provided this password will be added into Key vault together with public key and private key */

### database/

- [AzSql.ts](./database/AzSql.md) - Provides az sql functionality and related utilities.
- [helpers.ts](./database/helpers.md) - Convert IP address and IP address group into range */
- [index.ts](./database/index.md) - Main module entry point that exports components and utilities.
- [MySql.ts](./database/MySql.md) - Provides my sql functionality and related utilities.
- [Postgres.ts](./database/Postgres.md) - Provides postgres functionality and related utilities.
- [Redis.ts](./database/Redis.md) - Provides redis functionality and related utilities.

### helpers/

- [autoTags.ts](./helpers/autoTags.md) - List of resource types that should be excluded from automatic tagging.
- [azureEnv.ts](./helpers/azureEnv.md) - Provides azure env functionality and related utilities.
- [configHelper.ts](./helpers/configHelper.md) - Retrieves a configuration value by name.
- [index.ts](./helpers/index.md) - Main module entry point that exports components and utilities.
- [rsHelpers.ts](./helpers/rsHelpers.md) - Removes leading and trailing dashes from a string and replaces multiple consecutive dashes with a single dash
- [stackEnv.ts](./helpers/stackEnv.md) - Indicates if Pulumi is running in dry-run mode

### helpers/Location/

- [index.ts](./helpers/Location/index.md) - Main module entry point that exports components and utilities.
- [LocationBuiltIn.ts](./helpers/Location/LocationBuiltIn.md) - Provides location built in functionality and related utilities.

### logs/

- [helpers.ts](./logs/helpers.md) - Provides helpers functionality and related utilities.
- [index.ts](./logs/index.md) - Main module entry point that exports components and utilities.
- [Logs.ts](./logs/Logs.md) - Provides logs functionality and related utilities.

### services/

- [Automation.ts](./services/Automation.md) - Provides automation functionality and related utilities.
- [AzSearch.ts](./services/AzSearch.md) - Provides az search functionality and related utilities.
- [index.ts](./services/index.md) - Main module entry point that exports components and utilities.
- [ServiceBus.ts](./services/ServiceBus.md) - Provides service bus functionality and related utilities.

### storage/

- [helpers.ts](./storage/helpers.md) - Provides helpers functionality and related utilities.
- [index.ts](./storage/index.md) - Main module entry point that exports components and utilities.
- [StorageAccount.ts](./storage/StorageAccount.md) - Provides storage account functionality and related utilities.

### vault/

- [EncryptionKey.ts](./vault/EncryptionKey.md) - Provides encryption key functionality and related utilities.
- [helpers.ts](./vault/helpers.md) - Provides helpers functionality and related utilities.
- [index.ts](./vault/index.md) - Main module entry point that exports components and utilities.
- [KeyVault.ts](./vault/KeyVault.md) - Provides key vault functionality and related utilities.
- [VaultSecret.ts](./vault/VaultSecret.md) - Provides vault secret functionality and related utilities.
- [VaultSecrets.ts](./vault/VaultSecrets.md) - Provides vault secrets functionality and related utilities.

### vm/

- [DiskEncryptionSet.ts](./vm/DiskEncryptionSet.md) - Provides disk encryption set functionality and related utilities.
- [helpers.ts](./vm/helpers.md) - Provides helpers functionality and related utilities.
- [index.ts](./vm/index.md) - Main module entry point that exports components and utilities.
- [VirtualMachine.ts](./vm/VirtualMachine.md) - The time zone ID: https://stackoverflow.com/questions/7908343/list-of-timezone-ids-for-use-with-findtimezonebyid-in-c */

### vnet/

- [AzCdn.ts](./vnet/AzCdn.md) - Provides az cdn functionality and related utilities.
- [Basion.ts](./vnet/Basion.md) - Provides basion functionality and related utilities.
- [DnsZone.ts](./vnet/DnsZone.md) - Provides dns zone functionality and related utilities.
- [Firewall.ts](./vnet/Firewall.md) - Provides firewall functionality and related utilities.
- [helpers.ts](./vnet/helpers.md) - Provides helpers functionality and related utilities.
- [index.ts](./vnet/index.md) - Main module entry point that exports components and utilities.
- [IpAddresses.ts](./vnet/IpAddresses.md) - Name of a public IP address SKU.
- [NetworkPeering.ts](./vnet/NetworkPeering.md) - Provides network peering functionality and related utilities.
- [PrivateDnsZone.ts](./vnet/PrivateDnsZone.md) - Provides private dns zone functionality and related utilities.
- [PrivateEndpoint.ts](./vnet/PrivateEndpoint.md) - Provides private endpoint functionality and related utilities.
- [RouteTable.ts](./vnet/RouteTable.md) - Provides route table functionality and related utilities.
- [VirtualNetwork.ts](./vnet/VirtualNetwork.md) - Provides virtual network functionality and related utilities.
- [VpnGateway.ts](./vnet/VpnGateway.md) - Provides vpn gateway functionality and related utilities.

### vnet/FirewallPolicies/

- [commonPolicies.ts](./vnet/FirewallPolicies/commonPolicies.md) - Provides common policies functionality and related utilities.
- [FirewallPolicyBuilder.ts](./vnet/FirewallPolicies/FirewallPolicyBuilder.md) - Provides firewall policy builder functionality and related utilities.
- [index.ts](./vnet/FirewallPolicies/index.md) - Main module entry point that exports components and utilities.

### vnet/securityRules/

- [commonRules.ts](./vnet/securityRules/commonRules.md) - Provides common rules functionality and related utilities.
- [index.ts](./vnet/securityRules/index.md) - Main module entry point that exports components and utilities.
- [SecurityRuleBuilder.ts](./vnet/securityRules/SecurityRuleBuilder.md) - Provides security rule builder functionality and related utilities.

## Statistics

- **Total Files:** 89
- **Total Classes:** 51
- **Total Functions:** 35
- **Total Interfaces:** 50
- **Total Enums:** 4
- **Total Types:** 69
