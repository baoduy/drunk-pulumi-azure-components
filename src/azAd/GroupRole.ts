import * as azAd from '@pulumi/azuread';
import * as pulumi from '@pulumi/pulumi';
import { getComponentResourceType } from '../base/helpers';
import { stackInfo } from '../helpers';
import * as types from '../types';
import { AzRole, AzRoleArgs } from './AzRole';

export interface GroupRoleArgs
  extends Pick<AzRoleArgs, 'owners' | 'preventDuplicateNames'>,
    Partial<Record<types.GroupRoleTypes, Pick<AzRoleArgs, 'members'>>> {
  preventDuplicateNames?: pulumi.Input<boolean>;
}

export interface GroupRoleOutput {
  objectId: string;
  displayName: string;
}

export class GroupRole extends pulumi.ComponentResource<GroupRoleArgs> {
  public readonly admin: pulumi.Output<GroupRoleOutput>;
  public readonly contributor: pulumi.Output<GroupRoleOutput>;
  public readonly readOnly: pulumi.Output<GroupRoleOutput>;

  constructor(
    private readonly name: string = stackInfo.stack,
    args: GroupRoleArgs = {},
    opts?: pulumi.ComponentResourceOptions,
  ) {
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
          { parent: this },
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

    this.registerOutputs({
      admin: this.admin,
      contributor: this.contributor,
      readOnly: this.readOnly,
    });
  }

  private configHierarchyRoles(roles: { [k: string]: AzRole }) {
    if (this.admin && this.contributor) {
      new azAd.GroupMember(
        `${this.name}-admin2contributor`,
        {
          groupObjectId: this.contributor.objectId,
          memberObjectId: this.admin.objectId,
        },
        { dependsOn: Object.values(roles), parent: this },
      );
    }

    if (this.contributor && this.readOnly) {
      new azAd.GroupMember(
        `${this.name}-contributor2readOnly`,
        {
          groupObjectId: this.readOnly.objectId,
          memberObjectId: this.contributor.objectId,
        },
        { dependsOn: Object.values(roles), parent: this },
      );
    }
  }

  /**
   * Selectively picks properties from the component instance
   * @param keys - Array of property keys to pick from the component
   * @returns Object containing only the selected properties
   */
  public PickOutputs<K extends keyof this>(...keys: K[]) {
    return keys.reduce((acc, key) => {
      acc[key] = (this as any)[key];
      return acc;
    }, {} as Pick<this, K>);
  }
}
