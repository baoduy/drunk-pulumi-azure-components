import * as pulumi from '@pulumi/pulumi';
import { CommonBaseArgs, BaseResourceComponent } from '../base';
import * as appConfig from '@pulumi/azure-native/appconfiguration';
import * as types from '../types';
import { PrivateEndpoint } from '../vnet/PrivateEndpoint';
import * as vault from '../vault';

export interface AppConfigArgs
  extends CommonBaseArgs,
    types.WithEncryptionEnabler,
    types.WithUserAssignedIdentity,
    Pick<
      appConfig.ConfigurationStoreArgs,
      'dataPlaneProxy' | 'disableLocalAuth' | 'enablePurgeProtection' | 'softDeleteRetentionInDays'
    > {
  network?: Pick<types.NetworkArgs, 'publicNetworkAccess' | 'privateLink'>;
}

export class AppConfig extends BaseResourceComponent<AppConfigArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: AppConfigArgs, opts?: pulumi.ComponentResourceOptions) {
    super('AppConfig', name, args, opts);

    const { rsGroup, groupRoles, defaultUAssignedId, enableEncryption, vaultInfo, network, ...props } = args;
    const encryptionKey = args.enableEncryption ? this.getEncryptionKey() : undefined;
    const azConfig = new appConfig.ConfigurationStore(
      name,
      {
        ...args.rsGroup,
        ...props,
        sku: { name: 'Standard' },

        publicNetworkAccess: !network?.publicNetworkAccess
          ? appConfig.PublicNetworkAccess.Enabled
          : network.privateLink
          ? appConfig.PublicNetworkAccess.Disabled
          : appConfig.PublicNetworkAccess.Enabled,

        identity: {
          type: defaultUAssignedId
            ? appConfig.IdentityType.SystemAssigned_UserAssigned
            : appConfig.IdentityType.SystemAssigned,
          userAssignedIdentities: defaultUAssignedId ? [defaultUAssignedId.id] : undefined,
        },

        encryption:
          encryptionKey && defaultUAssignedId
            ? {
                keyVaultProperties: {
                  identityClientId: defaultUAssignedId.clientId,
                  keyIdentifier: encryptionKey.urlWithoutVersion,
                },
              }
            : undefined,
      },
      {
        ...opts,
        parent: this,
      },
    );

    this.createPrivateLink(azConfig);
    this.createSecrets(azConfig);

    this.id = azConfig.id;
    this.resourceName = azConfig.name;

    this.registerOutputs({
      id: this.id,
      resourceName: this.resourceName,
    });
  }

  private createPrivateLink(azConfig: appConfig.ConfigurationStore) {
    const { rsGroup, network } = this.args;
    if (!network?.privateLink) return;

    return new PrivateEndpoint(
      this.name,
      { ...network.privateLink, resourceInfo: azConfig, rsGroup, type: 'azConfig' },
      { dependsOn: azConfig, parent: this },
    );
  }

  private createSecrets(azConfig: appConfig.ConfigurationStore) {
    const { rsGroup, vaultInfo, disableLocalAuth } = this.args;
    if (!vaultInfo || disableLocalAuth) return;

    azConfig.id.apply(async (id) => {
      if (!id) return;
      //Load the  keys from Azure
      const keys = await appConfig.listConfigurationStoreKeysOutput({
        configStoreName: azConfig.name,
        ...rsGroup,
      });

      if (keys.value) {
        return new vault.VaultSecrets(
          this.name,
          {
            vaultInfo,
            secrets: {
              [`${this.name}-primary-conn`]: {
                value: keys.apply((v) => v.value![0]!.value),
                contentType: 'AppConfig primary connectionString',
              },
              [`${this.name}-secondary-conn`]: {
                value: keys.apply((v) => v.value![1]!.value),
                contentType: 'AppConfig secondary connectionString',
              },
            },
          },
          { dependsOn: azConfig, parent: this },
        );
      }
    });
  }
}
