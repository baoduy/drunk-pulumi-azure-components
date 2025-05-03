import * as pulumi from '@pulumi/pulumi';
import * as azure from '@pulumi/azure-native';
import { UserAssignedIdentity } from '@drunk-pulumi/azure-components';
import { AzureResourceInfo } from '@drunk-pulumi/azure-components/types';

const rs = (async () => {
  const group = new azure.resources.ResourceGroup('common');
  const vaultInfo: AzureResourceInfo = { name: 'global-drunkcoding-vlt', rsGroupInfo: { resourceGroupName: 'global-grp-drunkcoding' } };

  const rs = new UserAssignedIdentity('azure-test', { rsGroup: group, vaultInfo });
  return rs;
})();

export default pulumi.output(rs);
