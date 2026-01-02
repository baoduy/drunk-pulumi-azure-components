import * as azure from '@pulumi/azure-native';
import { azureEnv } from '../helpers';
import * as pulumi from '@pulumi/pulumi';
import { AksOutputType } from './types';

export const aksRequiredOutboundPorts = ['1194', '9000', '123', '53', '80', '443'];

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
    ? await azure.containerservice.listManagedClusterUserCredentials({
        resourceName,
        resourceGroupName,
      })
    : await azure.containerservice.listManagedClusterAdminCredentials({
        resourceName,
        resourceGroupName,
      });

  return Buffer.from(aks.kubeconfigs[0].value, 'base64').toString('utf8');
};

export const getAksClusterOutput = ({
  resourceName,
  resourceGroupName,
}: {
  resourceName: pulumi.Input<string>;
  resourceGroupName: pulumi.Input<string>;
}): pulumi.Output<AksOutputType> => {
  const url = pulumi.interpolate`https://management.azure.com/subscriptions/${azureEnv.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.ContainerService/managedClusters/${resourceName}?api-version=2025-10-01`;
  //using fetch to get the aks cluster details
  return pulumi.output(url).apply(async (url) => {
    const token = await azure.authorization.getClientToken();
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch AKS cluster: ${response.statusText}`);
    }
    const data = await response.json();
    return data as AksOutputType;
  });
};
