import * as pulumi from '@pulumi/pulumi';
import { GroupRole, GroupRoleArgs, GroupRoleOutput, UserAssignedIdentity } from './azAd';
import { BaseComponent } from './base/BaseComponent';
import { getComponentResourceType } from './base/helpers';
import { RsGroup, RsGroupArgs } from './common';
import { Logs, LogsArgs } from './logs';
import { KeyVault, KeyVaultArgs } from './vault';
import { DiskEncryptionSet, DiskEncryptionSetArgs } from './vm';

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
};

type CommonProps = 'rsGroup' | 'groupRoles' | 'vaultInfo' | 'resourceGroupName';

export interface ResourceBuilderArgs extends Omit<RsGroupArgs, CommonProps> {
  groupRolesCreate?: { name: string } & GroupRoleArgs;
  groupRoles?: GroupRoleOutputTypes | GroupRole;
  vaultCreate?: Omit<KeyVaultArgs, CommonProps>;
  logsCreate?: Omit<LogsArgs, CommonProps>;
  diskEncryptionCreate?: Omit<DiskEncryptionSetArgs, CommonProps>;
  defaultUAssignIdCreate?: boolean;
}

export class ResourceBuilder extends BaseComponent<ResourceBuilderArgs> {
  public readonly rsGroup: RsGroup;
  public readonly vaultInfo?: KeyVault;
  public readonly groupRoles?: GroupRoleOutputTypes;
  public readonly defaultUAssignedId?: UserAssignedIdentity;
  public readonly logs?: Logs;
  public readonly diskEncryptionSet?: DiskEncryptionSet;

  constructor(name: string, args: ResourceBuilderArgs, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('ResourceBuilder'), name, args, opts);
    const {
      groupRolesCreate,
      groupRoles,
      vaultCreate,
      defaultUAssignIdCreate,
      logsCreate,
      diskEncryptionCreate,
      ...props
    } = args;

    if (groupRoles) {
      if (groupRoles instanceof GroupRole) this.groupRoles = groupRoles.getOutputs();
      else this.groupRoles = groupRoles;
    } else if (groupRolesCreate) {
      this.groupRoles = new GroupRole(groupRolesCreate.name, groupRolesCreate, {
        dependsOn: opts?.dependsOn,
        parent: this,
      }).getOutputs();
    }

    this.rsGroup = new RsGroup(
      name,
      { ...props, groupRoles: this.groupRoles },
      { dependsOn: opts?.dependsOn, parent: this },
    );

    if (vaultCreate) {
      this.vaultInfo = new KeyVault(
        name,
        { ...vaultCreate, rsGroup: this.rsGroup, groupRoles: this.groupRoles },
        { dependsOn: this.rsGroup, parent: this },
      );
    }

    if (defaultUAssignIdCreate) {
      this.defaultUAssignedId = new UserAssignedIdentity(
        name,
        {
          rsGroup: this.rsGroup,
          vaultInfo: this.vaultInfo,
          memberof: this.groupRoles ? [this.groupRoles.readOnly] : undefined,
        },
        { dependsOn: this.vaultInfo ? [this.rsGroup, this.vaultInfo] : this.rsGroup, parent: this },
      );
    }

    if (logsCreate) {
      this.logs = new Logs(
        name,
        {
          ...logsCreate,
          rsGroup: this.rsGroup,
          vaultInfo: this.vaultInfo,
          groupRoles: this.groupRoles,
        },
        { dependsOn: this.vaultInfo ? [this.rsGroup, this.vaultInfo] : this.rsGroup, parent: this },
      );
    }

    if (diskEncryptionCreate) {
      this.diskEncryptionSet = new DiskEncryptionSet(
        name,
        {
          ...diskEncryptionCreate,
          rsGroup: this.rsGroup,
          encryptionType: 'EncryptionAtRestWithPlatformAndCustomerKeys',
          defaultUAssignedId: this.defaultUAssignedId,
          vaultInfo: this.vaultInfo,
          groupRoles: this.groupRoles,
        },
        { dependsOn: this.vaultInfo ? [this.rsGroup, this.vaultInfo] : this.rsGroup, parent: this },
      );
    }
  }

  public getOutputs(): ResourceBuilderOutputs {
    return {
      groupRoles: this.groupRoles,
      rsGroup: this.rsGroup.getOutputs(),
      vaultInfo: this.vaultInfo?.getOutputs(),
      defaultUAssignedId: this.defaultUAssignedId?.getOutputs(),
      logs: this.logs?.getOutputs(),
      diskEncryptionSet: this.diskEncryptionSet?.getOutputs(),
    };
  }
}
