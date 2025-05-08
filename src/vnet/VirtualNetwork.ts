import * as network from '@pulumi/azure-native/network';
import * as inputs from '@pulumi/azure-native/types/input';
import * as pulumi from '@pulumi/pulumi';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import * as types from '../types';
import { Basion, BasionArgs } from './Basion';
import { Firewall, FirewallArgs } from './Firewall';
import { RouteTable, RouteTableArgs } from './RouteTable';
import { VpnGateway, VpnGatewayArgs } from './VpnGateway';
import * as helpers from './helpers';
import { NetworkPeering, NetworkPeeringArgs } from './NetworkPeering';

export type SubnetArgs = Pick<
  network.SubnetArgs,
  | 'applicationGatewayIPConfigurations'
  | 'delegations'
  | 'ipamPoolPrefixAllocations'
  | 'privateEndpointNetworkPolicies'
  | 'privateLinkServiceNetworkPolicies'
  | 'serviceEndpointPolicies'
  | 'serviceEndpoints'
  | 'sharingScope'
> & {
  subnetName: string;
  addressPrefix: pulumi.Input<string>;
  disableSecurityGroup?: boolean;
  disableRouteTable?: boolean;
  disableNatGateway?: boolean;
};

export interface HubVnetArgs extends CommonBaseArgs {
  /**
   * An array of public ip addresses associated with the nat gateway resource.
   */
  publicIpAddresses?: types.ResourceInputs[];

  securityGroup?: Pick<network.NetworkSecurityGroupArgs, 'flushConnection'> & {
    securityRules?: pulumi.Input<inputs.network.SecurityRuleArgs>[];
  };
  routeTable?: Omit<RouteTableArgs, 'rsGroup'>;
  natGateway?: Pick<network.NatGatewayArgs, 'idleTimeoutInMinutes' | 'zones'> & { sku: network.NatGatewaySkuName };
  vpnGateway?: Omit<VpnGatewayArgs, 'rsGroup' | 'subnetId'> & { subnetPrefix: pulumi.Input<string> };
  basion?: Omit<BasionArgs, 'rsGroup' | 'subnetId'> & {
    subnetPrefix: pulumi.Input<string>;
  };
  firewall?: Omit<FirewallArgs, 'managementIpConfiguration' | 'ipConfigurations' | 'hubIPAddresses' | 'rsGroup'> & {
    subnetPrefix: pulumi.Input<string>;
    managementSubnetPrefix?: pulumi.Input<string>;
    managementPublicIpAddress?: types.SubResourceInputs;
  };
  vnetPeering?: Omit<NetworkPeeringArgs, 'firstVnet' | 'secondVnet'> & {
    vnet: types.ResourceInputs;
  };
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
    defaultOutboundAccess?: pulumi.Input<boolean>;
    addressPrefixes?: pulumi.Input<string>[];
    subnets: Array<SubnetArgs>;
  };
}

export class HubVnet extends BaseResourceComponent<HubVnetArgs> {
  public readonly basion?: types.ResourceOutputs;
  public readonly securityGroup?: types.ResourceOutputs;
  public readonly routeTable: types.ResourceOutputs;
  public readonly natGateway?: types.ResourceOutputs;
  public readonly vpnGateway?: types.ResourceOutputs;
  public readonly firewall?: types.ResourceOutputs;
  public readonly vnet: types.ResourceOutputs;
  public readonly subnets: Record<string, types.ResourceOutputs>;

  constructor(name: string, args: HubVnetArgs, opts?: pulumi.ComponentResourceOptions) {
    super('HubVnet', name, args, opts);

    const securityGroup = this.createSecurityGroup();
    const routeTable = this.createRouteTable();
    const natGateway = this.createNatGateway();
    const { vnet, subnets } = this.createVnet({ natGateway, routeTable, securityGroup });
    const firewall = this.createFirewall(subnets);
    const basion = this.createBasion(subnets);
    const vpnGateway = this.createVpnGateway(subnets);

    this.createOutboundRoute({ router: routeTable!, natGateway, firewall });
    this.createPeering(vnet);

    if (basion) this.basion = { id: basion.id, resourceName: basion.resourceName };
    if (securityGroup) this.securityGroup = { id: securityGroup.id, resourceName: securityGroup.name };
    this.routeTable = { id: routeTable.id, resourceName: routeTable.resourceName };
    if (natGateway) this.natGateway = { id: natGateway.id, resourceName: natGateway.name };
    if (vpnGateway) this.vpnGateway = { id: vpnGateway.id, resourceName: vpnGateway.resourceName };
    if (firewall) this.firewall = firewall.firewall;
    this.vnet = { id: vnet.id, resourceName: vnet.name };

    this.subnets = Object.entries(subnets).reduce(
      (acc, [name, subnet]) => ({
        ...acc,
        [name]: { id: subnet.id, resourceName: subnet.name },
      }),
      {},
    );

    this.registerOutputs({
      securityGroup: this.securityGroup,
      routeTable: this.routeTable,
      natGateway: this.natGateway,
      vpnGateway: this.vpnGateway,
      firewall: this.firewall,
      vnet: this.vnet,
      subnets: this.subnets,
    });
  }

  private createSecurityGroup() {
    const { rsGroup, securityGroup, basion } = this.args;
    if (!securityGroup) return undefined;
    const { securityRules = [], ...props } = securityGroup;

    if (basion) {
      securityRules.push(...helpers.getBasionSGRules({ subnetPrefix: basion.subnetPrefix }));
    }

    return new network.NetworkSecurityGroup(
      `${this.name}-nsg`,
      {
        ...rsGroup,
        ...props,
        securityRules,
      },
      { dependsOn: this.opts?.dependsOn, parent: this },
    );
  }

  private createRouteTable() {
    const { rsGroup, firewall, routeTable = {} } = this.args;
    const { routes = [], ...routeProps } = routeTable;

    if (firewall) {
      routes.push({
        name: 'Internet',
        ...helpers.defaultRouteRules.defaultInternetRoute,
      });
    }

    return new RouteTable(
      `${this.name}-tb`,
      {
        rsGroup,
        ...routeProps,
        routes,
      },
      { dependsOn: this.opts?.dependsOn, parent: this },
    );
  }

  private createNatGateway() {
    const { rsGroup, natGateway, publicIpAddresses } = this.args;
    if (!natGateway) return undefined;
    if (!publicIpAddresses) throw new Error('PublicIpAddresses is required when NatGateway is created');

    return new network.NatGateway(
      `${this.name}-ngw`,
      {
        ...rsGroup,
        ...natGateway,
        sku: { name: natGateway.sku },
        publicIpAddresses,
      },
      { dependsOn: this.opts?.dependsOn, parent: this },
    );
  }

  private createVpnGateway(subnets: Record<string, network.Subnet>) {
    const { rsGroup, vpnGateway } = this.args;
    if (!vpnGateway) return undefined;

    const vpnSubnet = subnets[helpers.AzureSubnetNames.GatewaySubnetName];
    return new VpnGateway(
      `${this.name}-vpn`,
      {
        ...vpnGateway,
        rsGroup,
        subnetId: vpnSubnet.id,
      },
      { dependsOn: vpnSubnet, parent: this },
    );
  }

  private createFirewall(subnets: Record<string, network.Subnet>) {
    const { rsGroup, natGateway, publicIpAddresses, firewall } = this.args;
    if (!firewall) return undefined;

    const firewallSubnet = subnets[helpers.AzureSubnetNames.AzFirewallSubnet];
    const firewallManageSubnet = subnets[helpers.AzureSubnetNames.AzFirewallManagementSubnet];

    return new Firewall(
      `${this.name}-fw`,
      {
        ...firewall,
        rsGroup,
        managementIpConfiguration:
          firewallManageSubnet && firewall.managementPublicIpAddress
            ? {
                name: `${this.name}-fw-management`,
                publicIPAddress: firewall.managementPublicIpAddress,
                subnet: { id: firewallManageSubnet.id },
              }
            : undefined,

        ipConfigurations: publicIpAddresses
          ? pulumi.output(publicIpAddresses).apply((ips) =>
              ips.map((i, index) => ({
                name: `${this.name}-${i.resourceName}-ip-config`,
                //Only link the public Ip Address when nateGateway not created.
                publicIPAddress: natGateway ? undefined : i,
                //Only link the subnet to the first ipConfigurations
                subnet: index === 0 ? { id: firewallSubnet.id } : undefined,
              })),
            )
          : [
              {
                name: `${this.name}-ip-config`,
                subnet: { id: firewallSubnet.id },
              },
            ],
      },
      { dependsOn: firewallManageSubnet ? [firewallManageSubnet, firewallSubnet] : firewallSubnet, parent: this },
    );
  }

  private createBasion(subnets: Record<string, network.Subnet>) {
    const { rsGroup, basion } = this.args;
    if (!basion) return undefined;
    const basionSubnet = subnets[helpers.AzureSubnetNames.AzBastionSubnetName];

    return new Basion(
      `${this.name}-bastion`,
      {
        ...basion,
        rsGroup,
        subnetId: basionSubnet.id,
        network: { ...basion.network },
      },
      { dependsOn: basionSubnet, parent: this },
    );
  }

  private createVnet({
    natGateway,
    routeTable,
    securityGroup,
  }: {
    natGateway?: network.NatGateway;
    routeTable: RouteTable;
    securityGroup?: network.NetworkSecurityGroup;
  }) {
    const { rsGroup, firewall, basion, vpnGateway, vnet } = this.args;
    const subnets = vnet.subnets ?? [];
    const dependsOn: pulumi.Input<pulumi.Resource>[] = [];

    if (firewall) {
      //If NateGateway is together with Firewall, then NatGateway must be link to the Firewall Subnet only.
      if (natGateway) {
        subnets.forEach((s) => {
          s.disableNatGateway = true;
        });
      }

      subnets.push({
        subnetName: helpers.AzureSubnetNames.AzFirewallSubnet,
        addressPrefix: firewall.subnetPrefix,
        disableSecurityGroup: true,
        disableRouteTable: false,
        disableNatGateway: false,
      });

      if (firewall.managementSubnetPrefix) {
        subnets.push({
          subnetName: helpers.AzureSubnetNames.AzFirewallManagementSubnet,
          addressPrefix: firewall.managementSubnetPrefix,
          disableSecurityGroup: true,
          disableRouteTable: true,
          disableNatGateway: true,
        });
      }
    }
    if (basion) {
      subnets.push({
        subnetName: helpers.AzureSubnetNames.AzBastionSubnetName,
        addressPrefix: basion.subnetPrefix,
        disableSecurityGroup: false,
        disableRouteTable: true,
        disableNatGateway: true,
      });
    }
    if (vpnGateway) {
      subnets.push({
        subnetName: helpers.AzureSubnetNames.GatewaySubnetName,
        addressPrefix: vpnGateway.subnetPrefix,
        disableSecurityGroup: true,
        disableRouteTable: true,
        disableNatGateway: true,
      });
    }

    if (natGateway) dependsOn.push(natGateway);
    if (routeTable) dependsOn.push(routeTable);
    if (securityGroup) dependsOn.push(securityGroup);

    const vn = new network.VirtualNetwork(
      `${this.name}-vnet`,
      {
        ...rsGroup,
        ...vnet,
        addressSpace: {
          addressPrefixes: vnet.addressPrefixes ?? subnets.map((s) => s.addressPrefix!),
        },

        subnets: [],
        virtualNetworkPeerings: [],

        enableVmProtection: true,
        encryption: {
          enabled: true,
          enforcement: network.VirtualNetworkEncryptionEnforcement.AllowUnencrypted,
        },
      },
      { dependsOn, ignoreChanges: ['virtualNetworkPeerings', 'subnets'], parent: this },
    );

    const subs = this.createSubnets({
      subnets,
      vnet: vn,
      natGateway,
      routeTable,
      securityGroup,
    });

    return { vnet: vn, subnets: subs };
  }

  private createSubnets({
    subnets,
    vnet,
    natGateway,
    routeTable,
    securityGroup,
  }: {
    subnets: Array<SubnetArgs>;
    vnet: network.VirtualNetwork;
    natGateway?: network.NatGateway;
    routeTable: RouteTable;
    securityGroup?: network.NetworkSecurityGroup;
  }) {
    const {
      rsGroup,
      vnet: { defaultOutboundAccess },
    } = this.args;
    const rs: Record<string, network.Subnet> = {};

    subnets
      .sort((a, b) => a.subnetName.localeCompare(b.subnetName))
      .map(
        (s) =>
          (rs[s.subnetName] = new network.Subnet(
            `${this.name}-${s.subnetName}`,
            {
              ...s,
              ...rsGroup,
              virtualNetworkName: vnet.name,

              //Not allows outbound by default and it will be controlling by NatGateway or Firewall
              defaultOutboundAccess: defaultOutboundAccess ?? false,
              routeTable: s.disableRouteTable ? undefined : routeTable ? { id: routeTable.id } : undefined,
              networkSecurityGroup: s.disableSecurityGroup
                ? undefined
                : securityGroup
                ? { id: securityGroup.id }
                : undefined,
              natGateway: s.disableNatGateway ? undefined : natGateway ? { id: natGateway.id } : undefined,
            },
            { dependsOn: vnet, deleteBeforeReplace: true, parent: this },
          )),
      );

    return rs;
  }

  private createOutboundRoute({
    router,
    firewall,
    natGateway,
  }: {
    router: RouteTable;
    natGateway?: network.NatGateway;
    firewall?: Firewall;
  }) {
    if (natGateway && !firewall) {
      return router.addRoute('Internet-via-Gateway', helpers.defaultRouteRules.defaultGatewayRoute);
    }
  }

  private createPeering(vnet: network.VirtualNetwork) {
    const { vnetPeering } = this.args;
    if (!vnetPeering) return undefined;

    return new NetworkPeering(
      `${this.name}-peering`,
      {
        ...vnetPeering,
        firstVnet: { id: vnet.id, resourceName: vnet.name },
        secondVnet: vnetPeering.vnet,
      },
      { dependsOn: vnet, parent: this },
    );
  }
}
