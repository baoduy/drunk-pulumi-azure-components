export * from './rsRoleDefinition';

import { AppRegistration } from '../AppRegistration';
import { getGraphPermissions } from './graphBuiltIn';
import { RoleAssignment } from '../RoleAssignment';
import { azureEnv } from '../../helpers';
import { AzureResourceInfo } from '../../types';

export const createAzureDevOpsAppRegistration = (
  name: string,
  vaultInfo: AzureResourceInfo
) => {
  const graphAccess = getGraphPermissions({ name: 'User.Read', type: 'Scope' });

  const identity = new AppRegistration(name, {
    appType: 'native',
    servicePrincipal: { enabled: true },
    requiredResourceAccesses: [graphAccess],
    vaultInfo,
  });

  new RoleAssignment(
    name,
    {
      principalId: identity.servicePrincipalId!,
      principalType: 'ServicePrincipal',
      roleName: 'Owner',
      scope: azureEnv.defaultSubScope,
    },
    { dependsOn: identity, parent: this }
  );
};
