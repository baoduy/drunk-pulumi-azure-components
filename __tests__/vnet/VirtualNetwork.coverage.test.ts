import type { VnetArgs } from '../../src/vnet/VirtualNetwork';
import { Captured, restoreStack, withStack, settle } from '../testUtils/pulumiMocks';

/**
 * DRK-1922 Build coverage: `Vnet` had no unit test before the flow-log ATs. These pin today's behaviour of
 * the optional child resources (security group, NAT gateway, public IPs, firewall, bastion, VPN gateway,
 * peering, private DNS links) so the touched class meets the coverage gate.
 */

jest.setTimeout(30_000);

const RS_GROUP = { resourceGroupName: 'rg-net', location: 'southeastasia' };
const APP_SUBNET = { subnetName: 'app', addressPrefix: '10.0.1.0/24' };
const PEER_VNET = {
  id: '/subscriptions/sub/resourceGroups/rg-spoke/providers/Microsoft.Network/virtualNetworks/spoke',
  resourceName: 'spoke',
  resourceGroupName: 'rg-spoke',
};
const DNS_ZONE = {
  id: '/subscriptions/sub/resourceGroups/rg-dns/providers/Microsoft.Network/privateDnsZones/privatelink.blob.core.windows.net',
  resourceName: 'privatelink.blob.core.windows.net',
  resourceGroupName: 'rg-dns',
};

async function deploy(name: string, args: Omit<VnetArgs, 'rsGroup'>) {
  const { pulumi, Vnet, captured } = withStack(
    'dev',
    (p) => ({ pulumi: p, Vnet: require('../../src/vnet/VirtualNetwork').Vnet }),
    // Firewall reads its private IP back off its own resource state.
    ({ type }) =>
      type === 'azure-native:network:AzureFirewall' ? { ipConfigurations: [{ privateIPAddress: '10.0.0.4' }] } : {},
  );
  const vnet = new Vnet(name, { rsGroup: RS_GROUP, ...args });
  await settle(pulumi, vnet.vnet.id);
  // Let fire-and-forget children (firewall policy, output registration) settle before the next `withStack`.
  await new Promise((resolve) => setTimeout(resolve, 50));

  const byType = (type: string) => (captured as Captured[]).filter((c) => c.type === type);
  const subnet = (subnetName: string) =>
    byType('azure-native:network:Subnet').find((c) => c.name === `${name}-${subnetName}`)?.inputs;
  return { vnet, byType, subnet };
}

describe('Vnet — optional child resources (coverage)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  beforeEach(() => jest.spyOn(console, 'log').mockImplementation(() => undefined));
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('security group, NAT gateway, bastion, VPN gateway, peering and DNS links are created when asked for', async () => {
    const { vnet, byType, subnet } = await deploy('hub', {
      securityGroupCreate: { securityRules: [] },
      natGatewayCreate: { sku: 'Standard' },
      basion: { sku: 'Basic', subnetPrefix: '10.0.2.0/26' },
      vpnGatewayCreate: { sku: 'VpnGw1', subnetPrefix: '10.0.3.0/27', publicIPAddress: { id: 'vpn-ip' } },
      vnet: {
        subnets: [{ ...APP_SUBNET }],
        peeringCreate: { vnet: PEER_VNET, direction: 'Unidirectional' },
        privateZonesLinks: [DNS_ZONE],
      },
    });

    const nsg = byType('azure-native:network:NetworkSecurityGroup');
    expect(nsg).toHaveLength(1);
    expect(nsg[0].inputs.securityRules.length).toBeGreaterThan(0);

    const nat = byType('azure-native:network:NatGateway');
    expect(nat).toHaveLength(1);
    expect(nat[0].inputs.sku).toEqual({ name: 'Standard' });
    expect(byType('azure-native:network:PublicIPAddress').map((c) => c.name)).toContain('hub-ip-default-ip');

    expect(subnet('app').natGateway).toEqual({ id: 'hub-ngw_id' });
    expect(subnet('app').networkSecurityGroup).toEqual({ id: 'hub-nsg_id' });
    expect(subnet('AzureBastionSubnet').addressPrefix).toBe('10.0.2.0/26');
    expect(subnet('AzureBastionSubnet').natGateway).toBeUndefined();
    expect(subnet('GatewaySubnet').addressPrefix).toBe('10.0.3.0/27');
    expect(subnet('GatewaySubnet').networkSecurityGroup).toBeUndefined();

    expect(byType('azure-native:network:BastionHost')).toHaveLength(1);
    expect(byType('azure-native:network:VirtualNetworkGateway')).toHaveLength(1);
    expect(byType('azure-native:network:VirtualNetworkPeering')).toHaveLength(1);

    const links = byType('azure-native:privatedns:VirtualNetworkLink');
    expect(links).toHaveLength(1);
    expect(links[0].inputs.privateZoneName).toBe('privatelink.blob.core.windows.net');
    expect(links[0].inputs.resourceGroupName).toBe('rg-dns');

    const outputs = vnet.getOutputs();
    expect(outputs.securityGroup).toBeDefined();
    expect(outputs.natGateway).toBeDefined();
    expect(outputs.vpnGateway).toBeDefined();
    expect(vnet.basion).toBeDefined();
    expect(Object.keys(outputs.subnets).sort()).toEqual(['AzureBastionSubnet', 'GatewaySubnet', 'app']);
  });

  test('a Basic firewall gets its subnets, an internet route and a management IP; NAT is moved off the app subnet', async () => {
    const { vnet, byType, subnet } = await deploy('fwhub', {
      natGatewayCreate: { sku: 'Standard' },
      firewallCreate: {
        sku: { name: 'AZFW_VNet', tier: 'Basic' },
        policy: {},
        subnetPrefix: '10.0.4.0/26',
        managementSubnetPrefix: '10.0.5.0/26',
      },
      vnet: { subnets: [{ ...APP_SUBNET }] },
    });

    expect(subnet('AzureFirewallSubnet').addressPrefix).toBe('10.0.4.0/26');
    expect(subnet('AzureFirewallSubnet').natGateway).toEqual({ id: 'fwhub-ngw_id' });
    expect(subnet('AzureFirewallManagementSubnet').addressPrefix).toBe('10.0.5.0/26');
    expect(subnet('app').natGateway).toBeUndefined();

    const route = byType('azure-native:network:Route').find((c) => c.name === 'fwhub-tb-Internet')!.inputs;
    expect(route).toMatchObject({ routeName: 'Internet', addressPrefix: '0.0.0.0/0', nextHopType: 'Internet' });
    expect(byType('azure-native:network:PublicIPAddress').map((c) => c.name)).toContain('fwhub-mag-ip-mag-ip');

    const firewall = byType('azure-native:network:AzureFirewall');
    expect(firewall).toHaveLength(1);
    expect(firewall[0].inputs.managementIpConfiguration.name).toBe('fwhub-fw-management');
    expect(vnet.getOutputs().firewall).toBeDefined();
  });

  test('a firewall with caller public IPs links each IP and puts the subnet on the first config only', async () => {
    const { byType } = await deploy('fwips', {
      publicIpAddresses: [
        { id: 'ip-1', resourceName: 'ip1', resourceGroupName: 'rg-net' },
        { id: 'ip-2', resourceName: 'ip2', resourceGroupName: 'rg-net' },
      ],
      firewallCreate: { sku: { name: 'AZFW_VNet', tier: 'Standard' }, policy: {}, subnetPrefix: '10.0.4.0/26' },
      vnet: { subnets: [{ ...APP_SUBNET }] },
    });

    const configs = byType('azure-native:network:AzureFirewall')[0].inputs.ipConfigurations;
    expect(configs.map((c: any) => c.name)).toEqual(['fwips-ip1-ip-config', 'fwips-ip2-ip-config']);
    expect(configs[0].subnet).toEqual({ id: 'fwips-AzureFirewallSubnet_id' });
    expect(configs[1].subnet).toBeUndefined();
    expect(byType('azure-native:network:PublicIPAddress')).toHaveLength(0);
  });

  test('a NAT gateway without any public IP throws', () => {
    const { Vnet } = withStack('dev', () => ({ Vnet: require('../../src/vnet/VirtualNetwork').Vnet }));

    expect(
      () =>
        new Vnet('natless', {
          rsGroup: RS_GROUP,
          publicIpAddresses: [],
          natGatewayCreate: { sku: 'Standard' },
          vnet: { subnets: [{ ...APP_SUBNET }] },
        }),
    ).toThrow('PublicIpAddresses is required when NatGateway is created');
  });
});
