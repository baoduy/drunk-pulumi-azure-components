import * as automation from '@pulumi/azure-native/automation';
import * as pulumi from '@pulumi/pulumi';
import { UserAssignedIdentity } from '../azAd';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import * as types from '../types';

export interface AutomationArgs
  extends CommonBaseArgs,
    types.WithUserAssignedIdentity,
    types.WithEncryptionEnabler,
    Pick<automation.AutomationAccountArgs, 'sku'> {}

export class Automation extends BaseResourceComponent<AutomationArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: AutomationArgs, opts?: pulumi.ComponentResourceOptions) {
    super('Automation', name, args, opts);

    const { rsGroup, enableEncryption, groupRoles, defaultUAssignedId, ...props } = args;
    const uAssignedId = this.createUAssignedId();
    const encryptionKey = args.enableEncryption ? this.getEncryptionKey() : undefined;

    const auto = new automation.AutomationAccount(
      name,
      {
        ...props,
        ...rsGroup,
        publicNetworkAccess: false,
        disableLocalAuth: true,

        identity: {
          type: automation.ResourceIdentityType.SystemAssigned_UserAssigned,
          userAssignedIdentities: defaultUAssignedId ? [uAssignedId.id, defaultUAssignedId.id] : [uAssignedId.id],
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
    const { rsGroup, groupRoles, vaultInfo } = this.args;
    return new UserAssignedIdentity(
      this.name,
      { rsGroup, vaultInfo, memberof: groupRoles ? [groupRoles.contributor] : undefined },
      { dependsOn: this.opts?.dependsOn, parent: this },
    );
  }
}
