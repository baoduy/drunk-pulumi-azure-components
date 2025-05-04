import * as pulumi from '@pulumi/pulumi';

export type ResourceGroupType = {
  resourceGroupName: string;
  location?: string;
};

export type ResourceGroupInputs = {
  resourceGroupName: pulumi.Input<string>;
  location?: pulumi.Input<string>;
};
export type WithResourceGroupInputs = {
  rsGroup: ResourceGroupInputs;
};

export type ResourceType = {
  resourceName: string;
  rsGroup: ResourceGroupType;
};

export type ResourceInputs = {
  resourceName: pulumi.Input<string>;
  rsGroup: ResourceGroupInputs;
};

export type AzureResourceResult = pulumi.Output<ResourceType> & {
  id: pulumi.Output<string>;
};

export type WithVaultInfo = {
  vaultInfo?: ResourceInputs;
};
