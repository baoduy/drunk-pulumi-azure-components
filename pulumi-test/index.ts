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

  const hub = new HubVnet(
    'hub',
    {
      rsGroup,
      securityGroup: {},
      vnet: {
        addressPrefixes: ['192.168.1.0/25'],
        //defaultOutboundAccess: false,
        subnets: [
          { subnetName: 'primary', addressPrefix: '192.168.1.0/26' },
          { subnetName: 'secondary', addressPrefix: '192.168.1.64/26' },
        ],
      },
    },
    { dependsOn: [rsGroup, userAssignedId] },
  );

  const spoke = new HubVnet(
    'spoke',
    {
      rsGroup,
      securityGroup: {},
      vnet: {
        addressPrefixes: ['192.168.1.128/25'],
        //defaultOutboundAccess: false,
        subnets: [
          { subnetName: 'primary', addressPrefix: '192.168.1.128/26' },
          { subnetName: 'secondary', addressPrefix: '192.168.1.192/26' },
        ],
      },
      vnetPeering: { vnet: hub.vnet, direction: 'Bidirectional' },
    },
    { dependsOn: [rsGroup, userAssignedId, hub] },
  );

  return {
    rsGroup: rsGroup.PickOutputs('resourceGroupName', 'location'),
    envRole: groupRoles.PickOutputs('admin', 'contributor', 'readOnly'),
    //subnets: vnet.subnets,
  };
})();

export default pulumi.output(rs);
