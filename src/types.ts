import * as pulumi from '@pulumi/pulumi';

import { PrivateEndpointType } from './vnet';

export type DnsRecordTypes = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'NS' | 'PTR' | 'SOA' | 'SRV' | 'TXT' | 'CAA';

export type GroupRoleTypes = 'admin' | 'contributor' | 'readOnly';

export type CommonProps =
  | 'rsGroup'
  | 'groupRoles'
  | 'vaultInfo'
  | 'resourceGroupName'
  | 'location'
  | 'resourceName'
  | 'tags';

export type AsInput<T> = {
  [K in keyof T]: T[K] extends object
    ? T[K] extends Array<any>
      ? pulumi.Input<NonNullable<T[K]>>
      : AsInput<NonNullable<T[K]>>
    : pulumi.Input<NonNullable<T[K]>>;
};

export type AsOutput<T> = {
  [K in keyof T]: T[K] extends object
    ? T[K] extends Array<any>
      ? pulumi.Output<NonNullable<T[K]>>
      : AsOutput<NonNullable<T[K]>>
    : pulumi.Output<NonNullable<T[K]>>;
};

export type WithName = {
  /** The options customize the resource name. If not provided the default name from parent will be used. */
  name?: string;
};

export type ResourceGroupType = {
  resourceGroupName: string;
  location?: string;
};

export type ResourceGroupInputs = AsInput<ResourceGroupType>;
export type ResourceGroupOutputs = AsOutput<ResourceGroupType>;

export type WithResourceGroup = {
  rsGroup: ResourceGroupType;
};

export type WithResourceGroupInputs = {
  rsGroup: ResourceGroupInputs;
};
export type WithResourceGroupOutputs = {
  rsGroup: ResourceGroupOutputs;
};

export type WithResourceIdentityFlag = { enableResourceIdentity?: boolean };

export type ResourceType = {
  resourceName: string;
  id: string;
};

export type ResourceInputs = AsInput<ResourceType>;
export type ResourceOutputs = AsOutput<ResourceType>;

export type ResourceWithGroupType = ResourceType & {
  rsGroup: ResourceGroupType;
};

export type ResourceWithGroupInputs = AsInput<ResourceWithGroupType>;
export type ResourceWithGroupOutputs = AsOutput<ResourceWithGroupType>;

export type SubResourceType = { id: string };
export type SubResourceInputs = AsInput<SubResourceType>;
export type SubResourceOutputs = AsOutput<SubResourceType>;

export type WithVaultInfo = {
  vaultInfo?: ResourceInputs;
};

export type WithDiskEncryptSet = { diskEncryptionSet?: SubResourceInputs };

export type WithMemberOfArgs = {
  /** The Id of the EntraID group */
  memberof?: pulumi.Input<{ objectId: string }>[];
};

export type IdentityType = {
  id: string;
  clientId: string;
  objectId: string;
};

export type IdentityInputs = AsInput<IdentityType>;
export type IdentityOutputs = AsOutput<IdentityType>;

export type UserAssignedIdentityType = {
  id: string;
  clientId: string;
  principalId: string;
  resourceName: string;
  resourceGroupName: string;
};

export type UserAssignedIdentityInputs = AsInput<UserAssignedIdentityType>;
export type UserAssignedIdentityOutputs = AsOutput<UserAssignedIdentityType>;

export type WithUserAssignedIdentity = {
  /** Default User-Assigned Managed Identity that is shared across resources
   *  to access common services like Key Vault secrets */
  defaultUAssignedId?: UserAssignedIdentityInputs;
};

export type AppIdentityType = {
  clientId: string;
  servicePrincipalId: string;
};

export type AppIdentityInputs = AsInput<AppIdentityType>;
export type AppIdentityOutputs = AsOutput<AppIdentityType>;
export type WithAppIdentity = {
  defaultAppIdentity?: AppIdentityInputs;
};

export type WithEncryptionEnabler = {
  /** this only work when vaultInfo is provided.
   * for MySql and Postgres the feature 'CMK Encryption' need to be enabled on the subscription.
   */
  enableEncryption?: boolean;
};

export interface GroupRoleOutput {
  objectId: string;
  displayName: string;
}

export type GroupRoleInputTypes = {
  admin: pulumi.Input<GroupRoleOutput>;
  contributor: pulumi.Input<GroupRoleOutput>;
  readOnly: pulumi.Input<GroupRoleOutput>;
};

export type GroupRoleOutputTypes = {
  admin: pulumi.Output<GroupRoleOutput>;
  contributor: pulumi.Output<GroupRoleOutput>;
  readOnly: pulumi.Output<GroupRoleOutput>;
};

// export type GroupRolesArgs = {
//   admin: pulumi.Output<GroupRoleOutput>;
//   contributor: pulumi.Output<GroupRoleOutput>;
//   readOnly: pulumi.Output<GroupRoleOutput>;
// };

export type WithGroupRolesArgs = {
  groupRoles?: GroupRoleOutputTypes;
};

export type WorkspaceType = ResourceType & { customerId: string };
export type WorkspaceInputs = AsInput<WorkspaceType>;
export type WorkspaceOutputs = AsOutput<WorkspaceType>;

export type AppInsightType = ResourceType & { instrumentationKey: string };
export type AppInsightInputs = AsInput<AppInsightType>;
export type AppInsightOutputs = AsOutput<AppInsightType>;

export type LogsType = {
  storage?: ResourceType;
  workspace?: WorkspaceType;
  readonly appInsight?: AppInsightType;
};

export type LogsInputs = {
  storage?: ResourceInputs;
  workspace?: WorkspaceInputs;
  appInsight?: AppInsightInputs;
};

export type WithLogs = {
  logs?: LogsInputs;
};

export type LogsOutputs = {
  storage?: ResourceOutputs;
  workspace?: WorkspaceOutputs;
  appInsight?: AppInsightOutputs;
};

export type NetworkArgs = {
  allowAllInbound?: boolean;
  publicNetworkAccess?: 'disabled' | 'enabled';
  bypass?: 'AzureServices' | 'None' | string;
  defaultAction?: 'Allow' | 'Deny';

  //subnet?: { id: pulumi.Input<string> };
  ipRules?: pulumi.Input<pulumi.Input<string>[]>;
  vnetRules?: Array<{ subnetId: pulumi.Input<string>; ignoreMissingVnetServiceEndpoint?: boolean }>;
  privateLink?: PrivateEndpointType;
};

export type WithNetworkArgs = {
  network?: NetworkArgs;
};

export type DbCredentialsType = {
  host: pulumi.Output<string>;
  port: string;
  username: pulumi.Input<string>;
  password: pulumi.Output<string>;
};

export type GrantIdentityRoles = {
  roleNames: string[];
  identity: pulumi.Input<{ principalId: pulumi.Input<string> } | undefined>;
  resource: ResourceInputs;
};
