import * as nw from '@pulumi/azure-native/network';
import * as pulumi from '@pulumi/pulumi';
import { getComponentResourceType } from '../base/helpers';
import * as types from '../types';
import { azureEnv } from '../helpers';
import { BaseComponent } from '../base/BaseComponent';

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

export class VpnGateway extends BaseComponent<VpnGatewayArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: VpnGatewayArgs, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('VpnGateway'), name, args, opts);

    const { rsGroup, sku, publicIPAddress, subnetId, ...props } = args;

    const vpn = new nw.VirtualNetworkGateway(
      name,
      {
        ...rsGroup,
        ...props,
        sku: { name: sku, tier: sku },

        gatewayType: props.gatewayType ?? 'Vpn',
        vpnType: props.vpnType ?? 'RouteBased',

        ipConfigurations: [
          {
            name: 'vnetGatewayConfig',
            publicIPAddress:
              sku !== 'Basic'
                ? {
                    id: publicIPAddress.id,
                  }
                : undefined,
            subnet: {
              id: subnetId,
            },
          },
        ],

        vpnClientConfiguration: props.vpnClientConfiguration ?? {
          vpnClientProtocols: ['OpenVPN'],
          vpnClientAddressPool: {
            addressPrefixes: ['172.16.100.0/24'],
          },

          vpnAuthenticationTypes: [nw.VpnAuthenticationType.AAD],
          aadTenant: pulumi.interpolate`https://login.microsoftonline.com/${azureEnv.tenantId}`,
          aadAudience: '41b23e61-6c1e-4545-b367-cd054e0ed4b4',
          aadIssuer: pulumi.interpolate`https://sts.windows.net/${azureEnv.tenantId}/`,
        },
      },
      { ...opts, parent: this },
    );

    this.id = vpn.id;
    this.resourceName = vpn.name;

    this.registerOutputs(this.getOutputs());
  }

  public getOutputs(): pulumi.Inputs | pulumi.Output<pulumi.Inputs> {
    return {
      id: this.id,
      resourceName: this.resourceName,
    };
  }
}
