import * as pulumi from '@pulumi/pulumi';
import * as azAd from '@pulumi/azuread';
import { WithVaultInfo } from '../types';
import { VaultSecret } from '../vault';

export enum GroupMembershipClaimsTypes {
    None = "None",
    SecurityGroup = "SecurityGroup",
    DirectoryRole = "DirectoryRole",
    ApplicationGroup = "ApplicationGroup",
    All = "All"
}

export interface AppRegistrationArgs extends WithVaultInfo, Pick<azAd.ApplicationArgs, 'identifierUris' | 'oauth2PostResponseRequired' | 'optionalClaims' | 'featureTags' | 'api' | 'appRoles' | 'owners' | 'requiredResourceAccesses'> {
    info?: Pick<azAd.ApplicationArgs, 'description' | 'displayName' | 'logoImage' | 'marketingUrl' | 'notes' | 'privacyStatementUrl'>
    groupMembershipClaims?: pulumi.Input<GroupMembershipClaimsTypes[]>;
    identifierUris?: pulumi.Input<pulumi.Input<string>[]>;
    enableClientSecret?: pulumi.Input<boolean>;
    servicePrincipal?: Pick<azAd.ServicePrincipalArgs, 'notificationEmailAddresses' | 'preferredSingleSignOnMode' | 'samlSingleSignOn' | 'appRoleAssignmentRequired'> & {
        enabled: boolean;
    };
    appType?: 'web' | 'singlePageApplication' | 'native',
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

export class AppRegistration extends pulumi.ComponentResource {
    private _app: azAd.Application;

    constructor(
        private name: string,
        private args: AppRegistrationArgs = { appType: 'native' },
        opts?: pulumi.ComponentResourceOptions
    ) {
        super("drunk-pulumi:index:PGPGenerator", name, args, opts);
        const ops = args.info ?? {
            displayName: name,
            description: name,
        };
        //Application
        this._app = new azAd.Application(name, {
            ...ops,
            preventDuplicateNames: true,
            signInAudience: "AzureADMyOrg",

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
            web: args.appType == "web" ? { redirectUris: args.redirectUris, logoutUrl: args.logoutUrl, implicitGrant: args.implicitGrant, homepageUrl: args.homepageUrl } : undefined,
            singlePageApplication: args.appType == "singlePageApplication" ? { redirectUris: args.redirectUris } : undefined,
        }, { ...opts, parent: this });

        if (args.vaultInfo) {
            new VaultSecret(`${this.name}-client-id`, {
                vaultInfo: args.vaultInfo,
                value: this._app.clientId,
                contentType: `${this.name} client-id`,
            }, { dependsOn: this._app, parent: this });
        }

        if (args.enableClientSecret) {
            this.createClientSecret();
        }
        if (args.servicePrincipal?.enabled) {
            this.createServicePrincipal();
        }
    }

    private createServicePrincipal() {
        //Service Principal
        const sp = new azAd.ServicePrincipal(`${this.name}-sp`, {
            ...this.args.servicePrincipal,
            description: this.name,
            clientId: this._app.clientId,
            owners: this.args.owners,
        }, { dependsOn: this._app, parent: this });

        var spPass = new azAd.ServicePrincipalPassword(`${this.name}-sp-pass`, {
            displayName: this.name,
            servicePrincipalId: pulumi.interpolate`/servicePrincipals/${sp.objectId}`,
        }, { dependsOn: sp, parent: this });

        if (this.args.vaultInfo) {
            new VaultSecret(`${this.name}-sp-pass`, {
                vaultInfo: this.args.vaultInfo,
                value: spPass.value,
                contentType: `${this.name} sp password`,
            }, { dependsOn: spPass, parent: this });
        }
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
            new VaultSecret(`${this.name}-client-secret`, {
                vaultInfo: this.args.vaultInfo,
                value: clientSecret.value,
                contentType: `${this.name} client-secret`,
            }, { dependsOn: clientSecret, parent: this });
        }
    }
}