import * as azAd from '@pulumi/azuread';
import * as pulumi from '@pulumi/pulumi';

import { RoleAssignment, RoleAssignmentArgs } from './RoleAssignment';
import { WithMemberOfArgs, WithVaultInfo } from '../types';

import { BaseComponent } from '../base/BaseComponent';
import { VaultSecrets } from '../vault';
import { getComponentResourceType } from '../base/helpers';
import { stackInfo } from '../helpers';

export enum GroupMembershipClaimsTypes {
  None = 'None',
  SecurityGroup = 'SecurityGroup',
  DirectoryRole = 'DirectoryRole',
  ApplicationGroup = 'ApplicationGroup',
  All = 'All',
}

export interface AppRegistrationArgs
  extends WithVaultInfo,
    WithMemberOfArgs,
    Partial<
      Pick<
        azAd.ApplicationArgs,
        | 'identifierUris'
        | 'oauth2PostResponseRequired'
        | 'optionalClaims'
        | 'featureTags'
        | 'api'
        | 'appRoles'
        | 'owners'
        | 'requiredResourceAccesses'
      >
    > {
  info?: Pick<
    azAd.ApplicationArgs,
    'description' | 'displayName' | 'logoImage' | 'marketingUrl' | 'notes' | 'privacyStatementUrl'
  >;
  groupMembershipClaims?: pulumi.Input<GroupMembershipClaimsTypes[]>;
  identifierUris?: pulumi.Input<pulumi.Input<string>[]>;
  servicePrincipal?: Pick<
    azAd.ServicePrincipalArgs,
    'notificationEmailAddresses' | 'preferredSingleSignOnMode' | 'samlSingleSignOn' | 'appRoleAssignmentRequired'
  >;
  appType?: 'web' | 'singlePageApplication' | 'native';
  /** This is require when the appType is 'web' or 'singlePageApplication' */
  redirectUris?: pulumi.Input<pulumi.Input<string>[]>;
  /** This option is for the appType is 'web' */
  homepageUrl?: pulumi.Input<string>;
  /** This option is for the appType is 'web' */
  logoutUrl?: pulumi.Input<string>;
  /** This option is for the appType is 'web' */
  implicitGrant?: pulumi.Input<{
    accessTokenIssuanceEnabled?: pulumi.Input<boolean>;
    idTokenIssuanceEnabled?: pulumi.Input<boolean>;
  }>;
  roleAssignments?: Array<Omit<RoleAssignmentArgs, 'roleAssignmentName' | 'principalId' | 'principalType'>>;
}

export class AppRegistration extends BaseComponent<AppRegistrationArgs> {
  public readonly clientId: pulumi.Output<string>;
  public readonly clientSecret?: pulumi.Output<string>;
  public readonly servicePrincipalId?: pulumi.Output<string>;
  public readonly servicePrincipalPassword?: pulumi.Output<string>;
  public readonly vaultSecrets: { [key: string]: ReturnType<VaultSecrets['getOutputs']> } = {};

  constructor(name: string, args: AppRegistrationArgs = { appType: 'native' }, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('AppRegistration'), name, args, opts);

    //Application
    const { app, clientSecret } = this.createAppRegistration();
    const sp = this.createServicePrincipal(app);
    this.servicePrincipalId = sp.servicePrincipalId;
    this.servicePrincipalPassword = sp.servicePrincipalPassword;

    this.clientId = app.clientId;
    this.addSecrets({
      clientId: app.clientId,
      clientSecret: clientSecret,
      servicePrincipalId: sp.servicePrincipalId,
      servicePrincipalPass: sp.servicePrincipalPassword,
    });

    this.registerOutputs();
  }

  public getOutputs() {
    return {
      clientId: this.clientId,
      servicePrincipalId: this.servicePrincipalId,
      vaultSecrets: this.vaultSecrets,
    };
  }

  private createAppRegistration() {
    const { info } = this.args;

    const app = new azAd.Application(
      `${stackInfo.stack}-${this.name}`,
      {
        ...this.args,
        ...info,
        displayName: info?.displayName ?? `${stackInfo.stack}-${this.name}`,
        description: info?.description ?? `${stackInfo.stack}-${this.name}`,
        preventDuplicateNames: true,
        signInAudience: 'AzureADMyOrg',

        //Clients Apps
        web:
          this.args.appType == 'web'
            ? {
                redirectUris: this.args.redirectUris,
                logoutUrl: this.args.logoutUrl,
                implicitGrant: this.args.implicitGrant,
                homepageUrl: this.args.homepageUrl,
              }
            : undefined,
        singlePageApplication:
          this.args.appType == 'singlePageApplication' ? { redirectUris: this.args.redirectUris } : undefined,
      },
      { ...this.opts, parent: this },
    );

    const clientSecret = new azAd.ApplicationPassword(
      `${this.name}-client-secret`,
      {
        displayName: this.name,
        applicationId: app.id,
      },
      { dependsOn: app, parent: this },
    );

    return { app, clientSecret: clientSecret.value };
  }

  private createServicePrincipal(app: azAd.Application) {
    //Service Principal
    const sp = new azAd.ServicePrincipal(
      `${this.name}-sp`,
      {
        ...this.args.servicePrincipal,
        description: this.name,
        clientId: app.clientId,
        owners: this.args.owners,
      },
      { dependsOn: app, deletedWith: app, parent: this },
    );

    var spPass = new azAd.ServicePrincipalPassword(
      `${this.name}-sp-pass`,
      {
        displayName: this.name,
        servicePrincipalId: pulumi.interpolate`/servicePrincipals/${sp.objectId}`,
      },
      { dependsOn: sp, deletedWith: app, parent: this },
    );

    this.addRoleAssignments(sp);
    this.addMemberOf(sp);

    return {
      servicePrincipalId: sp.id,
      servicePrincipalPassword: spPass.value,
    };
  }

  private addRoleAssignments(sv: azAd.ServicePrincipal) {
    const { roleAssignments } = this.args;
    if (!roleAssignments) return;

    return roleAssignments.map(
      (role) =>
        new RoleAssignment(
          `${this.name}-${role.roleName}`,
          { ...role, principalId: sv.objectId, principalType: 'ServicePrincipal' },
          { dependsOn: sv, deletedWith: sv, parent: this },
        ),
    );
  }

  private addMemberOf(sv: azAd.ServicePrincipal) {
    if (!this.args.memberof) return;
    this.args.memberof.map((group) =>
      pulumi.output(group).apply(
        (id) =>
          new azAd.GroupMember(
            `${this.name}-${id.objectId}`,
            {
              groupObjectId: id.objectId,
              memberObjectId: sv.objectId,
            },
            { dependsOn: sv, deletedWith: sv, parent: this },
          ),
      ),
    );
  }

  private addSecrets({
    clientId,
    clientSecret,
    servicePrincipalId,
    servicePrincipalPass,
  }: {
    clientId: pulumi.Input<string>;
    clientSecret: pulumi.Input<string>;
    servicePrincipalId: pulumi.Input<string>;
    servicePrincipalPass: pulumi.Input<string>;
  }) {
    if (!this.args.vaultInfo) return;
    const n = `${this.name}-secrets`;
    const secret = new VaultSecrets(
      n,
      {
        vaultInfo: this.args.vaultInfo,
        secrets: {
          [`${this.name}-app-client-id`]: { value: clientId, contentType: `AppRegistration:${this.name} ` },
          [`${this.name}-app-client-secret`]: { value: clientSecret, contentType: `AppRegistration:${this.name} ` },
          [`${this.name}-service-principal-id`]: {
            value: servicePrincipalId,
            contentType: `AppRegistration:${this.name} `,
          },
          [`${this.name}-service-principal-pass`]: {
            value: servicePrincipalPass,
            contentType: `AppRegistration:${this.name} `,
          },
        },
      },
      { dependsOn: this.opts?.dependsOn, parent: this },
    );
    this.vaultSecrets[n] = secret.getOutputs();
    return secret;
  }
}
