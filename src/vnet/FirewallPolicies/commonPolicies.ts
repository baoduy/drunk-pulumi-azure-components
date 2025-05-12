import { azureEnv } from '../../helpers';
import { FirewallPolicyBuilder } from './FirewallPolicyBuilder';
import * as pulumi from '@pulumi/pulumi';

export function getDefaultPolicies(priority: number = 6001) {
  return new FirewallPolicyBuilder('default', { priority, action: 'Deny' }).addAppRule('deny-everything-else', {
    description: 'Default Deny Everything Else',
    protocols: [
      { protocolType: 'Http', port: 80 },
      { protocolType: 'Https', port: 443 },
      { protocolType: 'Mssql', port: 1433 },
    ],
    sourceAddresses: ['*'],
    targetFqdns: ['*'],
  });
}

export function getAksPolicies(
  name: string,
  {
    priority,
    subnetAddressSpaces,
  }: {
    priority: number;
    subnetAddressSpaces: Array<pulumi.Input<string>>;
    /** the name of Azure Container registry allows access from Azure AKS */
    allowsAcrs?: pulumi.Input<string>[];
  },
) {
  return new FirewallPolicyBuilder(name, { priority, action: 'Allow' })
    .addNetRule('aks-vpn', {
      description: 'For OPEN VPN tunneled secure communication between the nodes and the control plane for AzureCloud',
      ipProtocols: ['UDP'],
      sourceAddresses: subnetAddressSpaces,
      destinationAddresses: [`AzureCloud.${azureEnv.currentRegionCode}`],
      destinationPorts: ['1194'],
    })
    .addNetRule('aks-tcp', {
      description: 'For tunneled secure communication between the nodes and the control plane for AzureCloud',
      ipProtocols: ['TCP'],
      sourceAddresses: subnetAddressSpaces,
      destinationAddresses: [`AzureCloud.${azureEnv.currentRegionCode}`],
      destinationPorts: [],
    });
}
