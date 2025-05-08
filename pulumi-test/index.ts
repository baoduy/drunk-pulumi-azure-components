import {
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

  const publicIpAddress = new IpAddresses('ip', {
    rsGroup,
    ipAddresses: [{ name: 'primary' }, { name: 'management' }, { name: 'basion' }],
    sku: { name: 'Standard', tier: 'Regional' },
  });

  const vnet = new HubVnet(
    'hub',
    {
      rsGroup,
      publicIpAddresses: [publicIpAddress.ipAddresses['primary']],
      securityGroup: {},
      basion: {
        sku: 'Basic',
        subnetPrefix: '192.168.4.0/24',
        publicIPAddress: publicIpAddress.ipAddresses['basion'],
      },
      natGateway: { sku: 'Standard' },
      firewall: {
        subnetPrefix: '192.168.2.0/24',
        sku: { name: 'AZFW_VNet', tier: 'Standard' },
        managementPublicIpAddress: publicIpAddress.ipAddresses['management'],
        managementSubnetPrefix: '192.168.3.0/24',
        policy: {},
      },
      vnet: {
        //defaultOutboundAccess: false,
        subnets: [
          { subnetName: 'primary', addressPrefix: '192.168.0.0/24' },
          { subnetName: 'secondary', addressPrefix: '192.168.1.0/24' },
        ],
      },
    },
    { dependsOn: [rsGroup, userAssignedId] },
  );

  return {
    rsGroup: rsGroup.PickOutputs('resourceGroupName', 'location'),
    envRole: groupRoles.PickOutputs('admin', 'contributor', 'readOnly'),
    subnets: vnet.subnets,
  };
})();

export default pulumi.output(rs);
