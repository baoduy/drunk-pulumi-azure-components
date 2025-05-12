import * as pulumi from '@pulumi/pulumi';
import { getComponentResourceType } from './base/helpers';
import * as types from './types';
import { RsGroup, RsGroupArgs } from './common';
import { GroupRole, GroupRoleOutput, UserAssignedIdentity } from './azAd';
import { KeyVault, KeyVaultArgs } from './vault';
import { Logs, LogsArgs } from './logs';
import { DiskEncryptionSet } from './vm';

type GroupRoleOutputTypes = {
  admin: pulumi.Output<GroupRoleOutput>;
  contributor: pulumi.Output<GroupRoleOutput>;
  readOnly: pulumi.Output<GroupRoleOutput>;
};

export interface ResourceBuilderArgs extends Omit<RsGroupArgs, 'groupRoles' | 'vaultInfo' | 'resourceGroupName'> {
  groupRoles?: { createWithName?: string } | GroupRoleOutputTypes;
  vault?: Omit<KeyVaultArgs, 'rsGroup'>;
  logs?: Omit<LogsArgs, 'rsGroup' | 'vaultInfo' | 'groupRoles'>;
  enableDefaultUAssignId?: boolean;
  enableDiskEncryption?: boolean;
}

export class ResourceBuilder extends pulumi.ComponentResource<ResourceBuilderArgs> {
  public readonly rsGroup: types.ResourceGroupOutputs;
  public readonly vaultInfo?: types.ResourceOutputs;
  public readonly groupRoles?: GroupRoleOutputTypes;
  public readonly defaultUAssignedId?: types.UserAssignedIdentityOutputs;
  public readonly logs?: types.LogsOutputs;
  public readonly diskEncryptionSet?: types.ResourceOutputs;

  constructor(public readonly name: string, private args: ResourceBuilderArgs, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('ResourceBuilder'), name, args, opts);

    const { groupRoles, vault, enableDefaultUAssignId, logs, enableDiskEncryption, ...props } = args;

    if (groupRoles) {
      this.groupRoles =
        'createWithName' in groupRoles
          ? new GroupRole(groupRoles.createWithName, {}, opts)
          : (groupRoles as GroupRoleOutputTypes);
    }

    this.rsGroup = new RsGroup(name, { ...props, groupRoles: this.groupRoles }, opts);

    if (vault) {
      this.vaultInfo = new KeyVault(name, { ...vault, rsGroup: this.rsGroup, groupRoles: this.groupRoles }, opts);
    }

    if (enableDefaultUAssignId) {
      this.defaultUAssignedId = new UserAssignedIdentity(
        name,
        {
          rsGroup: this.rsGroup,
          vaultInfo: this.vaultInfo,
          memberof: this.groupRoles ? [this.groupRoles.readOnly] : undefined,
        },
        opts,
      );
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
        opts,
      );
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
        opts,
      );
    }
  }
}
