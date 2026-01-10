import * as azAd from '@pulumi/azuread';
import * as pulumi from '@pulumi/pulumi';

import { BaseComponent } from '../base/BaseComponent';
import { getComponentResourceType } from '../base/helpers';
import { stackInfo } from '../helpers';

export interface AzRoleArgs extends Partial<Pick<azAd.GroupArgs, 'members' | 'owners' | 'preventDuplicateNames'>> {}

export class AzRole extends BaseComponent<AzRoleArgs> {
  public readonly objectId: pulumi.Output<string>;
  public readonly displayName: pulumi.Output<string>;

  constructor(name: string, args: AzRoleArgs = {}, opts?: pulumi.ComponentResourceOptions) {
    const n = `rol-${name.toLowerCase().replace(/\s+/g, '-')}`;
    super(getComponentResourceType('AzRole'), n, args, opts);

    const roleName = name.includes(stackInfo.stack)
      ? `ROL ${name}`.toUpperCase()
      : `ROL ${stackInfo.stack} ${name}`.toUpperCase();

    const role = new azAd.Group(
      n,
      {
        displayName: roleName,
        description: roleName,
        members: args.members,
        owners: args.owners,

        securityEnabled: true,
        mailEnabled: false,
        preventDuplicateNames: args.preventDuplicateNames,
        assignableToRole: false,
      },
      { parent: this },
    );

    this.objectId = role.objectId;
    this.displayName = role.displayName;

    this.registerOutputs();
  }

  public getOutputs() {
    return {
      objectId: this.objectId,
      displayName: this.displayName,
    };
  }
}
