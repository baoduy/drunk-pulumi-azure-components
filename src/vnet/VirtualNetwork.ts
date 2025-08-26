import * as network from '@pulumi/azure-native/network';
import * as inputs from '@pulumi/azure-native/types/input';
import * as pulumi from '@pulumi/pulumi';
import { BaseResourceComponent, CommonBaseArgs, baseHelpers } from '../base';
import * as types from '../types';
import { Basion, BasionArgs } from './Basion';
import { Firewall, FirewallArgs } from './Firewall';
import * as helpers from './helpers';
import { NetworkPeering, NetworkPeeringArgs } from './NetworkPeering';
import { RouteTable, RouteTableArgs } from './RouteTable';
import { getBasionSecurityRules } from './securityRules';
import { VpnGateway, VpnGatewayArgs } from './VpnGateway';
import { IpAddresses, IpAddressesArgs } from './IpAddresses';

export type SubnetArgs = Partial<
  Pick<
    network.SubnetArgs,
    | 'applicationGatewayIPConfigurations'
    | 'delegations'
    | 'ipamPoolPrefixAllocations'
    | 'privateEndpointNetworkPolicies'
    | 'privateLinkServiceNetworkPolicies'
    | 'serviceEndpointPolicies'
    | 'serviceEndpoints'
    | 'sharingScope'
  >
> & {
  subnetName: string;
  addressPrefix: pulumi.Input<string>;
  disableSecurityGroup?: boolean;
  disableRouteTable?: boolean;
  disableNatGateway?: boolean;
};

export interface VnetArgs extends CommonBaseArgs {
  /**
   * An array of public ip addresses associated with the nat gateway resource.
   */
  publicIpAddresses?: types.ResourceInputs[];
  publicIpCreate?: IpAddressesArgs & { name: string };

  securityGroupCreate?: Partial<Pick<network.NetworkSecurityGroupArgs, 'flushConnection'>> & {
    securityRules?: pulumi.Input<inputs.network.SecurityRuleArgs>[];
  };
  routeTableCreate?: Omit<RouteTableArgs, 'rsGroup'>;
  natGatewayCreate?: Partial<Pick<network.NatGatewayArgs, 'idleTimeoutInMinutes' | 'zones'>> & {
    sku: network.NatGatewaySkuName;
  };
  vpnGatewayCreate?: Omit<VpnGatewayArgs, 'rsGroup' | 'subnetId'> & { subnetPrefix: pulumi.Input<string> };
  basion?: Omit<BasionArgs, 'rsGroup' | 'subnetId'> & {
    subnetPrefix: pulumi.Input<string>;
  };
  firewallCreate?: Omit<
    FirewallArgs,
    'managementIpConfiguration' | 'ipConfigurations' | 'hubIPAddresses' | 'rsGroup'
  > & {
    subnetPrefix: pulumi.Input<string>;
    managementSubnetPrefix?: pulumi.Input<string>;
    managementPublicIpAddress?: types.SubResourceInputs;
  };
  vnetPeeringCreate?: Omit<NetworkPeeringArgs, 'firstVnet' | 'secondVnet'> & {
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

export type VnetOutputs = {
  securityGroup?: types.ResourceOutputs;
  routeTable: types.ResourceOutputs;
  natGateway?: types.ResourceOutputs;
  vpnGateway?: types.ResourceOutputs;
  firewall?: types.ResourceOutputs;
  vnet: types.ResourceOutputs;
  subnets: Record<string, types.ResourceOutputs>;
};

export class Vnet extends BaseResourceComponent<VnetArgs> {
  public readonly basion?: types.ResourceOutputs;
  public readonly securityGroup?: types.ResourceOutputs;
  public readonly routeTable: types.ResourceOutputs;
  public readonly natGateway?: types.ResourceOutputs;
  public readonly vpnGateway?: types.ResourceOutputs;
  public readonly firewall?: types.ResourceOutputs;
  public readonly vnet: types.ResourceOutputs;
  public readonly subnets: Record<string, types.ResourceOutputs>;
  private ipAddressInstance: IpAddresses | undefined;

  constructor(name: string, args: VnetArgs, opts?: pulumi.ComponentResourceOptions) {
    super('Vnet', name, args, opts);

    const securityGroup = this.createSecurityGroup();
    const routeTable = this.createRouteTable();
    const ipAddresses = this.createPublicIpAddresses();
    const natGateway = this.createNatGateway(ipAddresses);
    const { vnet, subnets } = this.createVnet({ natGateway, routeTable, securityGroup });
    const firewall = this.createFirewall(subnets);
    const basion = this.createBasion(subnets);
    const vpnGateway = this.createVpnGateway(subnets);

    //this.createOutboundRoute({ router: routeTable!, natGateway, firewall });
    this.createPeering(vnet);

    if (basion) this.basion = { id: basion.id, resourceName: basion.resourceName };
    if (securityGroup) this.securityGroup = { id: securityGroup.id, resourceName: securityGroup.name };
    this.routeTable = { id: routeTable.id, resourceName: routeTable.resourceName };
    if (natGateway) this.natGateway = { id: natGateway.id, resourceName: natGateway.name };
    if (vpnGateway) this.vpnGateway = { id: vpnGateway.id, resourceName: vpnGateway.resourceName };
    if (firewall) this.firewall = firewall.firewall;
    this.vnet = { id: vnet.id, resourceName: vnet.name };

    this.subnets = baseHelpers.recordMap(subnets, (s) => ({ id: s.id, resourceName: s.name.apply((n) => n!) }));

    this.registerOutputs();
  }

  public getOutputs(): VnetOutputs {
    return {
      securityGroup: this.securityGroup,
      routeTable: this.routeTable,
      natGateway: this.natGateway,
      vpnGateway: this.vpnGateway,
      firewall: this.firewall,
      vnet: this.vnet,
      subnets: this.subnets,
    };
  }

  private createSecurityGroup() {
    const { rsGroup, securityGroupCreate, basion } = this.args;
    if (!securityGroupCreate) return undefined;
    const { securityRules = [], ...props } = securityGroupCreate;

    if (basion) {
      securityRules.push(...getBasionSecurityRules({ bastionAddressPrefix: basion.subnetPrefix }));
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
    const { rsGroup, firewallCreate, routeTableCreate = {} } = this.args;
    const { routes = [], ...routeProps } = routeTableCreate;

    if (firewallCreate) {
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

  private createPublicIpAddresses(): types.ResourceInputs[] {
    const { publicIpCreate, publicIpAddresses } = this.args;
    if (publicIpAddresses) return publicIpAddresses;
    if (!publicIpCreate) return [];

    this.ipAddressInstance = new IpAddresses(publicIpCreate.name, publicIpCreate, {
      dependsOn: this.opts?.dependsOn,
      parent: this,
    });
    return Object.values(this.ipAddressInstance.ipAddresses);
  }

  private createNatGateway(ipAddresses: types.ResourceInputs[]) {
    const { rsGroup, natGatewayCreate } = this.args;
    if (!natGatewayCreate) return undefined;
    if (!ipAddresses) throw new Error('PublicIpAddresses is required when NatGateway is created');

    return new network.NatGateway(
      `${this.name}-ngw`,
      {
        ...rsGroup,
        ...natGatewayCreate,
        sku: { name: natGatewayCreate.sku },
        publicIpAddresses: ipAddresses,
      },
      { dependsOn: this.ipAddressInstance ?? this.opts?.dependsOn, parent: this },
    );
  }

  private createVpnGateway(subnets: Record<string, network.Subnet>) {
    const { rsGroup, vpnGatewayCreate } = this.args;
    if (!vpnGatewayCreate) return undefined;

    const vpnSubnet = subnets[helpers.AzureSubnetNames.GatewaySubnetName];
    return new VpnGateway(
      `${this.name}-vpn`,
      {
        ...vpnGatewayCreate,
        rsGroup,
        subnetId: vpnSubnet.id,
      },
      { dependsOn: vpnSubnet, parent: this },
    );
  }

  private createFirewall(subnets: Record<string, network.Subnet>) {
    const { rsGroup, natGatewayCreate, publicIpAddresses, firewallCreate } = this.args;
    if (!firewallCreate) return undefined;

    const firewallSubnet = subnets[helpers.AzureSubnetNames.AzFirewallSubnet];
    const firewallManageSubnet = subnets[helpers.AzureSubnetNames.AzFirewallManagementSubnet];

    return new Firewall(
      `${this.name}-fw`,
      {
        ...firewallCreate,
        rsGroup,
        managementIpConfiguration:
          firewallManageSubnet && firewallCreate.managementPublicIpAddress
            ? {
                name: `${this.name}-fw-management`,
                publicIPAddress: firewallCreate.managementPublicIpAddress,
                subnet: { id: firewallManageSubnet.id },
              }
            : undefined,

        ipConfigurations: publicIpAddresses
          ? pulumi.output(publicIpAddresses).apply((ips) =>
              ips.map((i, index) => ({
                name: `${this.name}-${i.resourceName}-ip-config`,
                //Only link the public Ip Address when nateGateway not created.
                publicIPAddress: natGatewayCreate ? undefined : i,
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
    const { rsGroup, firewallCreate, basion, vpnGatewayCreate, vnet } = this.args;
    const subnets = vnet.subnets ?? [];
    const dependsOn: pulumi.Input<pulumi.Resource>[] = [];

    if (firewallCreate) {
      //If NateGateway is together with Firewall, then NatGateway must be link to the Firewall Subnet only.
      if (natGateway) {
        subnets.forEach((s) => {
          s.disableNatGateway = true;
        });
      }

      subnets.push({
        subnetName: helpers.AzureSubnetNames.AzFirewallSubnet,
        addressPrefix: firewallCreate.subnetPrefix,
        disableSecurityGroup: true,
        disableRouteTable: false,
        disableNatGateway: false,
      });

      if (firewallCreate.managementSubnetPrefix) {
        subnets.push({
          subnetName: helpers.AzureSubnetNames.AzFirewallManagementSubnet,
          addressPrefix: firewallCreate.managementSubnetPrefix,
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
    if (vpnGatewayCreate) {
      subnets.push({
        subnetName: helpers.AzureSubnetNames.GatewaySubnetName,
        addressPrefix: vpnGatewayCreate.subnetPrefix,
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

  // private createOutboundRoute({
  //   router,
  //   firewall,
  //   natGateway,
  // }: {
  //   router: RouteTable;
  //   natGateway?: network.NatGateway;
  //   firewall?: Firewall;
  // }) {
  //   if (natGateway && !firewall) {
  //     return router.addRoute('Internet-via-Gateway', helpers.defaultRouteRules.defaultGatewayRoute);
  //   }
  // }

  private createPeering(vnet: network.VirtualNetwork) {
    const { vnetPeeringCreate } = this.args;
    if (!vnetPeeringCreate) return undefined;

    return new NetworkPeering(
      `${this.name}-peering`,
      {
        ...vnetPeeringCreate,
        firstVnet: { id: vnet.id, resourceName: vnet.name },
        secondVnet: vnetPeeringCreate.vnet,
      },
      { dependsOn: vnet, parent: this },
    );
  }
}
