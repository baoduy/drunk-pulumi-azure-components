import * as network from '@pulumi/azure-native/network';
import * as pulumi from '@pulumi/pulumi';
import { BaseResourceComponent, CommonBaseArgs } from '../base';

export interface HubVnetArgs extends CommonBaseArgs {
  securityGroup?: Pick<network.NetworkSecurityGroupArgs, 'flushConnection' | 'securityRules'>;
  routeTable?: Pick<network.RouteTableArgs, 'disableBgpRoutePropagation' | 'routes'>;
  natGateway?: Pick<network.NatGatewayArgs, ''> & {};

  vnet: Omit<
    network.VirtualNetworkArgs,
    | 'addressSpace'
    | 'enableVmProtection'
    | 'encryption'
    | 'subnets'
    | 'id'
    | 'location'
    | 'resourceGroupName'
    | 'virtualNetworkName'
    | 'virtualNetworkPeerings'
  > & {
    addressPrefixes?: pulumi.Input<string>[];
    subnets: Array<
      Pick<
        network.SubnetArgs,
        | 'addressPrefix'
        | 'applicationGatewayIPConfigurations'
        | 'defaultOutboundAccess'
        | 'delegations'
        | 'ipamPoolPrefixAllocations'
        | 'privateEndpointNetworkPolicies'
        | 'privateLinkServiceNetworkPolicies'
        | 'serviceEndpointPolicies'
        | 'serviceEndpoints'
        | 'sharingScope'
      > & {
        subnetName: string;
        disableSecurityGroup?: boolean;
        disableRouteTable?: boolean;
        allowNatGateway?: boolean;
      }
    >;
  };
}

export class HubVnet extends BaseResourceComponent<HubVnetArgs> {
  //public readonly id: pulumi.Output<string>;
  //public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: HubVnetArgs, opts?: pulumi.ComponentResourceOptions) {
    super('HubVnet', name, args, opts);

    const nsg = this.createSecurityGroup();
    const table = this.createRouteTable();
  }

  private createSecurityGroup() {
    const { rsGroup, securityGroup } = this.args;
    if (!securityGroup) return undefined;

    return new network.NetworkSecurityGroup(
      `${this.name}-nsg`,
      {
        ...rsGroup,
        ...securityGroup,
      },
      { dependsOn: this.opts?.dependsOn, parent: this },
    );
  }

  private createRouteTable() {
    const { rsGroup, routeTable } = this.args;
    if (!routeTable) return undefined;
    return new network.RouteTable(
      `${this.name}-tb`,
      {
        ...rsGroup,
        ...routeTable,
      },
      { dependsOn: this.opts?.dependsOn, parent: this },
    );
  }

  private createNatGateway() {}

  private createVnet({
    natGateway,
    routeTable,
    securityGroup,
  }: {
    natGateway?: { id: pulumi.Input<string> };
    routeTable?: network.RouteTable;
    securityGroup?: network.NetworkSecurityGroup;
  }) {
    const {
      rsGroup,
      vnet: { subnets, ...vnetProps },
    } = this.args;
    const vnet = new network.VirtualNetwork(
      `${this.name}-vnet`,
      {
        ...rsGroup,
        ...vnetProps,
        addressSpace: {
          addressPrefixes: vnetProps.addressPrefixes ?? subnets.map((s) => s.addressPrefix!),
        },

        subnets: subnets.map((s) => ({
          ...s,
          //Not allows outbound by default and it will be controlling by NatGateway or Firewall
          defaultOutboundAccess: s.defaultOutboundAccess ?? false,
          routeTable: s.disableRouteTable ? undefined : { id: routeTable?.id },
          networkSecurityGroup: s.disableSecurityGroup ? undefined : { id: securityGroup?.id },
          natGateway: s.allowNatGateway ? natGateway : undefined,
        })),
        enableVmProtection: true,
        encryption: {
          enabled: true,
          enforcement: network.VirtualNetworkEncryptionEnforcement.AllowUnencrypted,
        },
      },
      { ignoreChanges: ['virtualNetworkPeerings'], parent: this },
    );
  }
}
