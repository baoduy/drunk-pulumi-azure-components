import * as pulumi from '@pulumi/pulumi';
import * as types from './types';

import {
  AppRegistration,
  AppRegistrationArgs,
  GroupRole,
  GroupRoleArgs,
  RoleAssignment,
  RoleAssignmentArgs,
  UserAssignedIdentity,
  UserAssignedIdentityArgs,
} from './azAd';
import { DiskEncryptionSet, DiskEncryptionSetArgs } from './vm';
import { KeyVault, KeyVaultArgs } from './vault';
import { Logs, LogsArgs } from './logs';
import { RsGroup, RsGroupArgs } from './common';
import { Vnet, VnetArgs } from './vnet';

import { BaseComponent } from './base/BaseComponent';
import { getComponentResourceType } from './base/helpers';
import { rsHelpers } from './helpers';

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

export interface ResourceBuilderArgs extends Omit<RsGroupArgs, types.CommonProps> {
  groupRolesCreate?: { name: string } & GroupRoleArgs;
  groupRoles?: types.GroupRoleOutputTypes | GroupRole;
  vaultCreate?: Omit<KeyVaultArgs, types.CommonProps>;
  logsCreate?: Omit<LogsArgs, types.CommonProps>;
  diskEncryptionCreate?: Omit<DiskEncryptionSetArgs, types.CommonProps>;
  defaultUAssignedIdCreate?: Omit<UserAssignedIdentityArgs, types.CommonProps | 'memberof'> & {
    memberof?: types.GroupRoleTypes;
  };
  defaultAppIdentityCreate?: Omit<AppRegistrationArgs, types.CommonProps | 'memberof'> & {
    memberof?: types.GroupRoleTypes;
  };
  vnetCreate?: Omit<VnetArgs, types.CommonProps>;
}

export class ResourceBuilder extends BaseComponent<ResourceBuilderArgs> {
  public readonly rsGroup: RsGroup;
  public readonly vaultInfo?: KeyVault;
  public readonly groupRoles?: types.GroupRoleOutputTypes;
  public readonly defaultUAssignedId?: UserAssignedIdentity;
  public readonly defaultAppIdentity?: AppRegistration;
  public readonly logs?: Logs;
  private readonly diskEncryptionSet?: DiskEncryptionSet;
  private readonly vnet: Vnet | undefined;

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
      vaultInfo: this.vaultInfo?.getOutputs(),
      defaultUAssignedId: this.defaultUAssignedId?.getOutputs(),
      defaultAppIdentity: this.defaultAppIdentity?.getOutputs(),
      logs: this.logs?.getOutputs(),
      diskEncryptionSet: this.diskEncryptionSet?.getOutputs(),
      vnet: this.vnet?.getOutputs(),
    };
  }

  private createGroupRoles() {
    const { groupRoles, groupRolesCreate } = this.args;
    if (groupRoles) {
      return groupRoles instanceof GroupRole ? groupRoles.getOutputs() : groupRoles;
    }

    if (groupRolesCreate) {
      return new GroupRole(groupRolesCreate.name, groupRolesCreate, {
        dependsOn: this.opts?.dependsOn,
        parent: this,
      }).getOutputs();
    }
  }

  private createVault() {
    const { vaultCreate } = this.args;
    if (!vaultCreate) return undefined;

    return new KeyVault(
      this.name,
      { ...vaultCreate, rsGroup: this.rsGroup, groupRoles: this.groupRoles },
      {
        dependsOn: this.rsGroup,
        parent: this,
      },
    );
  }

  private createUserIdentity() {
    const { defaultUAssignedIdCreate } = this.args;
    if (!defaultUAssignedIdCreate) return undefined;

    return new UserAssignedIdentity(
      this.name,
      {
        ...defaultUAssignedIdCreate,
        memberof: this.groupRoles ? [this.groupRoles[defaultUAssignedIdCreate.memberof ?? 'readOnly']] : undefined,

        rsGroup: this.rsGroup,
        vaultInfo: this.vaultInfo,
      },
      {
        dependsOn: this.vaultInfo ? [this.rsGroup, this.vaultInfo] : this.rsGroup,
        parent: this,
      },
    );
  }

  private createAppIdentity() {
    const { defaultAppIdentityCreate } = this.args;
    if (!defaultAppIdentityCreate) return undefined;

    return new AppRegistration(
      this.name,
      {
        ...defaultAppIdentityCreate,
        memberof: this.groupRoles ? [this.groupRoles[defaultAppIdentityCreate.memberof ?? 'readOnly']] : undefined,
        vaultInfo: this.vaultInfo,
      },
      {
        dependsOn: this.vaultInfo ? [this.rsGroup, this.vaultInfo] : this.rsGroup,
        parent: this,
      },
    );
  }

  private createLogs() {
    const { logsCreate } = this.args;
    if (!logsCreate) return undefined;

    return new Logs(
      this.name,
      {
        ...logsCreate,
        rsGroup: this.rsGroup,
        vaultInfo: this.vaultInfo,
        groupRoles: this.groupRoles,
      },
      { dependsOn: this.vaultInfo ? [this.rsGroup, this.vaultInfo] : this.rsGroup, parent: this },
    );
  }

  private createDiskEncryptionSet() {
    const { diskEncryptionCreate } = this.args;
    if (!diskEncryptionCreate) return undefined;

    return new DiskEncryptionSet(
      this.name,
      {
        ...diskEncryptionCreate,
        encryptionType: diskEncryptionCreate.encryptionType ?? 'EncryptionAtRestWithPlatformAndCustomerKeys',

        rsGroup: this.rsGroup,
        defaultUAssignedId: this.defaultUAssignedId,
        vaultInfo: this.vaultInfo,
        groupRoles: this.groupRoles,
      },
      { dependsOn: this.vaultInfo ? [this.rsGroup, this.vaultInfo] : this.rsGroup, parent: this },
    );
  }

  private createVnet() {
    const { vnetCreate } = this.args;
    if (!vnetCreate) return undefined;
    return new Vnet(
      this.name,
      {
        ...vnetCreate,
        rsGroup: this.rsGroup,
        groupRoles: this.groupRoles,
        vaultInfo: this.vaultInfo,
      },
      { dependsOn: this.rsGroup, parent: this },
    );
  }

  public grant(props: Omit<RoleAssignmentArgs, 'scope'>) {
    new RoleAssignment(
      `${this.name}-${props.roleName}`,
      { ...props, scope: rsHelpers.getRsGroupIdFrom(this.rsGroup) },
      { dependsOn: this, deletedWith: this, parent: this },
    );
    return this;
  }
}
