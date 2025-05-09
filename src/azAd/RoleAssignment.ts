import * as auth from '@pulumi/azure-native/authorization';
import * as pulumi from '@pulumi/pulumi';
import { getRoleDefinitionByName } from './helpers/rolesBuiltIn';

export interface RoleAssignmentArgs extends Omit<auth.RoleAssignmentArgs, 'roleDefinitionId'> {
  roleName: 'Owner' | 'Contributor' | 'Reader' | string;
}

export class RoleAssignment extends pulumi.ComponentResource<RoleAssignmentArgs> {
  constructor(name: string, args: RoleAssignmentArgs, opts?: pulumi.ComponentResourceOptions) {
    super('RoleAssignment', name, args, opts);

    const { roleName, ...props } = args;
    const role = getRoleDefinitionByName(roleName);

    new auth.RoleAssignment(
      name,
      {
        ...props,
        roleDefinitionId: role.id,
      },
      { ...opts, parent: this },
    );
  }
}
