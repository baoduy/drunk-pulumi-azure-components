import * as pulumi from '@pulumi/pulumi';
import * as resources from '@pulumi/azure-native/resources';
import { getComponentResourceType } from '../base';
import {
  RsRoleDefinitionType,
  RoleAssignment,
  GroupRoleTypes,
} from '../azureAd';
import { ResourceLocker } from './ResourceLocker';

export interface RsGroupArgs extends resources.ResourceGroupArgs {
  roleAssignment?: {
    azGroup: {
      admin: pulumi.Output<{ objectId: string }>;
      contributor: pulumi.Output<{ objectId: string }>;
      readOnly: pulumi.Output<{ objectId: string }>;
    };
    roleDefinitions: RsRoleDefinitionType[];
  };
  lock?: boolean;
}

export class RsGroup extends pulumi.ComponentResource {
  public readonly location: pulumi.Output<string>;
  public readonly resourceGroupName: pulumi.Output<string>;
  private _group: resources.ResourceGroup;

  constructor(
    private name: string,
    private args: RsGroupArgs = {},
    opts?: pulumi.ComponentResourceOptions
  ) {
    super(getComponentResourceType('RsGroup'), name, args, opts);

    this._group = new resources.ResourceGroup(name, args, {
      ...opts,
      parent: this,
    });

    this.createRoleAssignment();
    this.createLock();

    this.location = this._group.location;
    this.resourceGroupName = this._group.name;

    this.registerOutputs({
      location: this.location,
      resourceGroupName: this.resourceGroupName,
    });
  }

  private createRoleAssignment() {
    const { roleAssignment } = this.args;
    if (!roleAssignment) return;

    const createRoles = (
      type: GroupRoleTypes,
      groupId: pulumi.Output<string>,
      roles: string[]
    ) => {
      roles.forEach(
        (role) =>
          new RoleAssignment(
            `${this.name}-${type}-${role.toLowerCase().replace(/\s+/g, '-')}`,
            {
              principalId: groupId,
              principalType: 'Group',
              roleName: role,
              scope: this._group.id,
            },
            { dependsOn: this._group, parent: this }
          )
      );
    };

    roleAssignment.roleDefinitions.forEach((role) => {
      createRoles(
        GroupRoleTypes.admin,
        roleAssignment.azGroup.admin.objectId,
        role.admin
      );
      createRoles(
        GroupRoleTypes.contributor,
        roleAssignment.azGroup.contributor.objectId,
        role.contributor
      );
      createRoles(
        GroupRoleTypes.readOnly,
        roleAssignment.azGroup.readOnly.objectId,
        role.readOnly
      );
    });
  }

  private createLock() {
    if (!this.args.lock) return;
    new ResourceLocker(
      `${this.name}-lock`,
      {
        resource: this._group,
        level: 'CanNotDelete',
      },
      { dependsOn: this._group, parent: this }
    );
  }
}
