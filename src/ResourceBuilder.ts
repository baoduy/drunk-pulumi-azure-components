import * as pulumi from '@pulumi/pulumi';
import { GroupRole, GroupRoleOutput, UserAssignedIdentity } from './azAd';
import { BaseComponent } from './base/BaseComponent';
import { getComponentResourceType } from './base/helpers';
import { RsGroup, RsGroupArgs } from './common';
import { Logs, LogsArgs } from './logs';
import * as types from './types';
import { KeyVault, KeyVaultArgs } from './vault';
import { DiskEncryptionSet } from './vm';

type GroupRoleOutputTypes = {
  admin: pulumi.Output<GroupRoleOutput>;
  contributor: pulumi.Output<GroupRoleOutput>;
  readOnly: pulumi.Output<GroupRoleOutput>;
};

type CommonProps = 'rsGroup' | 'groupRoles' | 'vaultInfo' | 'resourceGroupName';

export interface ResourceBuilderArgs extends Omit<RsGroupArgs, CommonProps> {
  groupRoles?: { createWithName?: string } | GroupRoleOutputTypes;
  vault?: Omit<KeyVaultArgs, CommonProps>;
  logs?: Omit<LogsArgs, CommonProps>;
  enableDefaultUAssignId?: boolean;
  enableDiskEncryption?: boolean;
}

export class ResourceBuilder extends BaseComponent<ResourceBuilderArgs> {
  public readonly rsGroup: types.ResourceGroupOutputs;
  public readonly vaultInfo?: types.ResourceOutputs;
  public readonly groupRoles?: GroupRoleOutputTypes;
  public readonly defaultUAssignedId?: types.UserAssignedIdentityOutputs;
  public readonly logs?: types.LogsOutputs;
  public readonly diskEncryptionSet?: types.ResourceOutputs;

  constructor(name: string, args: ResourceBuilderArgs, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('ResourceBuilder'), name, args, opts);
    const { groupRoles, vault, enableDefaultUAssignId, logs, enableDiskEncryption, ...props } = args;
    const dependsOn: pulumi.Resource[] = [];

    if (groupRoles) {
      if ('createWithName' in groupRoles) {
        const roles = new GroupRole(groupRoles.createWithName, {}, { dependsOn, parent: this });
        dependsOn.push(roles);
        this.groupRoles = roles;
      } else this.groupRoles = groupRoles as GroupRoleOutputTypes;
    }

    const group = new RsGroup(name, { ...props, groupRoles: this.groupRoles }, { dependsOn, parent: this });
    dependsOn.push(group);
    this.rsGroup = group;

    if (vault) {
      const vlk = new KeyVault(
        name,
        { ...vault, rsGroup: this.rsGroup, groupRoles: this.groupRoles },
        { dependsOn, parent: this },
      );
      dependsOn.push(vlk);
      this.vaultInfo = vlk;
    }

    if (enableDefaultUAssignId) {
      const uId = new UserAssignedIdentity(
        name,
        {
          rsGroup: this.rsGroup,
          vaultInfo: this.vaultInfo,
          memberof: this.groupRoles ? [this.groupRoles.readOnly] : undefined,
        },
        { dependsOn, parent: this },
      );
      dependsOn.push(uId);
      this.defaultUAssignedId = uId;
    }

    if (logs) {
      const rs = new Logs(
        name,
        {
          ...logs,
          rsGroup: this.rsGroup,
          vaultInfo: this.vaultInfo,
          groupRoles: this.groupRoles,
        },
        { dependsOn, parent: this },
      );
      dependsOn.push(rs);
      this.logs = rs;
    }

    if (enableDiskEncryption) {
      const disk = new DiskEncryptionSet(
        name,
        {
          rsGroup: this.rsGroup,
          encryptionType: 'EncryptionAtRestWithPlatformAndCustomerKeys',
          defaultUAssignedId: this.defaultUAssignedId,
          vaultInfo: this.vaultInfo,
          groupRoles: this.groupRoles,
        },
        { dependsOn, parent: this },
      );
      dependsOn.push(disk);
      this.diskEncryptionSet = disk;
    }
  }

  public getOutputs(): pulumi.Inputs | pulumi.Output<pulumi.Inputs> {
    return {
      groupRoles: this.groupRoles,
      rsGroup: this.rsGroup,
      vaultInfo: this.vaultInfo,
      defaultUAssignedId: this.defaultUAssignedId,
      logs: this.logs,
      diskEncryptionSet: this.diskEncryptionSet,
    };
  }
}
