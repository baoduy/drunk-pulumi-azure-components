import * as pulumi from '@pulumi/pulumi';
import * as azure from '@pulumi/azure-native';
import { VaultSecret } from '@drunk-pulumi/azure-components';

const rs = (async () => {
  //const group = new azure.resources.ResourceGroup('common');
  const secret = new VaultSecret("dev-random", {
    value: "1234567890", contentType: "text/plain", vaultInfo: {
      name: "global-drunkcoding-vlt",
      rsGroupInfo: {
        resourceGroupName: "global-grp-drunkcoding",
      }
    }
  });

  return secret;
})();

export default pulumi.output(rs);
