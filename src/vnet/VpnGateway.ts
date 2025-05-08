import * as network from '@pulumi/azure-native/network';
import * as pulumi from '@pulumi/pulumi';
import { getComponentResourceType } from '../base/helpers';
import * as types from '../types';

export type PeeringDirectionType = 'Unidirectional' | 'Bidirectional';

export interface VpnGatewayArgs
  extends types.WithResourceGroupInputs,
    Omit<
      nw.VirtualNetworkGatewayArgs,
      'id' | 'location' | 'ipConfigurations' | 'resourceGroupName' | 'sku' | 'virtualNetworkGatewayName'
    > {
  sku: nw.VirtualNetworkGatewaySkuName;
  publicIPAddress: types.SubResourceInputs;
  subnetId: pulumi.Input<string>;
}

export class VpnGateway extends pulumi.ComponentResource<VpnGatewayArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, private args: VpnGatewayArgs, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('VpnGateway'), name, args, opts);

    const { rsGroup, sku, publicIPAddress, subnetId, ...props } = args;

    this.id = vpn.id;
    this.resourceName = vpn.name;

    this.registerOutputs({
      id: this.id,
      resourceName: this.resourceName,
    });
  }

  private createPeering(type: '' | '') {
    const {} = this.args;
    return new network.VirtualNetworkPeering(
      `${this}`,
      {
        ...secondOptions,
        syncRemoteAddressSpace: secondOptions.syncRemoteAddressSpace ? 'true' : 'false',
        virtualNetworkPeeringName: `${stack}-${second.name}-${first.name}-vlk`,
        virtualNetworkName: second.name,
        resourceGroupName: second.group.resourceGroupName,
        peeringSyncLevel: 'FullyInSync',
        remoteVirtualNetwork: {
          id: first.id,
        },
      },
      {
        deleteBeforeReplace: true,
        ignoreChanges: ['peeringSyncLevel', 'peeringState'],
      },
    );
  }
}
