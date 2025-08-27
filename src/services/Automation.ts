import * as automation from '@pulumi/azure-native/automation';
import * as pulumi from '@pulumi/pulumi';
import { UserAssignedIdentity, UserAssignedIdentityArgs } from '../azAd';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import * as types from '../types';

export interface AutomationArgs
  extends CommonBaseArgs,
    types.WithUserAssignedIdentity,
    types.WithEncryptionEnabler,
    Partial<Pick<automation.AutomationAccountArgs, 'sku'>>,
    Omit<UserAssignedIdentityArgs, types.CommonProps | 'memberof'> {
  memberof?: types.GroupRoleTypes;
}

export class Automation extends BaseResourceComponent<AutomationArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: AutomationArgs, opts?: pulumi.ComponentResourceOptions) {
    super('Automation', name, args, opts);

    const { rsGroup, enableEncryption, defaultUAssignedId } = args;
    const uAssignedId = this.createUAssignedId();
    const encryptionKey = enableEncryption ? this.getEncryptionKey() : undefined;

    const auto = new automation.AutomationAccount(
      name,
      {
        ...rsGroup,
        automationAccountName: name,
        sku: { name: 'Free' },
        publicNetworkAccess: false,
        disableLocalAuth: true,

        identity: {
          type: automation.ResourceIdentityType.UserAssigned,
          userAssignedIdentities: [uAssignedId.id],
        },

        encryption: {
          keySource: encryptionKey ? 'Microsoft.Keyvault' : 'Microsoft.Automation',
          identity: encryptionKey ? { userAssignedIdentity: defaultUAssignedId?.id ?? uAssignedId.id } : undefined,
          keyVaultProperties: encryptionKey
            ? {
                keyName: encryptionKey.keyName,
                keyvaultUri: encryptionKey.vaultUrl,
                keyVersion: encryptionKey.version,
              }
            : undefined,
        },
      },
      { ...opts, dependsOn: encryptionKey ? [uAssignedId, encryptionKey] : uAssignedId, parent: this },
    );

    this.id = auto.id;
    this.resourceName = auto.name;

    this.registerOutputs();
  }

  public getOutputs() {
    return {
      id: this.id,
      resourceName: this.resourceName,
    };
  }

  private createUAssignedId() {
    const { rsGroup, groupRoles, vaultInfo, federations, memberof } = this.args;
    return new UserAssignedIdentity(
      `${this.name}-auto`,
      { rsGroup, vaultInfo, federations, memberof: groupRoles ? [groupRoles[memberof ?? 'contributor']] : undefined },
      { dependsOn: this.opts?.dependsOn, parent: this },
    );
  }
}
