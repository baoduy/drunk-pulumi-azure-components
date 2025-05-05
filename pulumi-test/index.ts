import * as pulumi from '@pulumi/pulumi';
import {
  RsGroup,
  UserAssignedIdentity,
  GroupRole,
  rsRoleDefinitions,
  KeyVault,
  StorageAccount,
} from '@drunk-pulumi/azure-components';

const rs = (async () => {
  const envRole = new GroupRole('az-test', { preventDuplicateNames: true });
  const group = new RsGroup(
    'common',
    {
      lock: false,
      groupRoles: envRole,
      roleAssignments: [
        rsRoleDefinitions.rsGroup.getReadOnly(),
        rsRoleDefinitions.keyVault.getContributor(),
      ],
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

  const userAssignedId = new UserAssignedIdentity(
    'azure-test',
    {
      rsGroup: group,
      vaultInfo: vault,
      memberof: [envRole.readOnly.objectId],
    },
    { dependsOn: group },
  );

  const storage = new StorageAccount(
    'storage',
    {
      rsGroup: group,
      groupRoles: envRole,
      defaultUAssignedId: userAssignedId,
      vaultInfo: vault,
      //only able to enable after storage account is created
      enableEncryption: true,
      policies: { enableStaticWebsite: true },
      containers: {
        containers: [{ name: 'test' }],
        fileShares: ['test'],
        queues: ['test'],
      },
    },
    { dependsOn: group },
  );

  return {
    rsGroup: group.PickOutputs('resourceGroupName', 'location'),
    envRole: envRole.PickOutputs('admin', 'contributor', 'readOnly'),
  };
})();

export default pulumi.output(rs);
