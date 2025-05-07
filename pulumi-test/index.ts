import {
  AzSql,
  GroupRole,
  KeyVault,
  Logs,
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

  const logs = new Logs(
    'logs',
    {
      rsGroup,
      vaultInfo,
      retentionInDays: 7,
      storage: { enabled: true },
    },
    { dependsOn: [rsGroup, groupRoles, vaultInfo] },
  );

  // const sql = new AzSql(
  //   'sql',
  //   {
  //     rsGroup,
  //     vaultInfo,
  //     defaultUAssignedId: userAssignedId,
  //     administratorLogin: 'azure-test-sql-admin',
  //     administrators: { adminGroup: groupRoles.contributor, useDefaultUAssignedIdForConnection: true },
  //     enableEncryption: true,
  //     vulnerabilityAssessment: {
  //       alertEmails: ['steven@drunkcoding.net'],
  //       logStorage: { id: logs.storage!.id, resourceName: logs.storage!.resourceName, rsGroup },
  //     },
  //     elasticPool: { sku: { name: 'BasicPool', tier: 'Basic', capacity: 50 } },
  //     databases: { 'test-db': { autoPauseDelay: 10, sku: { name: 'Basic', capacity: 0 } } },
  //     lock: false,
  //   },
  //   { dependsOn: [rsGroup, groupRoles, vaultInfo, logs] },
  // );

  return {
    rsGroup: rsGroup.PickOutputs('resourceGroupName', 'location'),
    envRole: groupRoles.PickOutputs('admin', 'contributor', 'readOnly'),
  };
})();

export default pulumi.output(rs);
