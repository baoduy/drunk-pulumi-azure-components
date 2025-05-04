import * as pulumi from '@pulumi/pulumi';
import * as mid from '@pulumi/azure-native/managedidentity';
import * as azAd from '@pulumi/azuread';
import { BaseArgs, BaseResourceComponent } from '../base';
import { WithResourceGroupInputs } from '../types';

export interface UserAssignedIdentityArgs
  extends BaseArgs,
    WithResourceGroupInputs {
  /** The Id of the EntraID group */
  memberof?: pulumi.Input<string>[];
}

export class UserAssignedIdentity extends BaseResourceComponent<UserAssignedIdentityArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly clientId: pulumi.Output<string>;
  public readonly principalId: pulumi.Output<string>;

  constructor(
    name: string,
    args: UserAssignedIdentityArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('UserAssignedIdentity', name, args, opts);

    const managedIdentity = new mid.UserAssignedIdentity(
      name,
      { ...args.rsGroup },
      { ...opts, parent: this }
    );

    this.addSecrets({
      id: managedIdentity.id,
      clientId: managedIdentity.clientId,
      principalId: managedIdentity.principalId,
    });

    this.id = managedIdentity.id;
    this.clientId = managedIdentity.clientId;
    this.principalId = managedIdentity.principalId;

    this.addMemberOf();

    this.registerOutputs({
      id: this.id,
      clientId: this.clientId,
      principalId: this.principalId,
    });
  }

  private addMemberOf() {
    if (!this.args.memberof) return;
    this.args.memberof.map((group) =>
      pulumi.output(group).apply(
        (id) =>
          new azAd.GroupMember(
            `${this.name}-${id}`,
            {
              groupObjectId: id,
              memberObjectId: this.principalId,
            },
            { parent: this }
          )
      )
    );
  }
}
