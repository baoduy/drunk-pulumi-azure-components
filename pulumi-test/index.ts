import * as pulumi from '@pulumi/pulumi';
import { SshGenerator } from '@drunk-pulumi/azure-components';

const rs = (async () => {
  //const group = new azure.resources.ResourceGroup('common');
  const rs = new SshGenerator('dev-pgp', {
    password: 'password', vaultInfo: {
      name: 'global-drunkcoding-vlt',
      rsGroupInfo: {
        resourceGroupName: 'global-grp-drunkcoding'
      }
    }
  });

  return rs;
})();

export default pulumi.output(rs);
