import * as pulumi from '@pulumi/pulumi';
import {
  RsGroup,
  UserAssignedIdentity,
  GroupRole,
  rsRoleDefinitions,
} from '@drunk-pulumi/azure-components';
import { AzureResourceInfo } from '@drunk-pulumi/azure-components/types';

const rs = (async () => {
  const envRole = new GroupRole();
  const group = new RsGroup('common', {
    lock: true,
    roleAssignment: {
      azGroup: envRole,
      roleDefinitions: [rsRoleDefinitions.rsGroup, rsRoleDefinitions.aks],
    },
  });

  const vaultInfo: AzureResourceInfo = {
    name: 'global-drunkcoding-vlt',
    rsGroupInfo: { resourceGroupName: 'global-grp-drunkcoding' },
  };

  const rs = new UserAssignedIdentity('azure-test', {
    rsGroup: group,
    vaultInfo,
  });
  return rs;
})();

export default pulumi.output(rs);
