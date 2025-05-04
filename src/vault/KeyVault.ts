import * as pulumi from '@pulumi/pulumi';
import { BaseArgs, BaseResourceComponent } from '../base';
import * as keyvault from '@pulumi/azure-native/keyvault';
import { azureEnv } from '../helpers';
import { PrivateEndpoint, PrivateEndpointType } from '../vnet';
import { ResourceGroupInfo } from '../types';

export interface KeyVaultArgs
  extends BaseArgs,
    Pick<keyvault.VaultArgs, 'tags'> {
  sku?: 'standard' | 'premium';

  network?: {
    publicNetworkAccess?: 'disabled' | 'enabled';
    bypass?: 'AzureServices' | 'None';
    defaultAction?: 'Allow' | 'Deny';

    ipRules?: pulumi.Input<pulumi.Input<string>[]>;
    vnetRules?: pulumi.Input<
      pulumi.Input<{ id: string; ignoreMissingVnetServiceEndpoint?: boolean }>[]
    >;

    privateLink?: PrivateEndpointType;
  };

  properties?: {
    enablePurgeProtection?: pulumi.Input<boolean>;
    enableRbacAuthorization?: pulumi.Input<boolean>;
    enableSoftDelete?: pulumi.Input<boolean>;
    enabledForDeployment?: pulumi.Input<boolean>;
    enabledForDiskEncryption?: pulumi.Input<boolean>;
    enabledForTemplateDeployment?: pulumi.Input<boolean>;
    softDeleteRetentionInDays?: pulumi.Input<number>;
  };
}

export class KeyVault extends BaseResourceComponent<KeyVaultArgs> {
  public readonly resourceName: pulumi.Output<string>;
  public readonly id: pulumi.Output<string>;
  public readonly rsGroupInfo: pulumi.Output<ResourceGroupInfo>;

  constructor(
    name: string,
    args: KeyVaultArgs = {},
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('KeyVault', name, args, opts);

    const group = this.getRsGroupInfo();
    const vault = new keyvault.Vault(
      name,
      {
        resourceGroupName: pulumi.output(group).resourceGroupName,
        // vaultName:
        //   `${stackInfo.stack}-${name}-${stackInfo.organization}-vlt`.substring(
        //     0,
        //     24
        //   ),
        properties: {
          //Default values
          enableRbacAuthorization: true,
          enablePurgeProtection: true,
          enableSoftDelete: true,
          softDeleteRetentionInDays: 7,
          //Allows to be overwritten
          ...args.properties,
          tenantId: azureEnv.tenantId,

          sku: {
            family: 'A',
            name: args.sku ?? 'standard',
          },

          publicNetworkAccess:
            args.network?.publicNetworkAccess ??
            (args.network?.privateLink ? 'disabled' : 'enabled'),

          networkAcls: {
            bypass: args.network?.bypass,
            defaultAction: args.network?.defaultAction,
            ipRules: args.network?.ipRules
              ? pulumi
                  .output(args.network.ipRules)
                  .apply((ips) => ips.map((i) => ({ value: i })))
              : undefined,

            virtualNetworkRules: args.network?.vnetRules
              ? pulumi.output(args.network.vnetRules).apply((vnetRules) =>
                  vnetRules.map((v) => ({
                    id: v.id,
                    ignoreMissingVnetServiceEndpoint:
                      v.ignoreMissingVnetServiceEndpoint,
                  }))
                )
              : undefined,
          },
        },
        tags: args.tags,
      },
      {
        ...opts,
        ignoreChanges: ['properties.accessPolicies'],
        parent: this,
      }
    );

    this.createPrivateEndpoint(vault);

    this.resourceName = vault.name;
    this.id = vault.id;
    this.rsGroupInfo = pulumi.output(group);

    this.registerOutputs({
      resourceName: this.resourceName,
      id: this.id,
      rsGroupInfo: this.rsGroupInfo,
    });
  }

  private createPrivateEndpoint(vault: keyvault.Vault) {
    const { network } = this.args;
    if (!network?.privateLink) return;

    return new PrivateEndpoint(
      `${this.name}-private-endpoint`,
      {
        resourceInfo: { id: vault.id, name: this.name },
        type: 'keyVault',
        ...network.privateLink,
      },
      { dependsOn: vault, parent: this }
    );
  }
}
