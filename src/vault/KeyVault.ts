import * as keyvault from '@pulumi/azure-native/keyvault';
import * as pulumi from '@pulumi/pulumi';
import { BaseArgs, BaseResourceComponent } from '../base/BaseResourceComponent';
import { azureEnv } from '../helpers';
import { ResourceGroupInputs, WithNetworkArgs, WithResourceGroupInputs } from '../types';
import { PrivateEndpoint } from '../vnet';

export interface KeyVaultArgs
  extends BaseArgs,
    WithResourceGroupInputs,
    WithNetworkArgs,
    Pick<keyvault.VaultArgs, 'tags'> {
  sku?: 'standard' | 'premium';

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
  public readonly rsGroup: ResourceGroupInputs;

  constructor(name: string, args: KeyVaultArgs, opts?: pulumi.ComponentResourceOptions) {
    super('KeyVault', name, args, opts);

    const vault = new keyvault.Vault(
      name,
      {
        ...args.rsGroup,
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
            args.network?.publicNetworkAccess ?? (args.network?.privateLink ? 'disabled' : 'enabled'),

          networkAcls: {
            bypass: args.network?.bypass,
            defaultAction: args.network?.defaultAction,

            ipRules: args.network?.ipRules
              ? pulumi.output(args.network.ipRules).apply((ips) => ips.map((i) => ({ value: i })))
              : undefined,

            virtualNetworkRules: args.network?.vnetRules
              ? pulumi.output(args.network.vnetRules).apply((vnetRules) =>
                  vnetRules.map((v) => ({
                    id: v.subnetId,
                    ignoreMissingVnetServiceEndpoint: v.ignoreMissingVnetServiceEndpoint,
                  })),
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
      },
    );

    this.createPrivateEndpoint(vault);

    this.resourceName = vault.name;
    this.id = vault.id;
    this.rsGroup = args.rsGroup;

    this.registerOutputs();
  }

  public getOutputs() {
    return {
      resourceName: this.resourceName,
      id: this.id,
      rsGroup: this.rsGroup,
    };
  }

  private createPrivateEndpoint(vault: keyvault.Vault) {
    const { network } = this.args;
    if (!network?.privateLink) return;

    return new PrivateEndpoint(
      `${this.name}-private-endpoint`,
      {
        rsGroup: this.args.rsGroup,
        resourceInfo: vault,
        type: 'keyVault',
        ...network.privateLink,
      },
      { dependsOn: vault, parent: this },
    );
  }
}
