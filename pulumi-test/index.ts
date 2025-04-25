import * as pulumi from '@pulumi/pulumi';
import * as azure from '@pulumi/azure-native';
import { PGPGenerator } from '@drunk-pulumi/azure-components';

const rs = (async () => {
  const group = new azure.resources.ResourceGroup('common');

  return {};
})();

export default pulumi.output(rs);
