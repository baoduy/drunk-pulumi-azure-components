import * as azAd from '@pulumi/azuread';
import * as pulumi from '@pulumi/pulumi';
import { BaseComponent } from '../base';
import { getComponentResourceType } from '../base/helpers';
import { stackInfo } from '../helpers';
import * as types from '../types';
import { AzRole, AzRoleArgs } from './AzRole';

export interface GroupRoleArgs
  extends
    Partial<Pick<AzRoleArgs, 'owners' | 'preventDuplicateNames'>>,
    Partial<Record<types.GroupRoleTypes, Pick<AzRoleArgs, 'members'>>> {
  preventDuplicateNames?: pulumi.Input<boolean>;
}

export class GroupRole extends BaseComponent<GroupRoleArgs> {
  public readonly admin: pulumi.Output<types.GroupRoleOutput>;
  public readonly contributor: pulumi.Output<types.GroupRoleOutput>;
  public readonly readOnly: pulumi.Output<types.GroupRoleOutput>;

  constructor(name: string = stackInfo.stack, args: GroupRoleArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('GroupRole'), name, args, opts);

    const roles = ['admin', 'contributor', 'readOnly'] as const;

    const roleInstances = Object.fromEntries(
      roles.map((role) => [
        role,
        new AzRole(
          `${name} ${role}`,
          {
            owners: args.owners,
            members: args[role]?.members,
            preventDuplicateNames: args.preventDuplicateNames,
          },
          { ...this.opts, parent: this },
        ),
      ]),
    );

    this.admin = pulumi.output({
      objectId: roleInstances.admin.objectId,
      displayName: roleInstances.admin.displayName,
    });

    this.contributor = pulumi.output({
      objectId: roleInstances.contributor.objectId,
      displayName: roleInstances.contributor.displayName,
    });

    this.readOnly = pulumi.output({
      objectId: roleInstances.readOnly.objectId,
      displayName: roleInstances.readOnly.displayName,
    });

    this.configHierarchyRoles(roleInstances);

    this.registerOutputs();
  }

  public getOutputs() {
    return {
      admin: this.admin,
      contributor: this.contributor,
      readOnly: this.readOnly,
    };
  }

  private configHierarchyRoles(roles: { [k: string]: AzRole }) {
    if (this.admin && this.contributor) {
      new azAd.GroupMember(
        `${this.name}-admin2contributor`,
        {
          groupObjectId: this.contributor.objectId,
          memberObjectId: this.admin.objectId,
        },
        { dependsOn: roles['admin'], parent: this, retainOnDelete: true },
      );
    }

    if (this.contributor && this.readOnly) {
      new azAd.GroupMember(
        `${this.name}-contributor2readOnly`,
        {
          groupObjectId: this.readOnly.objectId,
          memberObjectId: this.contributor.objectId,
        },
        { dependsOn: roles['contributor'], parent: this, retainOnDelete: true },
      );
    }
  }
}
