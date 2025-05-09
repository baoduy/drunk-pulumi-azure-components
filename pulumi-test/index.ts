import {
  AzKubernetes,
  GroupRole,
  HubVnet,
  IpAddresses,
  KeyVault,
  RsGroup,
  rsRoleDefinitions,
  UserAssignedIdentity,
} from '@drunk-pulumi/azure-components';
import * as pulumi from '@pulumi/pulumi';

const rs = (async () => {
  const groupRoles = new GroupRole('az-test', {
    admin: { members: ['ffea11ca-4e3f-476e-bc59-9fbc7b5768e4', '1415bde0-bd92-413b-a352-5f9d7af441c9'] },
    owners: ['ffea11ca-4e3f-476e-bc59-9fbc7b5768e4', '1415bde0-bd92-413b-a352-5f9d7af441c9'],
    preventDuplicateNames: true,
  });

  const rsGroup = new RsGroup(
    'common',
    {
      lock: false,
      groupRoles,
      roleAssignments: [rsRoleDefinitions.rsGroup.getReadOnly(), rsRoleDefinitions.keyVault],
    },
    { dependsOn: groupRoles },
  );

  const vaultInfo = new KeyVault(
    'vault',
    {
      rsGroup,
    },
    { dependsOn: rsGroup },
  );

  const userAssignedId = new UserAssignedIdentity(
    'azure-test',
    {
      rsGroup,
      vaultInfo: vaultInfo,
      memberof: [groupRoles.readOnly],
    },
    { dependsOn: [rsGroup, groupRoles, vaultInfo] },
  );

  const ipAddress = new IpAddresses(
    'ip',
    {
      rsGroup,
      sku: { name: 'Standard' },
      ipAddresses: [{ name: 'outbound' }],
    },
    { dependsOn: rsGroup },
  );

  const hub = new HubVnet(
    'env',
    {
      rsGroup,
      securityGroup: {},
      publicIpAddresses: [ipAddress.ipAddresses.outbound],
      natGateway: { sku: 'Standard' },
      vnet: {
        addressPrefixes: ['192.168.1.0/24'],
        //defaultOutboundAccess: false,
        subnets: [{ subnetName: 'aks', addressPrefix: '192.168.1.0/25' }],
      },
    },
    { dependsOn: [rsGroup, userAssignedId] },
  );

  const aks = new AzKubernetes(
    'aks',
    {
      rsGroup,
      vaultInfo: vaultInfo,
      sku: 'Standard',
      features: { enablePrivateCluster: true },
      agentPoolProfiles: [
        {
          name: 'defaultpool',
          enableAutoScaling: true,
          minCount: 1,
          maxCount: 3,
          mode: 'System',
          type: 'VirtualMachineScaleSets',
          osDiskSizeGB: 128,
          osType: 'Linux',
          vnetSubnetID: hub.subnets.aks.id,
        },
      ],
    },
    { dependsOn: [rsGroup, hub, userAssignedId, vaultInfo] },
  );

  return {
    //rsGroup: rsGroup.PickOutputs('resourceGroupName', 'location'),
    //envRole: groupRoles.PickOutputs('admin', 'contributor', 'readOnly'),
    //subnets: vnet.subnets,
  };
})();

export default pulumi.output(rs);
