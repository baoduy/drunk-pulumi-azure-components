import * as pulumi from '@pulumi/pulumi';
import { SecurityRuleBuilder } from './SecurityRuleBuilder';

export function getBasionSecurityRules({
  bastionAddressPrefix,
  startPriority = 300,
}: {
  bastionAddressPrefix: pulumi.Input<string>;
  startPriority?: number;
}) {
  return (
    new SecurityRuleBuilder()
      //Inbound
      .allowInbound('BastionAllowsHttpsInbound', {
        sourceAddressPrefix: 'Internet',
        sourcePortRange: '*',
        destinationAddressPrefix: bastionAddressPrefix,
        destinationPortRange: '443',
        protocol: 'Tcp',
      })
      .allowInbound('BastionAllowsGatewayManagerInbound', {
        sourceAddressPrefix: 'GatewayManager',
        sourcePortRange: '*',
        destinationAddressPrefix: '*',
        destinationPortRange: '443',
        protocol: 'Tcp',
      })
      .allowInbound('BastionAllowsAzureBalancerInbound', {
        sourceAddressPrefix: 'AzureLoadBalancer',
        sourcePortRange: '*',
        destinationAddressPrefix: '*',
        destinationPortRange: '443',
      })
      .allowInbound('BastionAllowsHostCommunicationInbound', {
        sourceAddressPrefix: 'VirtualNetwork',
        sourcePortRange: '*',
        destinationAddressPrefix: 'VirtualNetwork',
        destinationPortRanges: ['8080', '5710'],
        protocol: '*',
      })
      .allowInbound('BastionAllowsVmSshRdpInbound', {
        sourceAddressPrefix: bastionAddressPrefix,
        sourcePortRange: '*',
        destinationAddressPrefix: 'VirtualNetwork',
        destinationPortRanges: ['22', '3389'],
        protocol: '*',
      })

      //Outbound
      .allowOutbound('BastionAllowsSshRdpOutbound', {
        sourceAddressPrefix: '*',
        sourcePortRange: '*',
        destinationAddressPrefix: 'VirtualNetwork',
        destinationPortRanges: ['22', '3389'],
        protocol: '*',
      })
      .allowOutbound('BastionAllowsAzureCloudOutbound', {
        sourceAddressPrefix: '*',
        sourcePortRange: '*',
        destinationAddressPrefix: 'AzureCloud',
        destinationPortRange: '443',
      })
      .allowOutbound('BastionAllowsCommunicationOutbound', {
        sourceAddressPrefix: 'VirtualNetwork',
        sourcePortRange: '*',
        destinationAddressPrefix: 'VirtualNetwork',
        destinationPortRanges: ['8080', '5710'],
      })
      .build(startPriority)
  );
}

export function getAppGatewaySecurityRules({
  apiGatewayAddressPrefix,
  startPriority = 300,
}: {
  apiGatewayAddressPrefix: pulumi.Input<string>;
  startPriority?: number;
}) {
  return (
    new SecurityRuleBuilder()
      // Inbound
      .allowInbound('AllowInternetInGatewayHealth', {
        sourceAddressPrefix: 'Internet',
        sourcePortRange: '*',
        destinationAddressPrefix: apiGatewayAddressPrefix,
        destinationPortRanges: ['65200-65535'],
        protocol: 'Tcp',
        description: 'Allow Health check access from internet to Gateway',
      })
      .allowInbound('AllowHttpsInternetInGateway', {
        sourceAddressPrefix: 'Internet',
        sourcePortRange: '*',
        destinationAddressPrefix: apiGatewayAddressPrefix,
        destinationPortRange: '443',
        protocol: 'Tcp',
        description: 'Allow HTTPS access from internet to Gateway',
      })
      .allowInbound('AllowLoadBalancerInGateway', {
        sourceAddressPrefix: 'AzureLoadBalancer',
        sourcePortRange: '*',
        destinationAddressPrefix: apiGatewayAddressPrefix,
        destinationPortRange: '*',
        protocol: 'Tcp',
        description: 'Allow Load balancer to Gateway',
      })
      .build(startPriority)
  );
}
