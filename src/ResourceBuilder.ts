import * as pulumi from '@pulumi/pulumi';
import * as types from './types';

import {
  AppRegistration,
  AppRegistrationArgs,
  GroupRole,
  GroupRoleArgs,
  RoleAssignment,
  UserAssignedIdentity,
  UserAssignedIdentityArgs,
} from './azAd';
import { DiskEncryptionSet, DiskEncryptionSetArgs } from './vm';
import { KeyVault, KeyVaultArgs } from './vault';
import { Logs, LogsArgs } from './logs';
import { RsGroup, RsGroupArgs } from './common';
import { Vnet, VnetArgs } from './vnet';

import { BaseComponent } from './base';
import { getComponentResourceType } from './base/helpers';
import * as azAd from '@pulumi/azuread';

export type ResourceBuilderOutputs = {
  groupRoles?: types.GroupRoleOutputTypes;
  rsGroup: ReturnType<RsGroup['getOutputs']>;
  vaultInfo?: ReturnType<KeyVault['getOutputs']>;
  defaultUAssignedId?: ReturnType<UserAssignedIdentity['getOutputs']>;
  defaultAppIdentity?: ReturnType<AppRegistration['getOutputs']>;
  logs?: ReturnType<Logs['getOutputs']>;
  diskEncryptionSet?: ReturnType<DiskEncryptionSet['getOutputs']>;
  vnet?: ReturnType<Vnet['getOutputs']>;
};

/**
 * Arguments for composing a standard Azure resource group environment with optional common foundation resources.
 *
 * You always pass the base `RsGroupArgs` (minus common meta props removed via `Omit`).
 * Each optional `*Create` property triggers creation of that resource. If both an existing instance reference
 * (e.g. `groupRoles`) and a corresponding `*Create` block are provided, the existing instance takes precedence
 * and the `*Create` block is ignored.
 */
export interface ResourceBuilderArgs extends Omit<RsGroupArgs, types.CommonProps> {
  /**
   * Pre-created group role outputs or the `GroupRole` component itself to reuse instead of creating new ones.
   * When supplied, `groupRolesCreate` is ignored.
   */
  groupRoles?: types.GroupRoleInputTypes | GroupRole;

  /**
   * Definition to create a new set of Azure AD groups / roles (reader, contributor, etc.).
   * Provide when you want the builder to provision standard role groups automatically.
   */
  groupRolesCreate?: types.WithName & GroupRoleArgs;

  vaultInfo?: types.ResourceInputs;
  /**
   * Configuration to create a Key Vault in the resource group. Adds linkage with created identities and group roles.
   */
  vaultCreate?: types.WithName & Omit<KeyVaultArgs, types.CommonProps>;

  /**
   * Configuration to create a Log Analytics workspace (and related diagnostics) bound to the resource group.
   */
  logsCreate?: types.WithName & Omit<LogsArgs, types.CommonProps>;

  /**
   * Configuration for provisioning a Disk Encryption Set (defaults encryptionType if omitted).
   * Depends on Key Vault (if also created) and optionally the default user-assigned identity.
   */
  diskEncryptionCreate?: types.WithName & Omit<DiskEncryptionSetArgs, types.CommonProps>;

  /**
   * Create a default User Assigned Managed Identity. `memberof` selects which generated group role (defaults to 'readOnly').
   * If `groupRoles` / `groupRolesCreate` not provided, the identity will not have group memberships applied.
   */
  defaultUAssignedIdCreate?: types.WithName &
    Omit<UserAssignedIdentityArgs, types.CommonProps | 'memberof'> & {
      /** Which group role key to map the identity into (e.g. 'readOnly', 'contributor'). */
      memberof?: types.GroupRoleTypes;
    };

  /**
   * Create a default App Registration + Service Principal. `memberof` optionally assigns it a role group (defaults 'readOnly').
   * Vault info (if created) is passed for secret references.
   */
  defaultAppIdentityCreate?: types.WithName &
    Omit<AppRegistrationArgs, types.CommonProps | 'memberof'> & {
      /** Which group role key to map the app into. */
      memberof?: types.GroupRoleTypes;
    };

  /**
   * Configuration to create a Virtual Network with sub-resources (subnets, NSGs, etc. per `VnetArgs`).
   */
  vnetCreate?: types.WithName & Omit<VnetArgs, types.CommonProps>;
}

export class ResourceBuilder extends BaseComponent<ResourceBuilderArgs> {
  public readonly rsGroup: RsGroup;
  public readonly vaultInfo?: types.ResourceOutputs;
  public readonly groupRoles?: types.GroupRoleOutputTypes;
  public readonly defaultUAssignedId?: UserAssignedIdentity;
  public readonly defaultAppIdentity?: AppRegistration;
  public readonly logs?: Logs;
  public readonly diskEncryptionSet?: DiskEncryptionSet;
  public readonly vnet: Vnet | undefined;

  constructor(name: string, args: ResourceBuilderArgs, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('ResourceBuilder'), name, args, opts);
    const {
      groupRolesCreate,
      groupRoles,
      vaultCreate,
      defaultUAssignedIdCreate,
      logsCreate,
      diskEncryptionCreate,
      ...props
    } = args;

    this.groupRoles = this.createGroupRoles();

    this.rsGroup = new RsGroup(
      name,
      { ...props, groupRoles: this.groupRoles },
      { dependsOn: opts?.dependsOn, parent: this },
    );

    this.vaultInfo = this.createVault();
    this.defaultUAssignedId = this.createUserIdentity();
    this.defaultAppIdentity = this.createAppIdentity();
    this.logs = this.createLogs();
    this.diskEncryptionSet = this.createDiskEncryptionSet();
    this.vnet = this.createVnet();

    this.registerOutputs();
  }

  public getOutputs(): ResourceBuilderOutputs {
    return {
      groupRoles: this.groupRoles,
      rsGroup: this.rsGroup.getOutputs(),
      vaultInfo: this.vaultInfo,
      defaultUAssignedId: this.defaultUAssignedId?.getOutputs(),
      defaultAppIdentity: this.defaultAppIdentity?.getOutputs(),
      logs: this.logs?.getOutputs(),
      diskEncryptionSet: this.diskEncryptionSet?.getOutputs(),
      vnet: this.vnet?.getOutputs(),
    };
  }

  public addIdentityToRole(
    type: types.GroupRoleTypes,
    identity: pulumi.Input<{ principalId: pulumi.Input<string> } | undefined>,
  ) {
    const groupRoles = this.getOutputs().groupRoles;
    if (!groupRoles) return;

    return pulumi.output(identity).apply((i) => {
      if (!i?.principalId) return;
      return new azAd.GroupMember(
        `${this.name}-${type}-${i.principalId}`,
        {
          groupObjectId: groupRoles[type].objectId,
          memberObjectId: i.principalId,
        },
        { parent: this, retainOnDelete: true },
      );
    });
  }

  /** Assigns a role to a principal at the scope of this resource.
   * @param roleName The name of the role to assign (e.g., "Contributor", "Reader").
   * @param principalType The type of the principal (e.g., "User", "Group", "ServicePrincipal").
   * @param principalId The ID of the principal to whom the role is assigned.
   * @returns A RoleAssignment resource representing the role assignment.
   * */
  public roleAssignment({
    roleName,
    principalType,
    principalId,
  }: {
    roleName: pulumi.Input<string>;
    principalId: pulumi.Input<string>;
    principalType: types.PrincipalTypes;
  }) {
    const resourceId = this.rsGroup.id;
    return pulumi.output([roleName, principalId]).apply(
      ([role, id]) =>
        new RoleAssignment(
          `${this.name}-${role}-${id}`,
          {
            principalId: id,
            principalType,
            roleName: role,
            scope: resourceId,
          },
          { parent: this, deletedWith: this },
        ),
    );
  }

  private createGroupRoles(): types.GroupRoleOutputTypes | undefined {
    const { groupRoles, groupRolesCreate } = this.args;
    if (groupRoles) {
      return groupRoles instanceof GroupRole ? groupRoles.getOutputs() : pulumi.output(groupRoles);
    }

    if (groupRolesCreate) {
      return new GroupRole(groupRolesCreate.name ?? this.name, groupRolesCreate, {
        dependsOn: this.opts?.dependsOn,
        parent: this,
        deletedWith: this,
      }).getOutputs();
    }
  }

  private createVault(): types.ResourceOutputs | undefined {
    const { vaultInfo, vaultCreate } = this.args;
    if (vaultInfo)
      return {
        resourceName: pulumi.output(vaultInfo.resourceName),
        id: pulumi.output(vaultInfo.id),
        resourceGroupName: pulumi.output(vaultInfo.resourceGroupName),
      };

    if (!vaultCreate) return undefined;
    return new KeyVault(
      vaultCreate.name ?? this.name,
      { ...vaultCreate, rsGroup: this.rsGroup, groupRoles: this.groupRoles },
      {
        dependsOn: this.rsGroup,
        parent: this,
      },
    ).getOutputs();
  }

  private createUserIdentity() {
    const { defaultUAssignedIdCreate } = this.args;
    if (!defaultUAssignedIdCreate) return undefined;

    return new UserAssignedIdentity(
      defaultUAssignedIdCreate.name ?? this.name,
      {
        ...defaultUAssignedIdCreate,
        rsGroup: this.rsGroup,
        vaultInfo: this.vaultInfo,
        memberof: this.groupRoles ? [this.groupRoles[defaultUAssignedIdCreate.memberof ?? 'readOnly']] : undefined,
      },
      {
        dependsOn: this.rsGroup,
        parent: this,
      },
    );
  }

  private createAppIdentity() {
    const { defaultAppIdentityCreate } = this.args;
    if (!defaultAppIdentityCreate) return undefined;

    return new AppRegistration(
      defaultAppIdentityCreate.name ?? this.name,
      {
        ...defaultAppIdentityCreate,
        memberof: this.groupRoles ? [this.groupRoles[defaultAppIdentityCreate.memberof ?? 'readOnly']] : undefined,
        vaultInfo: this.vaultInfo,
      },
      {
        dependsOn: this.rsGroup,
        parent: this,
      },
    );
  }

  private createLogs() {
    const { logsCreate } = this.args;
    if (!logsCreate) return undefined;

    return new Logs(
      logsCreate.name ?? this.name,
      {
        ...logsCreate,
        rsGroup: this.rsGroup,
        vaultInfo: this.vaultInfo,
        groupRoles: this.groupRoles,
      },
      { dependsOn: this.rsGroup, parent: this },
    );
  }

  private createDiskEncryptionSet() {
    const { diskEncryptionCreate } = this.args;
    if (!diskEncryptionCreate) return undefined;

    return new DiskEncryptionSet(
      diskEncryptionCreate.name ?? this.name,
      {
        ...diskEncryptionCreate,
        encryptionType: diskEncryptionCreate.encryptionType ?? 'EncryptionAtRestWithPlatformAndCustomerKeys',

        rsGroup: this.rsGroup,
        defaultUAssignedId: this.defaultUAssignedId,
        vaultInfo: this.vaultInfo,
        groupRoles: this.groupRoles,
      },
      { dependsOn: this.rsGroup, parent: this },
    );
  }

  private createVnet() {
    const { vnetCreate } = this.args;
    if (!vnetCreate) return undefined;
    return new Vnet(
      vnetCreate.name ?? this.name,
      {
        ...vnetCreate,
        rsGroup: this.rsGroup,
        groupRoles: this.groupRoles,
        vaultInfo: this.vaultInfo,
      },
      { dependsOn: this.rsGroup, parent: this },
    );
  }
}
