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

    if (groupRoles) {
      if ('createWithName' in groupRoles) {
        this.groupRoles = new GroupRole(
          groupRoles.createWithName,
          {},
          { dependsOn: opts?.dependsOn, parent: this },
        ).getOutputs();
      } else this.groupRoles = groupRoles as GroupRoleOutputTypes;
    }

    const group = new RsGroup(
      name,
      { ...props, groupRoles: this.groupRoles },
      { dependsOn: opts?.dependsOn, parent: this },
    );
    this.rsGroup = group.getOutputs();

    if (vault) {
      this.vaultInfo = new KeyVault(
        name,
        { ...vault, rsGroup: this.rsGroup, groupRoles: this.groupRoles },
        { dependsOn: group, parent: this },
      ).getOutputs();
    }

    if (enableDefaultUAssignId) {
      this.defaultUAssignedId = new UserAssignedIdentity(
        name,
        {
          rsGroup: this.rsGroup,
          vaultInfo: this.vaultInfo,
          memberof: this.groupRoles ? [this.groupRoles.readOnly] : undefined,
        },
        { dependsOn: group, parent: this },
      ).getOutputs();
    }

    if (logs) {
      this.logs = new Logs(
        name,
        {
          ...logs,
          rsGroup: this.rsGroup,
          vaultInfo: this.vaultInfo,
          groupRoles: this.groupRoles,
        },
        { dependsOn: group, parent: this },
      ).getOutputs();
    }

    if (enableDiskEncryption) {
      this.diskEncryptionSet = new DiskEncryptionSet(
        name,
        {
          rsGroup: this.rsGroup,
          encryptionType: 'EncryptionAtRestWithPlatformAndCustomerKeys',
          defaultUAssignedId: this.defaultUAssignedId,
          vaultInfo: this.vaultInfo,
          groupRoles: this.groupRoles,
        },
        { dependsOn: group, parent: this },
      ).getOutputs();
    }
  }

  public getOutputs() {
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
