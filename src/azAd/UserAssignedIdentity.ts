import * as mid from '@pulumi/azure-native/managedidentity';
import * as azAd from '@pulumi/azuread';
import * as pulumi from '@pulumi/pulumi';
import { azureEnv } from '../helpers';
import { BaseArgs, BaseResourceComponent } from '../base';
import { WithMemberOfArgs, WithResourceGroupInputs } from '../types';

export interface UserAssignedIdentityArgs
  extends Omit<BaseArgs, 'groupRoles'>,
    WithMemberOfArgs,
    WithResourceGroupInputs {
  federation?: Partial<Pick<mid.FederatedIdentityCredentialArgs, 'audiences' | 'issuer'>> &
    Pick<mid.FederatedIdentityCredentialArgs, 'subject'>;
}

export class UserAssignedIdentity extends BaseResourceComponent<UserAssignedIdentityArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly clientId: pulumi.Output<string>;
  public readonly principalId: pulumi.Output<string>;

  constructor(name: string, args: UserAssignedIdentityArgs, opts?: pulumi.ComponentResourceOptions) {
    super('UserAssignedIdentity', name, args, opts);
    const { rsGroup, federation } = args;

    const managedIdentity = new mid.UserAssignedIdentity(name, { ...rsGroup }, { ...opts, parent: this });

    if (federation) {
      new mid.FederatedIdentityCredential(
        name,
        {
          ...rsGroup,
          audiences: federation.audiences ?? ['api://AzureADTokenExchange'],
          issuer: federation.issuer ?? pulumi.interpolate`https://login.microsoftonline.com/${azureEnv.tenantId}/v2.0`,
          subject: federation.subject,
          resourceName: managedIdentity.name,
        },
        { dependsOn: managedIdentity, parent: this },
      );
    }

    this.addSecrets({
      id: managedIdentity.id,
      clientId: managedIdentity.clientId,
      principalId: managedIdentity.principalId,
    });

    this.id = managedIdentity.id;
    this.clientId = managedIdentity.clientId;
    this.principalId = managedIdentity.principalId;

    this.addMemberOf();
    this.registerOutputs();
  }

  public getOutputs() {
    return {
      id: this.id,
      clientId: this.clientId,
      principalId: this.principalId,
    };
  }

  private addMemberOf() {
    if (!this.args.memberof) return;
    this.args.memberof.map((group) =>
      pulumi.output(group).apply(
        (id) =>
          new azAd.GroupMember(
            `${this.name}-${id.objectId}`,
            {
              groupObjectId: id.objectId,
              memberObjectId: this.principalId,
            },
            { parent: this, deletedWith: this },
          ),
      ),
    );
  }
}
