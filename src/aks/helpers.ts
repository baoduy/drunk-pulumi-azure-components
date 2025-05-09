import * as ccs from '@pulumi/azure-native/containerservice';

export const getAksConfig = async ({
  resourceName,
  resourceGroupName,
  disableLocalAccounts,
}: {
  resourceName: string;
  resourceGroupName: string;
  disableLocalAccounts?: boolean;
}): Promise<string> => {
  const aks = disableLocalAccounts
    ? await ccs.listManagedClusterUserCredentials({
        resourceName,
        resourceGroupName,
      })
    : await ccs.listManagedClusterAdminCredentials({
        resourceName,
        resourceGroupName,
      });

  return Buffer.from(aks.kubeconfigs[0].value, 'base64').toString('utf8');
};
