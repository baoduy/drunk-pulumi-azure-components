import * as pulumi from '@pulumi/pulumi';
import { stackInfo, azureEnv } from '../helpers';
import * as apim from '@pulumi/azure-native/apimanagement';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import * as inputs from '@pulumi/azure-native/types/input';
import * as certHelpers from '../helpers/certHelpers';
import * as types from '../types';
import { AppRegistration } from '../azAd';
import { ApimSignUpSettingsResource } from '@drunk-pulumi/azure-providers';
import { PrivateEndpoint } from '../vnet';
import { ApimProduct, ApimProductArgs } from './ApimProduct';

type ApimCertType = certHelpers.CertType | certHelpers.VaultCertType | certHelpers.CertFile;

export interface ApimArgs
  extends CommonBaseArgs,
    types.WithNetworkArgs,
    types.WithLogs,
    Omit<
      apim.ApiManagementServiceArgs,
      | 'serviceName'
      | 'resourceGroupName'
      | 'location'
      | 'sku'
      | 'additionalLocations'
      | 'certificates'
      | 'hostnameConfigurations'
      | 'publicNetworkAccess'
      | 'virtualNetworkType'
      | 'virtualNetworkConfiguration'
      | 'publisherName'
      | 'publisherEmail'
    > {
  publisherEmail?: pulumi.Input<string>;
  publisherName?: pulumi.Input<string>;
  hostnameConfigurations?: Array<{
    hostName: pulumi.Input<string>;
    negotiateClientCertificate: boolean;
    defaultSslBinding: boolean;
    cert?: ApimCertType;
  }>;
  additionalLocations?: inputs.apimanagement.AdditionalLocationArgs[] | undefined;
  certificates?: {
    caCerts?: Array<ApimCertType>;
    rootCerts?: Array<ApimCertType>;
  };
  sku: {
    capacity: pulumi.Input<number>;
    name: apim.SkuType;
  };
  disableSignIn?: boolean;
  productCreate?: Array<
    Omit<ApimProductArgs, 'rsGroup' | 'serviceName' | 'vaultInfo' | 'groupRoles'> & { name: string }
  >;
}

export class Apim extends BaseResourceComponent<ApimArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: ApimArgs, opts?: pulumi.ComponentResourceOptions) {
    super('Apim', name, args, opts);

    const apim = this.createApim();
    this.buildEntraID(apim);
    this.buildDisableSigIn(apim);
    this.buildPrivateLink(apim);
    this.buildLogs(apim);
    this.buildProducts(apim);

    this.id = apim.id;
    this.resourceName = apim.name;

    this.registerOutputs();
  }

  public getOutputs() {
    return {
      id: this.id,
      resourceName: this.resourceName,
    };
  }

  private getCerts() {
    const { vaultInfo, certificates = {} } = this.args;
    const caCerts = certificates.caCerts
      ? certificates.caCerts.map((c) => {
          const crt = certHelpers.getCertOutputs(c, vaultInfo);
          return crt.apply((c) => ({ ...c, storeName: 'CertificateAuthority' }));
        })
      : [];

    const rootCerts = certificates.rootCerts
      ? certificates.rootCerts.map((c) => {
          const crt = certHelpers.getCertOutputs(c, vaultInfo);
          return crt.apply((c) => ({ ...c, storeName: 'Root' }));
        })
      : [];

    return { ...caCerts, ...rootCerts };
  }

  private createApim() {
    const {
      groupRoles,
      rsGroup,
      sku,
      publisherName,
      publisherEmail,
      notificationSenderEmail,
      apiVersionConstraint,
      additionalLocations,
      hostnameConfigurations = [],
      zones,
      network,
      ...others
    } = this.args;
    return new apim.ApiManagementService(
      this.name,
      {
        ...rsGroup,
        ...others,
        publisherName: publisherName ?? stackInfo.organization,
        publisherEmail: publisherEmail ?? 'apimgmt-noreply@mail.windowsazure.com',
        notificationSenderEmail: notificationSenderEmail ?? 'apimgmt-noreply@mail.windowsazure.com',
        identity: { type: 'SystemAssigned' },
        sku: sku ?? { name: 'Consumption', capacity: 1 },

        apiVersionConstraint: apiVersionConstraint ?? {
          minApiVersion: '2019-12-01',
        },
        certificates: this.getCerts(),

        hostnameConfigurations: hostnameConfigurations.map((d) => {
          if (!d.cert)
            return {
              ...d,
              type: 'Proxy',
            };

          const cert = certHelpers.getCertOutputs(d.cert, this.args.vaultInfo);
          return cert.apply((c) => ({
            ...d,
            certificateSource: c.encodedCertificate,
            certificatePassword: c.certificatePassword,
            type: 'Proxy',
          }));
        }),

        //Only support when linking to a virtual network
        //publicIpAddressId: this._apimVnet ? this._ipAddressInstances[this.commonProps.name]?.id : undefined,
        //natGatewayState: this._apimVnet?.enableGateway ? 'Enabled' : 'Disabled',
        publicNetworkAccess: network?.publicNetworkAccess ? 'Enabled' : network?.privateLink ? 'Disabled' : 'Enabled',
        //NATGateway
        virtualNetworkType: 'None',
        virtualNetworkConfiguration: network?.vnetRules
          ? {
              subnetResourceId: network?.vnetRules[0].subnetId,
            }
          : undefined,

        zones,
        //Only available for Premium
        additionalLocations:
          sku.name === 'Premium'
            ? additionalLocations?.map((a) => ({
                ...a,
                sku,
                zones,
              }))
            : undefined,

        customProperties: {
          'Microsoft.WindowsAzure.ApiManagement.Gateway.Protocols.Server.Http2': 'true',
          'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Backend.Protocols.Ssl30': 'false',
          'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Backend.Protocols.Tls10': 'false',
          'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Backend.Protocols.Tls11': 'false',
          'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Ciphers.TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA': 'false',
          'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Ciphers.TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA': 'false',
          'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Ciphers.TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA': 'false',
          'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Ciphers.TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA': 'false',
          'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Ciphers.TLS_RSA_WITH_AES_128_CBC_SHA': 'false',
          'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Ciphers.TLS_RSA_WITH_AES_128_CBC_SHA256': 'false',
          'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Ciphers.TLS_RSA_WITH_AES_128_GCM_SHA256': 'false',
          'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Ciphers.TLS_RSA_WITH_AES_256_CBC_SHA': 'false',
          'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Ciphers.TLS_RSA_WITH_AES_256_CBC_SHA256': 'false',
          'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Ciphers.TripleDes168': 'false',
          'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Protocols.Ssl30': 'false',
          'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Protocols.Tls10': 'false',
          'Microsoft.WindowsAzure.ApiManagement.Gateway.Security.Protocols.Tls11': 'false',
        },
      },
      {
        dependsOn: this.opts?.dependsOn,
        deleteBeforeReplace: true,
        parent: this,
      },
    );
  }

  private buildEntraID(service: apim.ApiManagementService) {
    const { disableSignIn, rsGroup, vaultInfo } = this.args;
    if (disableSignIn) return;

    const identity = new AppRegistration(
      `${this.name}-apim`,
      {
        vaultInfo,
      },
      { dependsOn: service, deletedWith: service, parent: this },
    );

    return new apim.IdentityProvider(
      this.name,
      {
        ...rsGroup,
        serviceName: service.name,
        clientId: identity.clientId,
        clientSecret: identity.clientSecret!,
        authority: pulumi.interpolate`https://login.microsoftonline.com/${azureEnv.tenantId}/`,
        type: 'aad',
        identityProviderName: 'aad',
        allowedTenants: [azureEnv.tenantId],
        signinTenant: azureEnv.tenantId,
      },
      { dependsOn: identity, deletedWith: identity, parent: this },
    );
  }

  private buildDisableSigIn(service: apim.ApiManagementService) {
    const { disableSignIn, rsGroup } = this.args;
    if (!disableSignIn) return;

    const subscriptionId = azureEnv.subscriptionId;

    //Turn off Sign upsetting
    return new ApimSignUpSettingsResource(
      this.name,
      {
        ...rsGroup,
        serviceName: service.name,
        subscriptionId,
        enabled: false,
        termsOfService: {
          consentRequired: false,
          enabled: false,
          text: 'Terms & Conditions Of Service',
        },
      },
      { dependsOn: service, deletedWith: service, parent: this },
    );
  }

  private buildPrivateLink(service: apim.ApiManagementService) {
    const { network, rsGroup } = this.args;
    if (!network?.privateLink) return;

    return new PrivateEndpoint(
      this.name,
      {
        ...network.privateLink,
        rsGroup,
        type: 'azApi',
        resourceInfo: service,
      },
      { dependsOn: service, deletedWith: service, parent: this },
    );
  }

  private buildLogs(service: apim.ApiManagementService) {
    const { logs, rsGroup } = this.args;
    if (!logs?.appInsight) return;

    //App Insight Logs
    return new apim.Logger(
      `${this.name}-insight`,
      {
        ...rsGroup,
        serviceName: service.name,

        loggerType: apim.LoggerType.ApplicationInsights,
        description: 'App Insight Logger',
        loggerId: `${this.name}-appInsight`,
        resourceId: logs!.appInsight.id,
        credentials: {
          //This credential will be added to NameValue automatically.
          instrumentationKey: logs!.appInsight.instrumentationKey!,
        },
      },
      { dependsOn: service, deletedWith: service, parent: this },
    );
  }

  private buildProducts(service: apim.ApiManagementService) {
    const { productCreate, rsGroup, vaultInfo, groupRoles, logs } = this.args;
    if (!productCreate?.length) return;

    return productCreate.map(
      (p) =>
        new ApimProduct(
          p.name,
          {
            ...p,
            rsGroup,
            serviceName: service.name,
            vaultInfo,
            groupRoles,
            enableDiagnostic: Boolean(logs?.appInsight),
          },
          {
            dependsOn: service,
            deletedWith: service,
            parent: this,
          },
        ),
    );
  }
}
