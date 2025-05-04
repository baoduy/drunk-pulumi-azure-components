import * as pulumi from '@pulumi/pulumi';
import { ResourceGroup } from '@pulumi/azure-native/resources';

export type ResourceGroupInfo = {
  resourceGroupName: string;
  location?: string;
};

export type WithResourceGroupInfo = {
  rsGroupInfo: pulumi.Input<ResourceGroupInfo> | ResourceGroupInfo;
};

export type WithResourceGroup = {
  rsGroup?: pulumi.Input<ResourceGroupInfo> | ResourceGroupInfo | ResourceGroup;
};

export type AzureResourceInfo = {
  resourceName: string;
  rsGroupInfo: ResourceGroupInfo;
};

export type AzureResourceResult = AzureResourceInfo & {
  id: pulumi.Output<string>;
};

export type WithVaultInfo = {
  vaultInfo?: pulumi.Input<AzureResourceInfo> | AzureResourceInfo;
};
