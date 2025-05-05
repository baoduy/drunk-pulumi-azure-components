import * as pulumi from '@pulumi/pulumi';
import * as inputs from '@pulumi/azure-native/types/input';
import * as storage from '@pulumi/azure-native/storage';
import * as vault from '../vault';
import { BaseArgsWithRsGroup, BaseResourceComponent } from '../base';
import * as types from '../types';
import * as vnet from '../vnet';

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
      | 'largeFileSharesState'
      | 'routingPreference'
    > {
  sku?: storage.SkuName | string;
  network?: types.NetworkArgs & {
    storageEndpointTypes?: vnet.StorageEndpointTypes[];
  };
  policies?: {
    staticWebsite?: Partial<Pick<vnet.AzCdnArgs, 'endpoint'>> & {
      enabled: boolean;
      existingProfile?: types.ResourceInputs;
    };
    keyExpirationPeriodInDays?: pulumi.Input<number>;
    /**
     * The SAS expiration period, DD.HH:MM:SS.
     */
    sasExpirationPeriod?: pulumi.Input<string>;
    sasExpirationAction?: 'Log' | 'Block';

    blob?: Omit<storage.BlobServicePropertiesArgs, 'blobServicesName' | 'resourceGroupName' | 'accountName'>;

    defaultManagementPolicyRules?: pulumi.Input<pulumi.Input<inputs.storage.ManagementPolicyRuleArgs>[]>;
  };

  containers?: {
    containers?: Array<{ name: string; isPublic?: boolean }>;
    queues?: Array<string>;
    fileShares?: Array<string>;
  };
}

export class StorageAccount extends BaseResourceComponent<StorageAccountArgs> {
  public readonly rsGroup: types.ResourceGroupInputs;
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: StorageAccountArgs, opts?: pulumi.ComponentResourceOptions) {
    super('StorageAccount', name, args, opts);
    const { rsGroup, sku, vaultInfo, defaultUAssignedId, policies, enableEncryption, network, containers, ...props } =
      args;

    const encryptionKey =
      enableEncryption && vaultInfo
        ? new vault.EncryptionKey(`${name}-storage`, { vaultInfo }, { dependsOn: opts?.dependsOn, parent: this })
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
          type: defaultUAssignedId
            ? storage.IdentityType.SystemAssigned_UserAssigned
            : storage.IdentityType.SystemAssigned,
          userAssignedIdentities: defaultUAssignedId ? [defaultUAssignedId.id] : undefined,
        },

        keyPolicy: {
          keyExpirationPeriodInDays: policies?.keyExpirationPeriodInDays ?? 365,
        },
        sasPolicy: policies?.sasExpirationPeriod
          ? {
              expirationAction: policies?.sasExpirationAction ?? 'Block',
              sasExpirationPeriod: policies?.sasExpirationPeriod,
            }
          : undefined,
        encryption: encryptionKey
          ? {
              keySource: storage.KeySource.Microsoft_Keyvault,
              keyVaultProperties: {
                keyName: encryptionKey.keyName,
                //keyVersion: encryptionKey.version,
                keyVaultUri: encryptionKey.vaultUrl,
              },
              requireInfrastructureEncryption: true,
              encryptionIdentity: defaultUAssignedId
                ? {
                    //encryptionFederatedIdentityClientId?: pulumi.Input<string>;
                    encryptionUserAssignedIdentity: defaultUAssignedId.id,
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
          defaultAction: args.network?.defaultAction ?? storage.DefaultAction.Allow,

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
    this.createLifeCycleManagement(stg);
    this.enableStaticWebsite(stg);
    this.createContainers(stg);

    this.addIdentityToRole('readOnly', stg.identity);
    this.addSecretsToVault(stg);

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
        new vnet.PrivateEndpoint(
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

  private createLifeCycleManagement(stg: storage.StorageAccount) {
    const { rsGroup, policies } = this.args;

    if (policies?.blob) {
      new storage.BlobServiceProperties(
        `${this.name}-blob-properties`,
        {
          ...rsGroup,
          accountName: stg.name,
          blobServicesName: 'default',
          ...policies.blob,
        },
        { dependsOn: stg, parent: this },
      );
    }

    if (policies?.defaultManagementPolicyRules) {
      return new storage.ManagementPolicy(
        `${this.name}-lifecycle`,
        {
          ...rsGroup,
          managementPolicyName: 'default',
          accountName: stg.name,

          policy: {
            rules: policies.defaultManagementPolicyRules,
          },
        },
        { dependsOn: stg, parent: this },
      );
    }
  }

  private enableStaticWebsite(stg: storage.StorageAccount) {
    const { rsGroup, policies } = this.args;
    if (!policies?.staticWebsite?.enabled) return;

    const staticWeb = new storage.StorageAccountStaticWebsite(
      `${this.name}-static-website`,
      {
        ...rsGroup,
        accountName: stg.name,
        indexDocument: 'index.html',
        error404Document: 'index.html',
      },
      { dependsOn: stg, parent: this },
    );

    if (policies.staticWebsite.endpoint) {
      new vnet.AzCdn(
        `${this.name}-cdn`,
        {
          endpoint: policies.staticWebsite.endpoint,
          rsGroup: policies.staticWebsite.existingProfile?.rsGroup ?? this.args.rsGroup,
          existingProfile: policies.staticWebsite.existingProfile,
        },
        { dependsOn: [stg, staticWeb], parent: this },
      );
    }
  }

  private addSecretsToVault(stg: storage.StorageAccount) {
    const { rsGroup, vaultInfo } = this.args;
    if (!vaultInfo) return;

    return stg.id.apply((id) => {
      if (!id) return;
      return storage
        .listStorageAccountKeysOutput({
          resourceGroupName: rsGroup.resourceGroupName,
          accountName: stg.name,
        })
        .apply((keys) => {
          const secrets = keys.keys
            .map((k) => ({
              [`${this.name}-${k.keyName}`]: {
                value: k.value,
                contentType: `StorageAccount ${k.keyName}`,
              },
            }))
            .reduce((acc, curr) => ({ ...acc, ...curr }), {} as { [key: string]: vault.SecretItemArgs });

          return new vault.VaultSecrets(
            this.name,
            {
              vaultInfo,
              secrets,
            },
            { dependsOn: stg, parent: this },
          );
        });
    });
  }

  private createContainers(stg: storage.StorageAccount) {
    const { rsGroup, containers } = this.args;
    if (!containers) return;

    containers.containers?.map(
      (c) =>
        new storage.BlobContainer(
          c.name,
          {
            containerName: c.name.toLowerCase(),
            ...rsGroup,
            accountName: stg.name,
            publicAccess: c.isPublic ? 'Blob' : 'None',
          },
          { dependsOn: stg, parent: this },
        ),
    );

    //Create Queues
    containers.queues?.map(
      (q) =>
        new storage.Queue(
          q,
          {
            queueName: q.toLowerCase(),
            accountName: stg.name,
            ...rsGroup,
          },
          { dependsOn: stg, parent: this },
        ),
    );

    //File Share
    containers.fileShares?.map(
      (s) =>
        new storage.FileShare(
          s,
          {
            shareName: s.toLowerCase(),
            accountName: stg.name,
            ...rsGroup,
          },
          { dependsOn: stg, parent: this },
        ),
    );
  }
}
