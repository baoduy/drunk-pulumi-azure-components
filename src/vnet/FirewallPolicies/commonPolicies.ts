import * as pulumi from '@pulumi/pulumi';
import { azureEnv } from '../../helpers';
import { FirewallPolicyBuilder } from './FirewallPolicyBuilder';

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

/** These rules are not required for Private AKS */
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
  return (
    new FirewallPolicyBuilder(name, { priority, action: 'Allow' })
      //Net
      .addNetRule('aks-udp', {
        description: 'For tunneled secure communication between the nodes and the control plane.',
        ipProtocols: ['UDP'],
        sourceAddresses: subnetAddressSpaces,
        destinationAddresses: [`AzureCloud.${azureEnv.currentRegionCode}`],
        destinationPorts: ['1194'],
      })
      .addNetRule('aks-tcp', {
        description: 'For tunneled secure communication between the nodes and the control plane.',
        ipProtocols: ['TCP'],
        sourceAddresses: subnetAddressSpaces,
        destinationAddresses: [`AzureCloud.${azureEnv.currentRegionCode}`],
        destinationPorts: ['9000'],
      })
      //App
      .addAppRule('aks-allow-acrs', {
        description: 'Allows pods to access AzureKubernetesService',
        sourceAddresses: subnetAddressSpaces,
        fqdnTags: [
          `*.hcp.${azureEnv.currentRegionCode}.azmk8s.io`,
          'mcr.microsoft.com',
          '*.data.mcr.microsoft.com',
          'mcr-0001.mcr-msedge.net',
          'management.azure.com',
          'login.microsoftonline.com',
          'packages.microsoft.com',
          'acs-mirror.azureedge.net',
          'packages.aks.azure.com',
        ],
        protocols: [{ protocolType: 'Https', port: 443 }],
      })
  );
}
