import * as ss from '@pulumi/azure-native/signalrservice';
import * as pulumi from '@pulumi/pulumi';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import * as types from '../types';
import * as vault from '../vault';
import { PrivateEndpoint } from '../vnet/PrivateEndpoint';

export interface SignalRArgs
  extends CommonBaseArgs,
    types.WithUserAssignedIdentity,
    Pick<ss.SignalRArgs, 'kind' | 'cors' | 'features' | 'tls' | 'identity'> {
  sku: {
    /**
     * Optional, integer. The unit count of the resource.
     * 1 for Free_F1/Standard_S1/Premium_P1, 100 for Premium_P2 by default.
     *
     * If present, following values are allowed:
     *     Free_F1: 1;
     *     Standard_S1: 1,2,3,4,5,6,7,8,9,10,20,30,40,50,60,70,80,90,100;
     *     Premium_P1:  1,2,3,4,5,6,7,8,9,10,20,30,40,50,60,70,80,90,100;
     *     Premium_P2:  100,200,300,400,500,600,700,800,900,1000;
     */
    capacity?: pulumi.Input<number>;
    /**
     * The name of the SKU. Required.
     *
     * Allowed values: Standard_S1, Free_F1, Premium_P1, Premium_P2
     */
    name: 'Standard_S1' | 'Free_F1' | 'Premium_P1' | 'Premium_P2';
    /**
     * Optional tier of this particular SKU. 'Standard' or 'Free'.
     *
     * `Basic` is deprecated, use `Standard` instead.
     */
    tier?: ss.SignalRSkuTier;
  };

  disableAadAuth?: boolean;
  disableLocalAuth?: boolean;
  network?: Pick<types.NetworkArgs, 'defaultAction' | 'ipRules' | 'privateLink' | 'publicNetworkAccess'>;
}

export class SignalR extends BaseResourceComponent<SignalRArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: SignalRArgs, opts?: pulumi.ComponentResourceOptions) {
    super('SignalR', name, args, opts);

    const { rsGroup, network, sku, ...props } = args;
    const isFreeTier = sku.name === 'Free_F1';

    const service = new ss.SignalR(
      name,
      {
        ...props,
        ...rsGroup,
        sku,
        publicNetworkAccess: network?.publicNetworkAccess ? 'Enabled' : network?.privateLink ? 'Disabled' : 'Enabled',
        networkACLs: isFreeTier
          ? undefined
          : network?.privateLink
          ? {
              defaultAction: ss.ACLAction.Allow,
              publicNetwork: {
                allow: [ss.SignalRRequestType.ClientConnection],
                deny: [ss.SignalRRequestType.ServerConnection, ss.SignalRRequestType.RESTAPI],
              },
              privateEndpoints: [
                {
                  name: '',
                  allow: [ss.SignalRRequestType.ClientConnection, ss.SignalRRequestType.ServerConnection],
                  deny: [ss.SignalRRequestType.RESTAPI],
                },
              ],
            }
          : {
              defaultAction: ss.ACLAction.Allow,
              publicNetwork: {
                allow: [ss.SignalRRequestType.ClientConnection, ss.SignalRRequestType.ServerConnection],
                deny: [ss.SignalRRequestType.RESTAPI],
              },
            },
      },
      { ...opts, parent: this },
    );

    this.createPrivateLink(service);
    this.addSecretsToVault(service);

    this.id = service.id;
    this.resourceName = service.name;

    this.registerOutputs({
      id: this.id,
      resourceName: this.resourceName,
    });
  }

  private createPrivateLink(service: ss.SignalR) {
    const { rsGroup, network } = this.args;
    if (!network?.privateLink) return;

    return new PrivateEndpoint(
      this.name,
      { ...network.privateLink, resourceInfo: service, rsGroup, type: 'signalR' },
      { dependsOn: service, parent: this },
    );
  }

  private addSecretsToVault(service: ss.SignalR) {
    const { rsGroup, disableLocalAuth, vaultInfo } = this.args;
    if (disableLocalAuth || !vaultInfo) return;

    pulumi.output([service.name, rsGroup.resourceGroupName]).apply(async ([svName, rgName]) => {
      if (!svName) return;

      const keys = await ss.listSignalRKeys({
        resourceName: svName,
        resourceGroupName: rgName,
      });

      new vault.VaultSecrets(
        this.name,
        {
          vaultInfo,
          secrets: {
            [`${this.name}-primary-conn`]: {
              value: keys.primaryConnectionString!,
              contentType: `SignalR Primary ConnectionString`,
            },

            [`${this.name}-secondary-conn`]: {
              value: keys.secondaryConnectionString!,
              contentType: `SignalR Secondary ConnectionString`,
            },
          },
        },
        { dependsOn: service, parent: this },
      );
    });
  }
}
