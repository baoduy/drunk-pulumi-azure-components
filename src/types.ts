import * as pulumi from '@pulumi/pulumi';
import { PrivateEndpointType } from './vnet';

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

export type WithUserAssignedIdentity = {
  /** UserAssignedIdentity information */
  UserAssignedIdentity?: { id: pulumi.Input<string> };
};

export type WithEncryptionEnabler = {
  /** this only work when vaultInfo is provided. */
  enableEncryption?: boolean;
};

export type NetworkArgs = {
  publicNetworkAccess?: 'disabled' | 'enabled';
  bypass?: 'AzureServices' | 'None' | string;
  defaultAction?: 'Allow' | 'Deny';

  ipRules?: pulumi.Input<pulumi.Input<string>[]>;
  vnetRules?: pulumi.Input<
    pulumi.Input<{ id: string; ignoreMissingVnetServiceEndpoint?: boolean }>[]
  >;

  privateLink?: PrivateEndpointType;
};

export type WithNetworkArgs = {
  network?: NetworkArgs;
};
