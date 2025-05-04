import * as pulumi from '@pulumi/pulumi';
import * as azAd from '@pulumi/azuread';
import { stackInfo } from '../helpers';
import { BaseArgs, BaseResourceComponent } from '../base';

export interface AzRoleArgs
  extends BaseArgs,
    Pick<azAd.GroupArgs, 'owners' | 'members' | 'preventDuplicateNames'> {}

export class AzRole extends BaseResourceComponent<AzRoleArgs> {
  public readonly objectId: pulumi.Output<string>;
  public readonly displayName: pulumi.Output<string>;

  constructor(
    name: string,
    args: AzRoleArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    const n = `rol-${name.toLowerCase().replace(/\s+/g, '-')}`;
    super('AzRole', n, args, opts);

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
      { parent: this }
    );

    this.addSecrets({
      id: role.objectId,
      displayName: role.displayName,
    });

    this.objectId = role.objectId;
    this.displayName = role.displayName;

    this.registerOutputs({
      objectId: this.objectId,
      displayName: this.displayName,
    });
  }
}
