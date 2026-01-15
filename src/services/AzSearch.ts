import * as search from '@pulumi/azure-native/search';
import * as pulumi from '@pulumi/pulumi';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import * as types from '../types';
import * as vault from '../vault';
import { PrivateEndpoint } from '../vnet';

export interface AzSearchArgs
  extends
    CommonBaseArgs,
    types.WithEncryptionEnabler,
    Pick<search.ServiceArgs, 'authOptions' | 'hostingMode' | 'partitionCount' | 'replicaCount' | 'semanticSearch'> {
  sku: search.SkuName;
  disableLocalAuth?: boolean;
  network?: Pick<types.NetworkArgs, 'publicNetworkAccess' | 'ipRules' | 'privateLink'>;
}

export class AzSearch extends BaseResourceComponent<AzSearchArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: AzSearchArgs, opts?: pulumi.ComponentResourceOptions) {
    super('AzSearch', name, args, opts);

    const { rsGroup, enableResourceIdentity, enableEncryption, network, ...props } = args;

    const service = new search.Service(
      name,
      {
        ...props,
        ...rsGroup,
        sku: { name: props.sku },

        encryptionWithCmk: enableEncryption
          ? {
              enforcement: search.SearchEncryptionWithCmk.Enabled,
            }
          : undefined,

        identity: enableResourceIdentity
          ? {
              type: props.sku === search.SkuName.Free ? search.IdentityType.None : search.IdentityType.SystemAssigned,
            }
          : undefined,

        publicNetworkAccess: network?.publicNetworkAccess ? 'enabled' : network?.privateLink ? 'disabled' : 'enabled',
        networkRuleSet: network?.ipRules
          ? {
              ipRules: pulumi.output(network.ipRules).apply((ips) => ips.map((i) => ({ value: i }))),
            }
          : undefined,
      },
      { ...opts, parent: this },
    );

    this.createPrivateLink(service);
    this.addSecretsToVault(service);

    this.id = service.id;
    this.resourceName = service.name;

    this.registerOutputs();
  }

  public getOutputs(): types.ResourceOutputs {
    return {
      id: this.id,
      resourceName: this.resourceName,
      resourceGroupName: pulumi.output(this.args.rsGroup.resourceGroupName),
    };
  }

  private createPrivateLink(service: search.Service) {
    const { rsGroup, network } = this.args;
    if (!network?.privateLink) return;

    return new PrivateEndpoint(
      this.name,
      { ...network.privateLink, resourceInfo: service, rsGroup, type: 'azSearch' },
      { dependsOn: service, parent: this },
    );
  }

  private addSecretsToVault(service: search.Service) {
    const { disableLocalAuth, rsGroup, vaultInfo } = this.args;
    if (disableLocalAuth || !vaultInfo) return;

    pulumi.output([service.name, rsGroup.resourceGroupName]).apply(async ([svName, rgName]) => {
      if (!svName) return;

      const keys = await search.listQueryKeyBySearchService({
        searchServiceName: svName,
        resourceGroupName: rgName,
      });

      new vault.VaultSecrets(
        this.name,
        {
          vaultInfo,
          secrets: {
            [`${this.name}-${keys.value[0].key}`]: {
              value: keys.value[0].name,
              contentType: `AzSearch ${keys.value[0].key}`,
            },

            [`${this.name}-${keys.value[1].key}`]: {
              value: keys.value[1].name,
              contentType: `AzSearch ${keys.value[1].key}`,
            },
          },
        },
        { dependsOn: service, parent: this },
      );
    });
  }
}
