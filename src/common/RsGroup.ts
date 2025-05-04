import * as pulumi from '@pulumi/pulumi';
import * as resources from '@pulumi/azure-native/resources';
import { BaseComponent } from '../base';
import {
  RsRoleDefinitionType,
  RoleAssignment,
  rsRoleDefinitions,
  GroupRoleTypes,
} from '../azureAd';
import { ResourceLocker } from './ResourceLocker';

export interface RsGroupArgs extends resources.ResourceGroupArgs {
  roleAssignment?: {
    groupRole: {
      admin: pulumi.Output<{ objectId: string }>;
      contributor: pulumi.Output<{ objectId: string }>;
      readOnly: pulumi.Output<{ objectId: string }>;
    };
    /** if the role definition is not provided the readonly role will be added to this group by default  */
    roleDefinitions?: RsRoleDefinitionType[];
  };
  lock?: boolean;
}

export class RsGroup extends BaseComponent {
  public readonly id: pulumi.Output<string>;
  public readonly location: pulumi.Output<string>;
  public readonly resourceGroupName: pulumi.Output<string>;

  constructor(
    name: string,
    private args: RsGroupArgs = {},
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('RsGroup', name, args, opts);

    const group = new resources.ResourceGroup(name, args, {
      ...opts,
      parent: this,
    });

    this.location = group.location;
    this.resourceGroupName = group.name;
    this.id = group.id;

    this.createRoleAssignment();
    this.createLock(group);

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
      roles: string[],
    ) => {
      roles.forEach(
        (role) =>
          new RoleAssignment(
            `${this.name}-${type}-${role.toLowerCase().replace(/\s+/g, '-')}`,
            {
              principalId: groupId,
              principalType: 'Group',
              roleName: role,
              scope: this.id,
            },
            { parent: this },
          ),
      );
    };

    const roleDefinitions = roleAssignment.roleDefinitions ?? [
      rsRoleDefinitions.rsGroup.getReadOnly(),
    ];

    roleDefinitions.forEach((role) => {
      createRoles(
        GroupRoleTypes.admin,
        roleAssignment.groupRole.admin.objectId,
        role.admin,
      );
      createRoles(
        GroupRoleTypes.contributor,
        roleAssignment.groupRole.contributor.objectId,
        role.contributor,
      );
      createRoles(
        GroupRoleTypes.readOnly,
        roleAssignment.groupRole.readOnly.objectId,
        role.readOnly,
      );
    });
  }

  private createLock(resource: pulumi.CustomResource) {
    if (!this.args.lock) return;
    new ResourceLocker(
      `${this.name}-lock`,
      {
        resource,
        level: 'CanNotDelete',
      },
      { dependsOn: resource, parent: this },
    );
  }
}
