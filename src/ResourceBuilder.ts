import * as pulumi from '@pulumi/pulumi';
import { GroupRole, GroupRoleArgs, GroupRoleOutput, UserAssignedIdentity, UserAssignedIdentityArgs } from './azAd';
import { BaseComponent } from './base/BaseComponent';
import { getComponentResourceType } from './base/helpers';
import { RsGroup, RsGroupArgs } from './common';
import { Logs, LogsArgs } from './logs';
import { KeyVault, KeyVaultArgs } from './vault';
import * as types from './types';
import { DiskEncryptionSet, DiskEncryptionSetArgs } from './vm';
import { Vnet, VnetArgs } from './vnet';

type GroupRoleOutputTypes = {
  admin: pulumi.Output<GroupRoleOutput>;
  contributor: pulumi.Output<GroupRoleOutput>;
  readOnly: pulumi.Output<GroupRoleOutput>;
};

export type ResourceBuilderOutputs = {
  groupRoles?: GroupRoleOutputTypes;
  rsGroup: ReturnType<RsGroup['getOutputs']>;
  vaultInfo?: ReturnType<KeyVault['getOutputs']>;
  defaultUAssignedId?: ReturnType<UserAssignedIdentity['getOutputs']>;
  logs?: ReturnType<Logs['getOutputs']>;
  diskEncryptionSet?: ReturnType<DiskEncryptionSet['getOutputs']>;
  vnet?: ReturnType<Vnet['getOutputs']>;
};

export interface ResourceBuilderArgs extends Omit<RsGroupArgs, types.CommonProps> {
  groupRolesCreate?: { name: string } & GroupRoleArgs;
  groupRoles?: GroupRoleOutputTypes | GroupRole;
  vaultCreate?: Omit<KeyVaultArgs, types.CommonProps>;
  logsCreate?: Omit<LogsArgs, types.CommonProps>;
  diskEncryptionCreate?: Omit<DiskEncryptionSetArgs, types.CommonProps>;
  defaultUAssignedIdCreate?: Omit<UserAssignedIdentityArgs, types.CommonProps | 'memberof'> & {
    memberof?: types.GroupRoleTypes;
  };
  vnetCreate?: Omit<VnetArgs, types.CommonProps>;
}

export class ResourceBuilder extends BaseComponent<ResourceBuilderArgs> {
  public readonly rsGroup: RsGroup;
  public readonly vaultInfo?: KeyVault;
  public readonly groupRoles?: GroupRoleOutputTypes;
  public readonly defaultUAssignedId?: UserAssignedIdentity;
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
    this.logs = this.createLogs();
    this.diskEncryptionSet = this.createDiskEncryptionSet();
    this.vnet = this.createVnet();

    this.registerOutputs(this.getOutputs());
  }

  public getOutputs(): ResourceBuilderOutputs {
    return {
      groupRoles: this.groupRoles,
      rsGroup: this.rsGroup.getOutputs(),
      vaultInfo: this.vaultInfo?.getOutputs(),
      defaultUAssignedId: this.defaultUAssignedId?.getOutputs(),
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
}
