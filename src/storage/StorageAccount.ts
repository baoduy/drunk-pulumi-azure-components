import * as pulumi from '@pulumi/pulumi';
import * as storage from '@pulumi/azure-native/storage';
import { EncryptionKey } from '../vault';
import { BaseArgsWithRsGroup, BaseResourceComponent } from '../base';
import { StorageEndpointTypes, PrivateEndpoint } from '../vnet';
import * as types from '../types';

export interface StorageAccountArgs
  extends BaseArgsWithRsGroup,
    types.WithEncryptionEnabler,
    types.WithUserAssignedIdentity,
    Pick<
      storage.StorageAccountArgs,
      | 'accessTier'
      | 'allowBlobPublicAccess'
      | 'isHnsEnabled'
      | 'allowSharedKeyAccess'
      | 'isSftpEnabled'
      | 'keyPolicy'
      | 'sasPolicy'
    > {
  sku?: storage.SkuName | string;
  network?: types.NetworkArgs & {
    storageEndpointTypes?: StorageEndpointTypes[];
  };
}

export class StorageAccount extends BaseResourceComponent<StorageAccountArgs> {
  public readonly rsGroup: types.ResourceGroupInputs;
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(
    name: string,
    args: StorageAccountArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super('StorageAccount', name, args, opts);
    const {
      rsGroup,
      sku,
      vaultInfo,
      UserAssignedIdentity,
      keyPolicy,
      enableEncryption,
      network,
      ...props
    } = args;

    const encryptionKey =
      enableEncryption && vaultInfo
        ? new EncryptionKey(
            name,
            { vaultInfo },
            { dependsOn: opts?.dependsOn, parent: this },
          )
        : undefined;

    const stg = new storage.StorageAccount(
      name,
      {
        ...args.rsGroup,
        ...props,

        kind: storage.Kind.StorageV2,
        sku: {
          name: args.sku ?? storage.SkuName.Standard_LRS,
        },

        enableHttpsTrafficOnly: true,
        allowCrossTenantReplication: false,
        minimumTlsVersion: 'TLS1_2',
        defaultToOAuthAuthentication: !props.allowSharedKeyAccess,

        identity: {
          type: UserAssignedIdentity
            ? storage.IdentityType.SystemAssigned_UserAssigned
            : storage.IdentityType.SystemAssigned,
          userAssignedIdentities: UserAssignedIdentity
            ? [UserAssignedIdentity.id]
            : undefined,
        },

        keyPolicy: keyPolicy ?? {
          keyExpirationPeriodInDays: 365,
        },
        encryption: encryptionKey
          ? {
              keySource: storage.KeySource.Microsoft_Keyvault,
              keyVaultProperties: encryptionKey,
              requireInfrastructureEncryption: true,
              encryptionIdentity: UserAssignedIdentity
                ? {
                    //encryptionFederatedIdentityClientId?: pulumi.Input<string>;
                    encryptionUserAssignedIdentity: UserAssignedIdentity.id,
                  }
                : undefined,

              services: {
                blob: {
                  enabled: true,
                  //keyType: storage.KeyType.Account,
                },
                file: {
                  enabled: true,
                  //keyType: storage.KeyType.Account,
                },
                queue: {
                  enabled: true,
                  //keyType: storage.KeyType.Account,
                },
                table: {
                  enabled: true,
                  //keyType: storage.KeyType.Account,
                },
              },
            }
          : //Default infra encryption
            {
              keySource: storage.KeySource.Microsoft_Storage,
              requireInfrastructureEncryption: true,
            },

        //isLocalUserEnabled: false,
        allowedCopyScope: network?.privateLink ? 'PrivateLink' : 'AAD',
        publicNetworkAccess: network?.privateLink ? 'Disabled' : 'Enabled',
        networkRuleSet: {
          bypass: args.network?.bypass ?? 'None',
          defaultAction:
            args.network?.defaultAction ?? storage.DefaultAction.Allow,

          ipRules: args.network?.ipRules
            ? pulumi.output(args.network.ipRules).apply((ips) =>
                ips.map((i) => ({
                  iPAddressOrRange: i,
                  action: storage.Action.Allow,
                })),
              )
            : undefined,

          virtualNetworkRules: args.network?.vnetRules
            ? pulumi.output(args.network.vnetRules).apply((vnetRules) =>
                vnetRules.map((v) => ({
                  virtualNetworkResourceId: v.id,
                  action: storage.Action.Allow,
                })),
              )
            : undefined,
        },
      },
      {
        ...opts,
        dependsOn: encryptionKey,
      },
    );

    this.createPrivateLink(stg);

    this.id = stg.id;
    this.resourceName = stg.name;
    this.rsGroup = args.rsGroup;

    this.registerOutputs({
      id: this.id,
      resourceName: this.resourceName,
      rsGroup: this.rsGroup,
    });
  }

  private createPrivateLink(stg: storage.StorageAccount) {
    const { network } = this.args;
    if (!network?.privateLink) return;

    const types = network.storageEndpointTypes ?? ['blob'];
    return types.map(
      (t) =>
        new PrivateEndpoint(
          `${this.name}-${t}`,
          {
            ...network.privateLink!,
            resourceInfo: stg,
            rsGroup: this.args.rsGroup,
            type: 'storage',
            storageType: t,
          },
          { dependsOn: stg, parent: this },
        ),
    );
  }
}
