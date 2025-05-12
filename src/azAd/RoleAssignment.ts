import * as auth from '@pulumi/azure-native/authorization';
import * as pulumi from '@pulumi/pulumi';
import { getRoleDefinitionByName } from './helpers/rolesBuiltIn';
import { BaseComponent } from '../base/BaseComponent';

export interface RoleAssignmentArgs extends Omit<auth.RoleAssignmentArgs, 'roleDefinitionId'> {
  roleName: 'Owner' | 'Contributor' | 'Reader' | string;
}

export class RoleAssignment extends BaseComponent<RoleAssignmentArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: RoleAssignmentArgs, opts?: pulumi.ComponentResourceOptions) {
    super('RoleAssignment', name, args, opts);

    const { roleName, ...props } = args;
    const role = getRoleDefinitionByName(roleName);

    const assignment = new auth.RoleAssignment(
      name,
      {
        ...props,
        roleDefinitionId: role.id,
      },
      { ...opts, parent: this },
    );

    this.id = assignment.id;
    this.resourceName = assignment.name;
    this.registerOutputs(this.getOutputs());
  }

  public getOutputs(): pulumi.Inputs | pulumi.Output<pulumi.Inputs> {
    return {
      id: this.id,
      resourceName: this.resourceName,
    };
  }
}
