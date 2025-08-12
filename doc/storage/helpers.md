# helpers.ts

**File Path:** `storage/helpers.ts`

## Purpose

Provides helpers functionality and related utilities.

## Dependencies

- `@drunk-pulumi/azure-providers/AzBase/KeyVaultBase`
- `@pulumi/azure-native/storage`
- `@pulumi/pulumi`
- `../types`
- `../vault`

## Functions

### getStorageEndpoints

getStorageEndpoints function implementation.

### getStorageEndpointsOutputs

getStorageEndpointsOutputs function implementation.

### getStorageAccessKeyOutputs

Get storage access key. If vault is provided it will get the secrets from the vault if not it will get from storage directly.

## Exports

- `getStorageEndpoints`
- `getStorageEndpointsOutputs`
- `getStorageAccessKeyOutputs`
