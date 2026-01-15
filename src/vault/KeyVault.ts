import * as keyvault from '@pulumi/azure-native/keyvault';
import * as pulumi from '@pulumi/pulumi';

import { BaseArgs, BaseResourceComponent } from '../base';
import * as types from '../types';

import { PrivateEndpoint } from '../vnet';
import { SecretItemArgs } from './VaultSecret';
import { VaultSecrets } from './VaultSecrets';
import { azureEnv } from '../helpers';

export interface KeyVaultArgs
  extends BaseArgs, types.WithResourceGroupInputs, types.WithNetworkArgs, Partial<Pick<keyvault.VaultArgs, 'tags'>> {
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

  aditionalSecrets?: { [key: string]: SecretItemArgs };
}

export class KeyVault extends BaseResourceComponent<KeyVaultArgs> {
  public readonly resourceName: pulumi.Output<string>;
  public readonly id: pulumi.Output<string>;

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
          softDeleteRetentionInDays: 90,
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
    this.addSecretsToVault(vault);

    this.resourceName = vault.name;
    this.id = vault.id;

    this.registerOutputs();
  }

  public getOutputs(): types.ResourceOutputs {
    return {
      resourceGroupName: pulumi.output(this.args.rsGroup.resourceGroupName),
      resourceName: this.resourceName,
      id: this.id,
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

  private addSecretsToVault(vault: keyvault.Vault) {
    const { aditionalSecrets } = this.args;
    if (!aditionalSecrets) return;

    return new VaultSecrets(
      `${this.name}-secrets`,
      {
        vaultInfo: {
          resourceName: vault.name,
          id: vault.id,
          resourceGroupName: pulumi.output(this.args.rsGroup.resourceGroupName),
        },
        secrets: aditionalSecrets,
      },
      { dependsOn: vault, deletedWith: vault, parent: this },
    );
  }
}
