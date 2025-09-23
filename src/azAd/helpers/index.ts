export * from './rsRoleDefinition';

// import { azureEnv } from '../../helpers';
// import { ResourceInputs } from '../../types';
// import { AppRegistration } from '../AppRegistration';
// import { RoleAssignment } from '../RoleAssignment';
// import { getGraphPermissions } from './graphBuiltIn';

// export const createAzureDevOpsAppRegistration = (name: string, vaultInfo: ResourceInputs) => {
//   const graphAccess = getGraphPermissions({ name: 'User.Read', type: 'Scope' });
//
//   const identity = new AppRegistration(name, {
//     appType: 'native',
//     requiredResourceAccesses: [graphAccess],
//     vaultInfo,
//   });
//
//   new RoleAssignment(
//     name,
//     {
//       principalId: identity.servicePrincipalId!,
//       principalType: 'ServicePrincipal',
//       roleName: 'Owner',
//       scope: azureEnv.defaultSubScope,
//     },
//     { dependsOn: identity, deletedWith: identity, parent: this },
//   );
// };
