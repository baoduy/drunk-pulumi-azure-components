import * as privateDns from '@pulumi/azure-native/privatedns';
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

export const getPrivateRecordSetOutput = (args: privateDns.GetPrivateRecordSetOutputArgs) => {
  return privateDns.getPrivateRecordSetOutput(args);
};
