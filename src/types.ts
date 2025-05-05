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

export type ResourceResult = {
  id: pulumi.Output<string>;
  resourceName: pulumi.Output<string>;
  rsGroup: pulumi.Output<ResourceGroupType>;
};

export type WithVaultInfo = {
  vaultInfo?: ResourceInputs;
};

export type WithUserAssignedIdentity = {
  /** Default User-Assigned Managed Identity that is shared across resources
   *  to access common services like Key Vault secrets */
  defaultUAssignedId?: { id: pulumi.Input<string> };
};

export type WithEncryptionEnabler = {
  /** this only work when vaultInfo is provided. */
  enableEncryption?: boolean;
};

export type GroupRolesArgs = {
  admin: pulumi.Output<{ objectId: string }>;
  contributor: pulumi.Output<{ objectId: string }>;
  readOnly: pulumi.Output<{ objectId: string }>;
};

export type WithGroupRolesArgs = {
  groupRoles?: GroupRolesArgs;
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
