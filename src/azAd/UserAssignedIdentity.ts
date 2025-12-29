import * as azAd from '@pulumi/azuread';
import * as mid from '@pulumi/azure-native/managedidentity';
import * as pulumi from '@pulumi/pulumi';

import { BaseArgs, BaseResourceComponent } from '../base';
import { WithMemberOfArgs, WithResourceGroupInputs } from '../types';
import { azureEnv, rsHelpers } from '../helpers';

export interface UserAssignedIdentityArgs
  extends Omit<BaseArgs, 'groupRoles'>, WithMemberOfArgs, WithResourceGroupInputs {
  federations?: Record<
    string,
    Partial<Pick<mid.FederatedIdentityCredentialArgs, 'issuer'>> & Pick<mid.FederatedIdentityCredentialArgs, 'subject'>
  >;
}

export class UserAssignedIdentity extends BaseResourceComponent<UserAssignedIdentityArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly clientId: pulumi.Output<string>;
  public readonly principalId: pulumi.Output<string>;

  constructor(name: string, args: UserAssignedIdentityArgs, opts?: pulumi.ComponentResourceOptions) {
    super('UserAssignedIdentity', name, args, opts);
    const { rsGroup } = args;

    const managedIdentity = new mid.UserAssignedIdentity(name, { ...rsGroup }, { ...opts, parent: this });

    this.createFederations(managedIdentity);

    this.addSecrets({
      ['uid-id']: managedIdentity.id,
      ['uid-clientId']: managedIdentity.clientId,
      ['uid-principalId']: managedIdentity.principalId,
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

  private createFederations(managedIdentity: mid.UserAssignedIdentity) {
    const { rsGroup, federations } = this.args;
    if (!federations) return undefined;
    return rsHelpers.dictReduce(
      federations,
      (name, props) =>
        new mid.FederatedIdentityCredential(
          `${this.name}-${name}`,
          {
            ...rsGroup,
            federatedIdentityCredentialResourceName: name,
            audiences: ['api://AzureADTokenExchange'],
            issuer: props.issuer ?? pulumi.interpolate`https://login.microsoftonline.com/${azureEnv.tenantId}/v2.0`,
            subject: props.subject,
            resourceName: managedIdentity.name,
          },
          { dependsOn: managedIdentity, parent: this, deletedWith: managedIdentity },
        ),
    );
  }

  private addMemberOf() {
    if (!this.args.memberof) return;
    return this.args.memberof.map((group) =>
      pulumi.output(group).apply(
        (id) =>
          new azAd.GroupMember(
            `${this.name}-${id.objectId}`,
            {
              groupObjectId: id.objectId,
              memberObjectId: this.principalId,
            },
            { parent: this, retainOnDelete: true },
          ),
      ),
    );
  }
}
