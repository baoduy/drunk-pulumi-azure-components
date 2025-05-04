import * as pulumi from '@pulumi/pulumi';
import {
  RsGroup,
  UserAssignedIdentity,
  GroupRole,
  rsRoleDefinitions,
  KeyVault,
} from '@drunk-pulumi/azure-components';

const rs = (async () => {
  const envRole = new GroupRole();
  const group = new RsGroup(
    'common',
    {
      lock: false,
      roleAssignment: {
        groupRole: envRole,
        roleDefinitions: [
          rsRoleDefinitions.rsGroup.getReadOnly(),
          rsRoleDefinitions.keyVault.getContributor(),
        ],
      },
    },
    { dependsOn: envRole },
  );

  const vault = new KeyVault(
    'vault',
    {
      rsGroup: group,
    },
    { dependsOn: group },
  );

  const rs = new UserAssignedIdentity(
    'azure-test',
    {
      rsGroup: group,
      vaultInfo: vault,
    },
    { dependsOn: group },
  );

  return {
    rsGroup: group.PickOutputs('resourceGroupName', 'location'),
    envRole: envRole.PickOutputs('admin', 'contributor', 'readOnly'),
  };
})();

export default pulumi.output(rs);
