import * as pulumi from '@pulumi/pulumi';
import { BaseComponent } from '../base';
import * as azAd from '@pulumi/azuread';
import { getComponentResourceType } from '../base/helpers';
import { stackInfo } from '../helpers';
import { GroupRoleOutput } from '../types';

/**
 * Arguments for GroupRoleMember component.
 */
export interface GroupRoleMemberArgs {
  /**
   * The group role output to assign the member to.
   */
  role: pulumi.Input<GroupRoleOutput>;
  /**
   * The identity object containing a principalId, or undefined.
   */
  identity: pulumi.Input<{ principalId: pulumi.Input<string> } | undefined>;
}

/**
 * Adds a member to an Azure AD group role. Creates a GroupMember if identity and role are valid.
 */
export class GroupRoleMember extends BaseComponent<GroupRoleMemberArgs> {
  /** The created GroupMember resource, if any. */
  public readonly groupMember: pulumi.Output<azAd.GroupMember | undefined>;

  constructor(name: string = stackInfo.stack, args: GroupRoleMemberArgs, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('GroupRoleMember'), name, args, opts);
    const { role, identity } = args;

    // Unwrap inputs and validate before creating the resource
    this.groupMember = pulumi.all([identity, role]).apply(([i, r]) => {
      if (!i || !i.principalId || !r || !r.objectId) return undefined;
      const groupObjectId = r.objectId;
      const memberObjectId = i.principalId;
      // Deterministic, kebab-case resource name
      const resourceName = this.getNameOrHash(
        `${this.name}-${groupObjectId}-${memberObjectId}`.replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase(),
      );
      return new azAd.GroupMember(
        resourceName,
        {
          groupObjectId,
          memberObjectId,
        },
        { parent: this, retainOnDelete: true },
      );
    });

    this.registerOutputs();
  }

  /**
   * Returns the outputs of the GroupRoleMember component.
   */
  public getOutputs() {
    return { groupMember: this.groupMember };
  }
}
