import KeyVaultBase from '@drunk-pulumi/azure-providers/AzBase/KeyVaultBase';
import * as storage from '@pulumi/azure-native/storage';
import * as pulumi from '@pulumi/pulumi';
import * as types from '../types';
import { vaultHelpers } from '../vault';

export const getStorageEndpoints = (storage: types.ResourceType) => ({
  ...storage,
  blob: `https://${storage.resourceName}.blob.core.windows.net`,
  file: `https://${storage.resourceName}.file.core.windows.net`,
  queue: `https://${storage.resourceName}.queue.core.windows.net`,
  table: `https://${storage.resourceName}.table.core.windows.net`,
  lake: `https://${storage.resourceName}.dfs.core.windows.net`,
  web: `https://${storage.resourceName}.z23.web.core.windows.net`,
});

export const getStorageEndpointsOutputs = (storage: types.ResourceInputs) => ({
  ...storage,
  blob: pulumi.interpolate`https://${storage.resourceName}.blob.core.windows.net`,
  file: pulumi.interpolate`https://${storage.resourceName}.file.core.windows.net`,
  queue: pulumi.interpolate`https://${storage.resourceName}.queue.core.windows.net`,
  table: pulumi.interpolate`https://${storage.resourceName}.table.core.windows.net`,
  lake: pulumi.interpolate`https://${storage.resourceName}.dfs.core.windows.net`,
  web: pulumi.interpolate`https://${storage.resourceName}.z23.web.core.windows.net`,
});

/** Get storage access key. If vault is provided it will get the secrets from the vault if not it will get from storage directly. */
export const getStorageAccessKeyOutputs = (stg: types.ResourceWithGroupInputs, vaultInfo?: types.ResourceInputs) => {
  if (vaultInfo) {
    try {
      return pulumi.output([vaultInfo.resourceName, stg.resourceName]).apply(async ([vaultName, stgName]) => {
        const vault = KeyVaultBase(vaultName);
        return (await vault.getSecret(vaultHelpers.getSecretName(`${stgName}-key1`)))?.value!;
      });
    } catch (e) {
      console.log(e);
    }
  }

  return pulumi.output(stg).apply(async (s) => {
    const keys = await storage.listStorageAccountKeys({
      resourceGroupName: s.rsGroup.resourceGroupName,
      accountName: s.resourceName,
    });
    return keys.keys[0].value!;
  });
};
