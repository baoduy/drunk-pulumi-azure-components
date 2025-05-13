import { GroupRole, IpAddresses, ResourceBuilder, rsRoleDefinitions } from '@drunk-pulumi/azure-components';
import * as pulumi from '@pulumi/pulumi';

const rs = (async () => {
  const groupRoles = new GroupRole('az-test', {
    admin: { members: ['ffea11ca-4e3f-476e-bc59-9fbc7b5768e4', '1415bde0-bd92-413b-a352-5f9d7af441c9'] },
    owners: ['ffea11ca-4e3f-476e-bc59-9fbc7b5768e4', '1415bde0-bd92-413b-a352-5f9d7af441c9'],
    preventDuplicateNames: true,
  });

  const rs = new ResourceBuilder(
    'common',
    {
      vault: { sku: 'standard' },
      enableDefaultUAssignId: true,
      enableDiskEncryption: true,
      logs: {
        retentionInDays: 30,
        storage: { enabled: true },
        workspace: { enabled: false },
      },
      groupRoles,
      roleAssignments: [rsRoleDefinitions.rsGroup.getReadOnly(), rsRoleDefinitions.keyVault],
    },
    { dependsOn: groupRoles },
  );

  const ipAddress = new IpAddresses(
    'ip',
    {
      ...rs,
      sku: { name: 'Standard' },
      ipAddresses: [{ name: 'outbound' }],
    },
    { dependsOn: rs },
  );

  // const hub = new HubVnet(
  //   'env',
  //   {
  //     rsGroup,
  //     securityGroup: {},
  //     publicIpAddresses: [ipAddress.ipAddresses.outbound],
  //     natGateway: { sku: 'Standard' },
  //     vnet: {
  //       addressPrefixes: ['192.168.1.0/24'],
  //       defaultOutboundAccess: false,
  //       subnets: [{ subnetName: 'aks', addressPrefix: '192.168.1.0/25' }],
  //     },
  //   },
  //   { dependsOn: [rsGroup, userAssignedId] },
  // );

  // const aks = new AzKubernetes(
  //   'aks',
  //   {
  //     rsGroup,
  //     vaultInfo: vaultInfo,
  //     sku: 'Standard',
  //     features: { enablePrivateCluster: true },
  //     agentPoolProfiles: [
  //       {
  //         name: 'defaultpool',
  //         enableAutoScaling: true,
  //         minCount: 1,
  //         maxCount: 3,
  //         mode: 'System',
  //         type: 'VirtualMachineScaleSets',
  //         vmSize: 'Standard_D2as_v4',
  //         osDiskSizeGB: 128,
  //         osType: 'Linux',
  //         vnetSubnetID: hub.subnets.aks.id,
  //       },
  //     ],
  //     network: {
  //       outboundType: 'userDefinedRouting',
  //     },
  //   },
  //   { dependsOn: [rsGroup, hub, userAssignedId, ipAddress, vaultInfo] },
  // );

  return {
    rsGroup: rs.getOutputs(),
    envRole: groupRoles.getOutputs(),
  };
})();

export default pulumi.output(rs);
