import * as pulumi from '@pulumi/pulumi';
import { AppRegistration } from '@drunk-pulumi/azure-components/azureAd';

const rs = (async () => {
  //const group = new azure.resources.ResourceGroup('common');
  const rs = new AppRegistration('dev-app-test', {
    appType: 'singlePageApplication',
    redirectUris: ["https://drunkcoding.net/"],
    implicitGrant: {
      accessTokenIssuanceEnabled: true,
      idTokenIssuanceEnabled: true
    },
    enableClientSecret: true,
    servicePrincipal: { enabled: true, appRoleAssignmentRequired: true },
    appRoles: [{
      allowedMemberTypes: ['User'],
      displayName: 'User',
      description: 'User Role',
      id: '7f65d9ae-9b51-4001-93fa-35b0e79dd93a',
      value: 'User',
      enabled: true
    }],
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
