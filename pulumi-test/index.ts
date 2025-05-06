import * as pulumi from '@pulumi/pulumi';
import {
  RsGroup,
  UserAssignedIdentity,
  GroupRole,
  rsRoleDefinitions,
  KeyVault,
  Postgres,
} from '@drunk-pulumi/azure-components';

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

  return {
    rsGroup: rsGroup.PickOutputs('resourceGroupName', 'location'),
    envRole: groupRoles.PickOutputs('admin', 'contributor', 'readOnly'),
  };
})();

export default pulumi.output(rs);
