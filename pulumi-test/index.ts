import * as pulumi from '@pulumi/pulumi';
import { PGPGenerator } from '@drunk-pulumi/azure-components';

const rs = (async () => {
  //const group = new azure.resources.ResourceGroup('common');
  const rs = new PGPGenerator('dev-pgp', {
    user: {
      name: 'DrunkCoding',
      email: 'drunk@coding.net'
    },
    passphrase: 'password',
    vaultInfo: {
      name: 'global-drunkcoding-vlt',
      rsGroupInfo: {
        resourceGroupName: 'global-grp-drunkcoding'
      }
    }
  });

  return rs;
})();

export default pulumi.output(rs);
