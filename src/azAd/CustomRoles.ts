import * as auth from '@pulumi/azure-native/authorization';
import * as pulumi from '@pulumi/pulumi';
import { BaseComponent } from '../base/BaseComponent';
import { getComponentResourceType } from '../base/helpers';
import { azureEnv } from '../helpers';

export interface CustomRoleArgs {
  enableJustInTimeRemoteRole?: boolean;
}

export class CustomRoles extends BaseComponent<CustomRoleArgs> {
  constructor(name: string, args: CustomRoleArgs, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('CustomRoles'), name, args, opts);

    if (args.enableJustInTimeRemoteRole) {
      this.createJustInTimeRemoteRole();
    }
  }

  public getOutputs() {
    return {};
  }

  private createJustInTimeRemoteRole() {
    return new auth.RoleDefinition('JustInTime-User-Remote-Request', {
      roleName: 'Just-In-Time-User-Remote-Request-Role',
      description: 'Just-in-time virtual machine user remote request role',
      scope: azureEnv.defaultSubScope,
      permissions: [
        {
          actions: [
            'Microsoft.Security/locations/jitNetworkAccessPolicies/initiate/action',
            'Microsoft.Security/locations/jitNetworkAccessPolicies/*/read',
            'Microsoft.Security/policies/read',
            'Microsoft.Compute/virtualMachines/read',
            'Microsoft.Network/networkInterfaces/*/read',
          ],
          notActions: [],
        },
      ],
      assignableScopes: [azureEnv.defaultSubScope],
    });
  }
}
