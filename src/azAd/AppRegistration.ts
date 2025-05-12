import * as azAd from '@pulumi/azuread';
import * as pulumi from '@pulumi/pulumi';
import { getComponentResourceType } from '../base/helpers';
import { WithMemberOfArgs, WithVaultInfo } from '../types';
import { VaultSecret } from '../vault';
import { RoleAssignment, RoleAssignmentArgs } from './RoleAssignment';
import { BaseComponent } from '../base/BaseComponent';

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
    > {
  info?: Pick<
    azAd.ApplicationArgs,
    'description' | 'displayName' | 'logoImage' | 'marketingUrl' | 'notes' | 'privacyStatementUrl'
  >;
  groupMembershipClaims?: pulumi.Input<GroupMembershipClaimsTypes[]>;
  identifierUris?: pulumi.Input<pulumi.Input<string>[]>;
  enableClientSecret?: pulumi.Input<boolean>;
  servicePrincipal?: Pick<
    azAd.ServicePrincipalArgs,
    'notificationEmailAddresses' | 'preferredSingleSignOnMode' | 'samlSingleSignOn' | 'appRoleAssignmentRequired'
  > & {
    enabled: boolean;
  };
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

  //private readonly _app: azAd.Application;

  constructor(name: string, args: AppRegistrationArgs = { appType: 'native' }, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('AppRegistration'), name, args, opts);
    const ops = args.info ?? {
      displayName: name,
      description: name,
    };
    //Application
    const app = new azAd.Application(
      name,
      {
        ...ops,
        preventDuplicateNames: true,
        signInAudience: 'AzureADMyOrg',

        featureTags: args.featureTags,
        oauth2PostResponseRequired: args.oauth2PostResponseRequired,
        identifierUris: args.identifierUris,

        requiredResourceAccesses: args.requiredResourceAccesses,
        optionalClaims: args.optionalClaims,
        groupMembershipClaims: args.groupMembershipClaims,

        appRoles: args.appRoles,
        //Expose the API
        api: args.api,
        owners: args.owners,

        //Clients Apps
        web:
          args.appType == 'web'
            ? {
                redirectUris: args.redirectUris,
                logoutUrl: args.logoutUrl,
                implicitGrant: args.implicitGrant,
                homepageUrl: args.homepageUrl,
              }
            : undefined,
        singlePageApplication:
          args.appType == 'singlePageApplication' ? { redirectUris: args.redirectUris } : undefined,
      },
      { ...opts, parent: this },
    );

    this.addSecret('client-id', app.clientId);

    if (args.enableClientSecret) {
      const secret = this.createClientSecret(app);
      this.clientSecret = secret.clientSecret;
    }
    if (args.servicePrincipal?.enabled) {
      const sp = this.createServicePrincipal(app);
      this.servicePrincipalId = sp.servicePrincipalId;
      this.servicePrincipalPassword = sp.servicePrincipalPassword;
    }

    this.addMemberOf(app);

    this.clientId = app.clientId;
    this.registerOutputs(this.getOutputs());
  }

  public getOutputs(): pulumi.Inputs | pulumi.Output<pulumi.Inputs> {
    return {
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      servicePrincipalId: this.servicePrincipalId,
      servicePrincipalPassword: this.servicePrincipalPassword,
    };
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
      { dependsOn: app, parent: this },
    );

    var spPass = new azAd.ServicePrincipalPassword(
      `${this.name}-sp-pass`,
      {
        displayName: this.name,
        servicePrincipalId: pulumi.interpolate`/servicePrincipals/${sp.objectId}`,
      },
      { dependsOn: sp, parent: this },
    );

    this.addRoleAssignments(sp);
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
          { dependsOn: sv, parent: this },
        ),
    );
  }

  private addMemberOf(app: azAd.Application) {
    if (!this.args.memberof) return;
    this.args.memberof.map((group) =>
      pulumi.output(group).apply(
        (id) =>
          new azAd.GroupMember(
            `${this.name}-${id.objectId}`,
            {
              groupObjectId: id.objectId,
              memberObjectId: app.objectId,
            },
            { dependsOn: app, parent: this },
          ),
      ),
    );
  }

  private addSecret(name: string, value: pulumi.Output<string>) {
    if (!this.args.vaultInfo) return;
    new VaultSecret(
      `${this.name}-${name}`,
      {
        vaultInfo: this.args.vaultInfo,
        value: value,
        contentType: `${this.name} ${name}`,
      },
      { dependsOn: this.opts?.dependsOn, parent: this },
    );
  }
}
