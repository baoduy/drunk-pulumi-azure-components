import * as pulumi from '@pulumi/pulumi';
import * as azAd from '@pulumi/azuread';
import { stackInfo } from '../helpers';
import { getComponentResourceType } from '../base/helpers';
import { BaseComponent } from '../base/BaseComponent';

export interface AzRoleArgs extends Pick<azAd.GroupArgs, 'members' | 'owners' | 'preventDuplicateNames'> {}

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

    this.registerOutputs(this.getOutputs());
  }

  public getOutputs(): pulumi.Inputs | pulumi.Output<pulumi.Inputs> {
    return {
      objectId: this.objectId,
      displayName: this.displayName,
    };
  }
}
