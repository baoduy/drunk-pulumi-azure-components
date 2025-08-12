# BaseResourceComponent.ts

**File Path:** `base/BaseResourceComponent.ts`

## Purpose

Provides base resource component functionality and related utilities.

## Dependencies

- `@pulumi/azuread`
- `@pulumi/pulumi`
- `../common/RandomPassword`
- `../common/RandomString`
- `../common/ResourceLocker`
- `../types`
- `../vault/EncryptionKey`
- `../vault/VaultSecret`
- `../vault/VaultSecrets`
- `./BaseComponent`
- `./helpers`

## Classes

### BaseResourceComponent

BaseResourceComponent serves as a foundational abstract class for Azure resource management
with integrated Key Vault capabilities. It provides:

Key Features:
- Automated secret management with Azure Key Vault integration
- Resource group handling and organization
- Managed identity role assignments
- Resource locking capabilities
- Random string/password generation
- Encryption key management

This component is designed to be extended by specific Azure resource implementations
that require secure secret management and standardized resource organization.

## Interfaces

### BaseArgs

Base interface for resource component arguments that combines vault information
and Azure AD group role requirements.

This interface extends:
- WithVaultInfo: Provides Azure Key Vault configuration
- WithGroupRolesArgs: Defines Azure AD group role assignments

### CommonBaseArgs

Extended interface that includes resource group input parameters
alongside base vault and role requirements

## Exports

- `BaseArgs`
- `CommonBaseArgs`
- `BaseResourceComponent`
