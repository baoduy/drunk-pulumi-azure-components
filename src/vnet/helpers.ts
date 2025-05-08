import * as inputs from '@pulumi/azure-native/types/input';
import * as pulumi from '@pulumi/pulumi';
import { RouteArgs } from './RouteTable';

export function getVnetIdFromSubnetId(subnetId: string) {
  //The sample SubnetId is /subscriptions/63a31b41-eb5d-4160-9fc9-d30fc00286c9/resourceGroups/sg-dev-aks-vnet/providers/Microsoft.Network/virtualNetworks/sg-vnet-trans/subnets/aks-main-nodes
  return subnetId.split('/subnets')[0];
}

export function getSubnetNameFromId(subnetId: string) {
  //The sample SubnetId is /subscriptions/63a31b41-eb5d-4160-9fc9-d30fc00286c9/resourceGroups/sg-dev-aks-vnet/providers/Microsoft.Network/virtualNetworks/sg-vnet-trans/subnets/aks-main-nodes
  return subnetId.split('/subnets')[1];
}

export function getDnsRecordName(recordName: string) {
  return recordName === '*' ? `all-aRecord` : recordName === '@' ? `root-aRecord` : `${recordName}-aRecord`;
}

export enum AzureSubnetNames {
  AppGatewaySubnetName = 'app-gateway',
  GatewaySubnetName = 'GatewaySubnet',
  AzFirewallSubnet = 'AzureFirewallSubnet',
  AzFirewallManagementSubnet = 'AzureFirewallManagementSubnet',
  AzBastionSubnetName = 'AzureBastionSubnet',
}

export const defaultServicesEndpoints = [
  'Microsoft.AzureActiveDirectory',
  'Microsoft.AzureCosmosDB',
  'Microsoft.ContainerRegistry',
  'Microsoft.EventHub',
  'Microsoft.KeyVault',
  'Microsoft.ServiceBus',
  'Microsoft.Sql',
  'Microsoft.Storage',
  'Microsoft.Web',
];

export const defaultRouteRules = {
  defaultInternetRoute: {
    addressPrefix: '0.0.0.0/0',
    nextHopType: 'Internet',
  } as RouteArgs,
  defaultGatewayRoute: {
    addressPrefix: '0.0.0.0/0',
    nextHopType: 'VirtualNetworkGateway',
  } as RouteArgs,
};

export function getBasionSGRules({
  subnetPrefix,
  startPriority = 3000,
}: {
  subnetPrefix: pulumi.Input<string>;
  startPriority?: number;
}) {
  const rs = new Array<inputs.network.SecurityRuleArgs>();
  //Inbound
  rs.push(
    {
      name: 'BastionAllowsHttpsInbound',
      sourceAddressPrefix: 'Internet',
      sourcePortRange: '*',
      destinationAddressPrefix: subnetPrefix,
      destinationPortRange: '443',
      protocol: 'Tcp',
      access: 'Allow',
      direction: 'Inbound',
      priority: startPriority++,
    },
    {
      name: 'BastionAllowsGatewayManagerInbound',
      sourceAddressPrefix: 'GatewayManager',
      sourcePortRange: '*',
      destinationAddressPrefix: '*',
      destinationPortRange: '443',
      protocol: 'Tcp',
      access: 'Allow',
      direction: 'Inbound',
      priority: startPriority++,
    },
    {
      name: 'BastionAllowsAzureBalancerInbound',
      sourceAddressPrefix: 'AzureLoadBalancer',
      sourcePortRange: '*',
      destinationAddressPrefix: '*',
      destinationPortRange: '443',
      protocol: 'Tcp',
      access: 'Allow',
      direction: 'Inbound',
      priority: startPriority++,
    },
    {
      name: 'BastionAllowsHostCommunicationInbound',
      sourceAddressPrefix: 'VirtualNetwork',
      sourcePortRange: '*',
      destinationAddressPrefix: 'VirtualNetwork',
      destinationPortRanges: ['8080', '5710'],
      protocol: '*',
      access: 'Allow',
      direction: 'Inbound',
      priority: startPriority++,
    },
    {
      name: 'BastionAllowsVmSshRdpInbound',
      sourceAddressPrefix: subnetPrefix,
      sourcePortRange: '*',
      destinationAddressPrefix: 'VirtualNetwork',
      destinationPortRanges: ['22', '3389'],
      protocol: '*',
      access: 'Allow',
      direction: 'Inbound',
      priority: startPriority++,
    },
  );

  //Outbound
  rs.push(
    {
      name: 'BastionAllowsSshRdpOutbound',
      sourceAddressPrefix: '*',
      sourcePortRange: '*',
      destinationAddressPrefix: 'VirtualNetwork',
      destinationPortRanges: ['22', '3389'],
      protocol: '*',
      access: 'Allow',
      direction: 'Outbound',
      priority: startPriority++,
    },
    {
      name: 'BastionAllowsAzureCloudOutbound',
      sourceAddressPrefix: '*',
      sourcePortRange: '*',
      destinationAddressPrefix: 'AzureCloud',
      destinationPortRange: '443',
      protocol: 'Tcp',
      access: 'Allow',
      direction: 'Outbound',
      priority: startPriority++,
    },
    {
      name: 'BastionAllowsCommunicationOutbound',
      sourceAddressPrefix: 'VirtualNetwork',
      sourcePortRange: '*',
      destinationAddressPrefix: 'VirtualNetwork',
      destinationPortRanges: ['8080', '5710'],
      protocol: 'Tcp',
      access: 'Allow',
      direction: 'Outbound',
      priority: startPriority++,
    },
    // {
    //   name: "BastionAllowsHttpOutbound",
    //   sourceAddressPrefix: "*",
    //   sourcePortRange: "*",
    //   destinationAddressPrefix: "Internet",
    //   destinationPortRanges: ["80", "443"],
    //   protocol: "*",
    //   access: "Allow",
    //   direction: "Outbound",
    //   priority: startPriority++,
    // },
  );
  return rs;
}
