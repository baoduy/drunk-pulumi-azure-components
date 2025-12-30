import * as pulumi from '@pulumi/pulumi';
import { azureEnv } from '../../helpers';
import { FirewallPolicyBuilder } from './FirewallPolicyBuilder';

export function defaultDeniedPolicies(priority: number = 6001) {
  return new FirewallPolicyBuilder('default', { priority, action: 'Deny' })
    .addAppRule('deny-everything-else', {
      description: 'Default Deny Everything Else',
      protocols: [
        { protocolType: 'Http', port: 80 },
        { protocolType: 'Https', port: 443 },
        { protocolType: 'Mssql', port: 1433 },
      ],
      sourceAddresses: ['*'],
      targetFqdns: ['*'],
    })
    .build();
}

export function allowsCloudflareTunnels({
  name,
  priority,
  sourceAddresses,
  internalDestinationAddresses,
  internalDestinationPorts,
}: {
  name: string;
  priority: number;
  sourceAddresses: pulumi.Input<string>[];
  /**Allows tunnels access to these addresses only*/
  internalDestinationAddresses?: pulumi.Input<string>[];
  /**Allows tunnels access to these ports only*/
  internalDestinationPorts?: pulumi.Input<string>[];
}) {
  const builder = new FirewallPolicyBuilder(name, { priority, action: 'Allow' })
    .addNetRule('cf-tunnels-net', {
      description: 'Allows CF Tunnel to access to Cloudflare.',
      ipProtocols: ['TCP', 'UDP'],
      sourceAddresses,
      destinationAddresses: [
        '198.41.192.167',
        '198.41.192.67',
        '198.41.192.57',
        '198.41.192.107',
        '198.41.192.27',
        '198.41.192.7',
        '198.41.192.227',
        '198.41.192.47',
        '198.41.192.37',
        '198.41.192.77',
        '198.41.200.13',
        '198.41.200.193',
        '198.41.200.33',
        '198.41.200.233',
        '198.41.200.53',
        '198.41.200.63',
        '198.41.200.113',
        '198.41.200.73',
        '198.41.200.43',
        '198.41.200.23',
      ],
      destinationPorts: ['7844'],
    })
    .addAppRule('cf-tunnels-app', {
      description: 'Allows CF Tunnel to access to Cloudflare.',
      sourceAddresses,
      targetFqdns: ['*.argotunnel.com', '*.cftunnel.com', '*.cloudflareaccess.com', '*.cloudflareresearch.com'],
      protocols: [
        { protocolType: 'Https', port: 443 },
        { protocolType: 'Https', port: 7844 },
      ],
    });

  if (internalDestinationAddresses && internalDestinationPorts) {
    builder.addNetRule('cf-tunnels-internal', {
      description: 'Allows CF Tunnel to access to Internals.',
      ipProtocols: ['TCP'],
      sourceAddresses,
      destinationAddresses: internalDestinationAddresses,
      destinationPorts: internalDestinationPorts,
    });
  }
  return builder.build();
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
