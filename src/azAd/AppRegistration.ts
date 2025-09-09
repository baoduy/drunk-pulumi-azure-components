import * as azAd from '@pulumi/azuread';
import * as pulumi from '@pulumi/pulumi';
import { stackInfo } from '../helpers';
import { RoleAssignment, RoleAssignmentArgs } from './RoleAssignment';
import { WithMemberOfArgs, WithVaultInfo } from '../types';

import { BaseComponent } from '../base/BaseComponent';
import { VaultSecret } from '../vault';
import { getComponentResourceType } from '../base/helpers';

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
  public readonly vaultSecrets: { [key: string]: ReturnType<VaultSecret['getOutputs']> } = {};

  constructor(name: string, args: AppRegistrationArgs = { appType: 'native' }, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('AppRegistration'), name, args, opts);

    //Application
    const app = this.createAppRegistration();
    const secret = this.createClientSecret(app);
    this.clientSecret = secret.clientSecret;

    const sp = this.createServicePrincipal(app);
    this.servicePrincipalId = sp.servicePrincipalId;
    this.servicePrincipalPassword = sp.servicePrincipalPassword;

    this.clientId = app.clientId;
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

    this.addSecret('client-id', app.clientId);
    return app;
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
    this.addSecret('sp-pass', spPass.value);

    return {
      servicePrincipalId: sp.id,
      servicePrincipalPassword: spPass.value,
    };
  }

  private createClientSecret(app: azAd.Application) {
    const clientSecret = new azAd.ApplicationPassword(
      `${this.name}-client-secret`,
      {
        displayName: this.name,
        applicationId: app.id,
      },
      { dependsOn: app, parent: this },
    );

    this.addSecret('client-secret', clientSecret.value);

    return {
      clientSecret: clientSecret.value,
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

  private addSecret(name: string, value: pulumi.Output<string>) {
    if (!this.args.vaultInfo) return;
    const n = `${this.name}-${name}`;
    const secret = new VaultSecret(
      n,
      {
        vaultInfo: this.args.vaultInfo,
        value: value,
        contentType: n,
      },
      { dependsOn: this.opts?.dependsOn, parent: this },
    );
    this.vaultSecrets[n] = secret.getOutputs();
    return secret;
  }
}
