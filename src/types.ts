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
  id: string;
};

export type ResourceWithGroupType = ResourceType & {
  rsGroup: ResourceGroupType;
};

export type ResourceInputs = {
  resourceName: pulumi.Input<string>;
  rsGroup: ResourceGroupInputs;
};

export type ResourceResult = {
  id: pulumi.Output<string>;
  resourceName: pulumi.Output<string>;
};

export type ResourceWithGroupResult = ResourceResult & {
  rsGroup: pulumi.Output<ResourceGroupType>;
};

export type WithVaultInfo = {
  vaultInfo?: ResourceInputs;
};

export type WithMemberOfArgs = {
  /** The Id of the EntraID group */
  memberof?: pulumi.Input<{ objectId: string }>[];
};

export type WithUserAssignedIdentity = {
  /** Default User-Assigned Managed Identity that is shared across resources
   *  to access common services like Key Vault secrets */
  defaultUAssignedId?: { id: pulumi.Input<string> };
};

export type WithEncryptionEnabler = {
  /** this only work when vaultInfo is provided.
   * for MySql and Postgres the feature 'CMK Encryption' need to be enabled on the subscription.
   */
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

export type WorkspaceType = ResourceType & { customerId: string };
export type AppInsightType = ResourceType & { instrumentationKey: string };

export type LogsType = {
  storage?: ResourceType;
  workspace?: WorkspaceType;
  readonly appInsight?: AppInsightType;
};

export type LogsInputs = {
  storage?: pulumi.Input<ResourceType>;
  workspace?: pulumi.Input<WorkspaceType>;
  readonly appInsight?: pulumi.Input<AppInsightType>;
};

export type WorkspaceResult = ResourceResult & { customerId: pulumi.Output<string> };
export type AppInsightResult = ResourceResult & { instrumentationKey: pulumi.Output<string> };

export type LogsResult = {
  storage?: ResourceResult;
  workspace?: WorkspaceResult;
  readonly appInsight?: AppInsightResult;
};

export type NetworkArgs = {
  publicNetworkAccess?: 'disabled' | 'enabled';
  bypass?: 'AzureServices' | 'None' | string;
  defaultAction?: 'Allow' | 'Deny';

  //subnet?: { id: pulumi.Input<string> };
  ipRules?: pulumi.Input<pulumi.Input<string>[]>;
  vnetRules?: pulumi.Input<pulumi.Input<{ id: string; ignoreMissingVnetServiceEndpoint?: boolean }>[]>;

  privateLink?: PrivateEndpointType;
};

export type WithNetworkArgs = {
  network?: NetworkArgs;
};
