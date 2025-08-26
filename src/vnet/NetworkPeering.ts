import * as network from '@pulumi/azure-native/network';
import * as pulumi from '@pulumi/pulumi';
import { getComponentResourceType } from '../base/helpers';
import * as types from '../types';
import { rsHelpers } from '../helpers';

export type PeeringDirectionType = 'Unidirectional' | 'Bidirectional';

type NetworkPeeringProps = Partial<
  Omit<
    network.VirtualNetworkPeeringArgs,
    | 'id'
    | 'name'
    | 'peeringState'
    | 'resourceGroupName'
    | 'virtualNetworkName'
    | 'virtualNetworkPeeringName'
    | 'syncRemoteAddressSpace'
  >
> & { syncRemoteAddressSpace: 'true' | 'false' };

const defaultProps: NetworkPeeringProps = {
  allowForwardedTraffic: true,
  allowVirtualNetworkAccess: true,
  allowGatewayTransit: true,
  syncRemoteAddressSpace: 'true',
  doNotVerifyRemoteGateways: true,
};

export interface NetworkPeeringArgs {
  options?: NetworkPeeringProps;
  firstVnet: types.ResourceInputs;
  secondVnet: types.ResourceInputs;
  direction: PeeringDirectionType;
}

export class NetworkPeering extends pulumi.ComponentResource<NetworkPeeringArgs> {
  constructor(private name: string, private args: NetworkPeeringArgs, private opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('NetworkPeering'), name, args, opts);

    const { firstVnet, secondVnet, direction } = args;
    pulumi.all([firstVnet, secondVnet]).apply(([first, second]) => {
      this.createPeering(first, second);
      if (direction === 'Bidirectional') this.createPeering(second, first);
    });
  }

  private createPeering(from: types.ResourceType, to: types.ResourceType) {
    const { options } = this.args;
    const vnetInfo = rsHelpers.getRsInfoFromId(from.id);

    const n = `${this.name}-${rsHelpers.getShortName(from.resourceName)}-to-${rsHelpers.getShortName(to.resourceName)}`;
    return new network.VirtualNetworkPeering(
      n,
      {
        ...defaultProps,
        ...options,
        virtualNetworkPeeringName: n,
        virtualNetworkName: vnetInfo.resourceName,
        resourceGroupName: vnetInfo.rsGroup.resourceGroupName,
        peeringSyncLevel: 'FullyInSync',
        remoteVirtualNetwork: {
          id: to.id,
        },
      },
      {
        dependsOn: this.opts?.dependsOn,
        parent: this,
      },
    );
  }
}
