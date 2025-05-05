import * as pulumi from '@pulumi/pulumi';
import {
  RsGroup,
  UserAssignedIdentity,
  GroupRole,
  rsRoleDefinitions,
  KeyVault,
  StorageAccount,
  Logs,
} from '@drunk-pulumi/azure-components';

const rs = (async () => {
  const envRole = new GroupRole('az-test', { preventDuplicateNames: true });
  const group = new RsGroup(
    'common',
    {
      lock: false,
      groupRoles: envRole,
      roleAssignments: [rsRoleDefinitions.rsGroup.getReadOnly(), rsRoleDefinitions.keyVault],
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
      memberof: [envRole.readOnly],
    },
    { dependsOn: [group, envRole, vault] },
  );

  const logs = new Logs(
    'log',
    {
      rsGroup: group,
      retentionInDays: 30,
      storage: { enabled: true },
      workspace: { enabled: true, appInsightEnabled: true, sku: 'PerGB2018' },
      vaultInfo: vault,
    },
    { dependsOn: [group, vault] },
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
      policies: { staticWebsite: { enabled: true } },
      containers: {
        containers: [{ name: 'test' }],
        fileShares: ['test'],
        queues: ['test'],
      },
    },
    { dependsOn: [group, envRole, userAssignedId, vault] },
  );

  return {
    rsGroup: group.PickOutputs('resourceGroupName', 'location'),
    envRole: envRole.PickOutputs('admin', 'contributor', 'readOnly'),
  };
})();

export default pulumi.output(rs);
