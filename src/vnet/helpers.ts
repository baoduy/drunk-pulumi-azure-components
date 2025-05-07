export const getVnetIdFromSubnetId = (subnetId: string) => {
  //The sample SubnetId is /subscriptions/63a31b41-eb5d-4160-9fc9-d30fc00286c9/resourceGroups/sg-dev-aks-vnet/providers/Microsoft.Network/virtualNetworks/sg-vnet-trans/subnets/aks-main-nodes
  return subnetId.split('/subnets')[0];
};

export const getSubnetNameFromId = (subnetId: string) => {
  //The sample SubnetId is /subscriptions/63a31b41-eb5d-4160-9fc9-d30fc00286c9/resourceGroups/sg-dev-aks-vnet/providers/Microsoft.Network/virtualNetworks/sg-vnet-trans/subnets/aks-main-nodes
  return subnetId.split('/subnets')[1];
};

export const getRsNameFromId = (resourceId: string) => {
  resourceId = resourceId.trim();
  //Resource ID
  if (resourceId.includes('/')) {
    return resourceId.split('/').pop();
  }
  //Domain
  if (resourceId.includes('.')) return resourceId.split('.')[0];
  //If not just get last 25 character
  return resourceId.slice(-25);
};

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
