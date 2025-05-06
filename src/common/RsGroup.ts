import * as pulumi from '@pulumi/pulumi';
import * as resources from '@pulumi/azure-native/resources';
import * as types from '../types';
import { BaseArgs, BaseResourceComponent } from '../base/BaseResourceComponent';
import { RsRoleDefinitionType, RoleAssignment, rsRoleDefinitions } from '../azureAd';

export interface RsGroupArgs extends BaseArgs, resources.ResourceGroupArgs {
  /** if the role definition is not provided the readonly role will be added to this group by default  */
  roleAssignments?: RsRoleDefinitionType[];
  lock?: boolean;
}

export class RsGroup extends BaseResourceComponent<RsGroupArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly location: pulumi.Output<string>;
  public readonly resourceGroupName: pulumi.Output<string>;

  constructor(name: string, args: RsGroupArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    super('RsGroup', name, args, opts);

    const group = new resources.ResourceGroup(name, args, {
      ...opts,
      parent: this,
    });

    this.location = group.location;
    this.resourceGroupName = group.name;
    this.id = group.id;

    this.createRoleAssignment();
    if (args.lock) this.lockFromDeleting(group);

    this.registerOutputs({
      location: this.location,
      resourceGroupName: this.resourceGroupName,
    });
  }

  private createRoleAssignment() {
    const { groupRoles, roleAssignments } = this.args;
    if (!roleAssignments || !groupRoles) return;

    const createRoles = (type: types.GroupRoleTypes, groupId: pulumi.Output<string>, roles: string[]) => {
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

    const roles = roleAssignments ?? [rsRoleDefinitions.rsGroup.getReadOnly()];

    roles.forEach((role) => {
      createRoles('readOnly', groupRoles.readOnly.objectId, role.readOnly);
      createRoles('admin', groupRoles.admin.objectId, role.admin);
      createRoles('contributor', groupRoles.contributor.objectId, role.contributor);
    });
  }
}
