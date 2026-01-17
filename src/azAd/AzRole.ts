import * as azAd from '@pulumi/azuread';
import * as pulumi from '@pulumi/pulumi';

import { BaseComponent } from '../base/BaseComponent';
import { getComponentResourceType } from '../base/helpers';
import { stackInfo } from '../helpers';

export interface AzRoleArgs extends Partial<Pick<azAd.GroupArgs, 'owners' | 'preventDuplicateNames' | 'description'>> {
  members?: pulumi.Input<string>[];
}

export class AzRole extends BaseComponent<AzRoleArgs> {
  public readonly group: azAd.Group;

  constructor(name: string, args: AzRoleArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    const rsName = `rol-${name.toLowerCase().replace(/\s+/g, '-')}`;
    super(getComponentResourceType('AzRole'), rsName, args, opts);

    this.group = this.createGroup(rsName);
    this.createMembers(this.group);

    this.registerOutputs();
  }

  public getOutputs() {
    return {
      objectId: this.group.objectId,
      displayName: this.group.displayName,
    };
  }

  private createGroup(rsName: string) {
    const { description, owners, preventDuplicateNames } = this.args;

    const roleName = this.name.includes(stackInfo.stack)
      ? `ROL ${this.name}`.toUpperCase()
      : `ROL ${stackInfo.stack} ${this.name}`.toUpperCase();

    return new azAd.Group(
      rsName,
      {
        displayName: roleName,
        description: description ?? roleName,
        //members: args.members,
        owners: owners,
        preventDuplicateNames,
        securityEnabled: true,
        mailEnabled: false,
        assignableToRole: false,
      },
      { parent: this, ignoreChanges: ['members'] },
    );
  }

  private createMembers(group: azAd.Group) {
    const { members } = this.args;
    if (!members || members.length === 0) return;

    pulumi.output(members).apply((ms) =>
      ms.map(
        (m) =>
          new azAd.GroupMember(
            `${this.name}-mb-${m}`,
            {
              memberObjectId: m,
              groupObjectId: group.objectId,
            },
            { dependsOn: group, parent: this, deletedWith: group, deleteBeforeReplace: true },
          ),
      ),
    );
  }
}
