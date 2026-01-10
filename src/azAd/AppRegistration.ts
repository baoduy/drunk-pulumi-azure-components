import * as azAd from '@pulumi/azuread';
import * as pulumi from '@pulumi/pulumi';

import { RoleAssignment, RoleAssignmentArgs } from './RoleAssignment';
import { WithMemberOfArgs, WithVaultInfo } from '../types';

import { BaseComponent } from '../base';
import { SecretItemArgs, VaultSecrets } from '../vault';
import { getComponentResourceType } from '../base/helpers';
import { azureEnv, stackInfo } from '../helpers';

export type GroupMembershipClaimsTypes = 'None' | 'SecurityGroup' | 'DirectoryRole' | 'ApplicationGroup' | 'All';

export interface AppRegistrationArgs
  extends
    WithVaultInfo,
    WithMemberOfArgs,
    Partial<
      Pick<
        azAd.ApplicationArgs,
        | 'identifierUris'
        | 'oauth2PostResponseRequired'
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
  //groupMembershipClaims?: pulumi.Input<GroupMembershipClaimsTypes[]>;
  identifierUris?: pulumi.Input<pulumi.Input<string>[]>;
  federatedCredentials?: Array<{
    name: string;
    issuer: pulumi.Input<string>;
    subject: pulumi.Input<string>;
    audiences?: pulumi.Input<pulumi.Input<string>[]>;
  }>;
  enableClientSecret?: boolean;
  servicePrincipal?: Partial<
    Pick<azAd.ServicePrincipalArgs, 'notificationEmailAddresses' | 'preferredSingleSignOnMode' | 'samlSingleSignOn'>
  > & {
    enable: boolean;
    appRoleAssignmentRequired?: pulumi.Input<boolean>;
    assignedGroupIds?: pulumi.Input<string>[];
  };
  appType?: 'web' | 'singlePageApplication' | 'native';
  /** This is required when the appType is 'web' or 'singlePageApplication' */
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

  /** Role assignments to be created for the Service Principal */
  roleAssignments?: Array<Omit<RoleAssignmentArgs, 'roleAssignmentName' | 'principalId' | 'principalType'>>;
  /**Optional Claims*/
  optionalClaims?: {
    enableGroup: boolean;
    accessTokens?: pulumi.Input<string>[];
    idTokens?: pulumi.Input<string>[];
    saml2Tokens?: pulumi.Input<string>[];
  };
}

export class AppRegistration extends BaseComponent<AppRegistrationArgs> {
  public readonly tenantId: pulumi.Output<string>;
  public readonly clientId: pulumi.Output<string>;
  public readonly clientSecret?: pulumi.Output<string>;
  public readonly servicePrincipalId?: pulumi.Output<string>;
  public readonly servicePrincipalPassword?: pulumi.Output<string>;
  public readonly applicationId: pulumi.Output<string>;
  private vaultSecrets: ReturnType<VaultSecrets['getOutputs']> = {};

  constructor(name: string, args: AppRegistrationArgs = { appType: 'native' }, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('AppRegistration'), name, args, opts);

    //Application
    const { app, clientSecret } = this.createAppRegistration();
    const sp = this.createServicePrincipal(app);

    this.servicePrincipalId = sp?.servicePrincipalId;
    this.servicePrincipalPassword = sp?.servicePrincipalPassword;
    this.clientId = app.clientId;
    this.clientSecret = clientSecret;
    this.tenantId = azureEnv.tenantId;
    this.applicationId = app.id;

    const ss: { [key: string]: SecretItemArgs } = {
      'client-id': { value: app.clientId, contentType: `AppRegistration:${this.name}` },
    };
    if (clientSecret) {
      ss['client-secret'] = { value: clientSecret, contentType: `AppRegistration:${this.name}` };
    }
    if (sp?.servicePrincipalId) {
      ss['principal-id'] = { value: sp.servicePrincipalId, contentType: `AppRegistration:${this.name}` };
    }
    if (sp?.servicePrincipalPassword) {
      ss['principal-secret'] = { value: sp.servicePrincipalPassword, contentType: `AppRegistration:${this.name}` };
    }

    this.addSecrets(ss);
    this.registerOutputs();
  }

  public getOutputs() {
    return {
      tenantId: this.tenantId,
      clientId: this.clientId,
      servicePrincipalId: this.servicePrincipalId,
      vaultSecrets: this.vaultSecrets,
      applicationId: this.applicationId,
    };
  }

  private createOptionalClaims() {
    const { optionalClaims } = this.args;
    const results = {
      accessTokens:
        optionalClaims?.accessTokens?.map((n) => ({ additionalProperties: [], essential: false, name: n })) ?? [],
      idTokens: optionalClaims?.idTokens?.map((n) => ({ additionalProperties: [], essential: false, name: n })) ?? [],
      saml2Tokens:
        optionalClaims?.saml2Tokens?.map((n) => ({ additionalProperties: [], essential: false, name: n })) ?? [],
    };

    if (optionalClaims?.enableGroup) {
      results.accessTokens.push({
        additionalProperties: [],
        essential: false,
        name: 'groups',
      });
      results.idTokens.push({
        additionalProperties: [],
        essential: false,
        name: 'groups',
      });
      results.saml2Tokens.push({
        additionalProperties: [],
        essential: false,
        name: 'groups',
      });
    }

    return results;
  }
  private createAppRegistration() {
    const { info, enableClientSecret, federatedCredentials, optionalClaims, servicePrincipal, ...props } = this.args;

    const optionalClaimsFinal = this.createOptionalClaims();

    const app = new azAd.Application(
      `${stackInfo.stack}-${this.name}`,
      {
        ...props,
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

        groupMembershipClaims: optionalClaims?.enableGroup
          ? [servicePrincipal?.appRoleAssignmentRequired ? 'ApplicationGroup' : 'SecurityGroup']
          : undefined,
        optionalClaims: optionalClaimsFinal,
      },
      { ...this.opts, parent: this, ignoreChanges: ['tags', 'identifierUris'] },
    );

    const clientSecret = enableClientSecret
      ? new azAd.ApplicationPassword(
          `${this.name}-client-secret`,
          {
            displayName: this.name,
            applicationId: app.id,
          },
          { dependsOn: app, parent: this },
        )
      : undefined;

    if (federatedCredentials) {
      federatedCredentials.map(
        (f) =>
          new azAd.ApplicationFederatedIdentityCredential(
            `${this.name}-federated-${f.name}`,
            {
              applicationId: app.id,
              displayName: f.name,
              description: f.name,
              issuer: f.issuer,
              subject: f.subject,
              audiences: f.audiences ?? ['api://AzureADTokenExchange'],
            },
            {
              dependsOn: app,
              retainOnDelete: true,
              parent: this,
            },
          ),
      );
    }

    return { app, clientSecret: clientSecret?.value };
  }

  private createServicePrincipal(app: azAd.Application) {
    const { servicePrincipal } = this.args;
    if (!servicePrincipal?.enable) return undefined;

    //Service Principal
    const sp = new azAd.ServicePrincipal(
      `${this.name}-sp`,
      {
        ...servicePrincipal,
        description: this.name,
        clientId: app.clientId,
        owners: this.args.owners,
      },
      { dependsOn: app, deletedWith: app, parent: this },
    );

    const spPass = new azAd.ServicePrincipalPassword(
      `${this.name}-sp-pass`,
      {
        displayName: this.name,
        servicePrincipalId: pulumi.interpolate`/servicePrincipals/${sp.objectId}`,
      },
      { dependsOn: sp, deletedWith: app, parent: this },
    );

    if (servicePrincipal?.assignedGroupIds) {
      pulumi.output(servicePrincipal?.assignedGroupIds).apply((ids) =>
        ids.map(
          (id) =>
            new azAd.AppRoleAssignment(
              `${this.name}-sp-appRole-${id}`,
              {
                appRoleId: '00000000-0000-0000-0000-000000000000',
                resourceObjectId: sp.objectId,
                principalObjectId: id,
              },
              { dependsOn: sp, retainOnDelete: true, parent: this },
            ),
        ),
      );
    }

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

  private addSecrets(secrets: { [key: string]: SecretItemArgs }) {
    if (!this.args.vaultInfo) return;

    const secret = new VaultSecrets(
      this.name,
      {
        vaultInfo: this.args.vaultInfo,
        secrets,
      },
      { dependsOn: this.opts?.dependsOn, parent: this },
    );
    this.vaultSecrets = secret.getOutputs();
    return secret;
  }
}
