# AzKubernetes.ts

**File Path:** `aks/AzKubernetes.ts`

## Purpose

Provides az kubernetes functionality and related utilities.

## SKU name

`sku.name` is optional. Left out, it resolves to `Automatic` in a prd stack and to `Base` in every other stack; a given name always wins. The tier rule is unchanged: a given `sku.tier` wins, otherwise prd and `Automatic` clusters get `Standard` and every other cluster gets `Free`.

> **Warning:** removing `sku.name` from an existing prd stack requests Automatic. Azure cannot migrate a Base cluster to Automatic, so keep `sku.name: 'Base'` on every existing prd cluster.

- **`Base`** needs `agentPoolProfiles` (an empty list is sent as is) and keeps the settings of earlier package versions.
- **`Automatic`** is created through Azure API `2026-02-01` and needs three subnets in one VNet: `network.apiServerSubnetId` (at least /28, delegated to `Microsoft.ContainerService/managedClusters`), `network.systemNodeSubnetId` (at least /26) and `network.workloadNodeSubnetId`. The cluster signs in with its own user-assigned identity, which holds `Network Contributor` on that VNet only. Workload identity, the OIDC issuer, Azure RBAC, KEDA, VPA and node auto-provisioning are on, on the `stable` and `NodeImage` upgrade channels. The preview fails, naming the input, for a node pool in `agentPoolProfiles`, a missing subnet, customer-key disk encryption (`enableEncryption`, `diskEncryptionSet`) or any setting that contradicts these.

## Dependencies

- `@pulumi/azure-native/containerservice`
- `@pulumi/azure-native/types/input`
- `@pulumi/pulumi`
- `../azAd`
- `../base`
- `../common`
- `../helpers`
- `../types`
- `../vault`
- `../vm/DiskEncryptionSet`
- `./helpers`

## Classes

### AzKubernetes

AzKubernetes class implementation.

## Interfaces

### AzKubernetesArgs

AzKubernetesArgs interface definition.

## Exports

- `AzKubernetesArgs`
- `AzKubernetes`
