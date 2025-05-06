import * as pulumi from '@pulumi/pulumi';
import * as azAd from '@pulumi/azuread';
import { WithVaultInfo, WithMemberOfArgs } from '../types';
import { VaultSecret } from '../vault';

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
}

export class AppRegistration extends pulumi.ComponentResource<AppRegistrationArgs> {
  public readonly clientId: pulumi.Output<string>;
  public readonly clientSecret?: pulumi.Output<string>;
  public readonly servicePrincipalId?: pulumi.Output<string>;
  public readonly servicePrincipalPassword?: pulumi.Output<string>;

  private readonly _app: azAd.Application;

  constructor(
    private name: string,
    private args: AppRegistrationArgs = { appType: 'native' },
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('drunk-pulumi:index:AppRegistration', name, args, opts);
    const ops = args.info ?? {
      displayName: name,
      description: name,
    };
    //Application
    this._app = new azAd.Application(
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

    if (args.vaultInfo) {
      new VaultSecret(
        `${this.name}-client-id`,
        {
          vaultInfo: args.vaultInfo,
          value: this._app.clientId,
          contentType: `${this.name} client-id`,
        },
        { dependsOn: this._app, parent: this },
      );
    }

    if (args.enableClientSecret) {
      const secret = this.createClientSecret();
      this.clientSecret = secret.clientSecret;
    }
    if (args.servicePrincipal?.enabled) {
      const sp = this.createServicePrincipal();
      this.servicePrincipalId = sp.servicePrincipalId;
      this.servicePrincipalPassword = sp.servicePrincipalPassword;
    }

    this.addMemberOf();

    this.clientId = this._app.clientId;
    this.registerOutputs({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      servicePrincipalId: this.servicePrincipalId,
      servicePrincipalPassword: this.servicePrincipalPassword,
    });
  }

  private createServicePrincipal() {
    //Service Principal
    const sp = new azAd.ServicePrincipal(
      `${this.name}-sp`,
      {
        ...this.args.servicePrincipal,
        description: this.name,
        clientId: this._app.clientId,
        owners: this.args.owners,
      },
      { dependsOn: this._app, parent: this },
    );

    var spPass = new azAd.ServicePrincipalPassword(
      `${this.name}-sp-pass`,
      {
        displayName: this.name,
        servicePrincipalId: pulumi.interpolate`/servicePrincipals/${sp.objectId}`,
      },
      { dependsOn: sp, parent: this },
    );

    if (this.args.vaultInfo) {
      new VaultSecret(
        `${this.name}-sp-pass`,
        {
          vaultInfo: this.args.vaultInfo,
          value: spPass.value,
          contentType: `${this.name} sp password`,
        },
        { dependsOn: spPass, parent: this },
      );
    }

    return {
      servicePrincipalId: sp.id,
      servicePrincipalPassword: spPass.value,
    };
  }

  private createClientSecret() {
    const clientSecret = new azAd.ApplicationPassword(
      `${this.name}-client-secret`,
      {
        displayName: this.name,
        applicationId: this._app.id,
      },
      { dependsOn: this._app, parent: this },
    );

    if (this.args.vaultInfo) {
      new VaultSecret(
        `${this.name}-client-secret`,
        {
          vaultInfo: this.args.vaultInfo,
          value: clientSecret.value,
          contentType: `${this.name} client-secret`,
        },
        { dependsOn: clientSecret, parent: this },
      );
    }

    return {
      clientSecret: clientSecret.value,
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
              memberObjectId: this._app.objectId,
            },
            { dependsOn: this._app, parent: this },
          ),
      ),
    );
  }
}
