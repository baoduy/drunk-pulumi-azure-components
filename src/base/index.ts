import * as pulumi from '@pulumi/pulumi';
import { WithVaultInfo, WithResourceGroup, ResourceGroupInfo } from '../types';
import { VaultSecrets, SecretItemArgs, VaultSecretResult } from '../vault';
import { ResourceGroup } from '@pulumi/azure-native/resources';

export const getComponentResourceType = (type: string) =>
  type.includes('drunk-pulumi') ? type : `drunk-pulumi:index:${type}`;

export abstract class BaseComponent extends pulumi.ComponentResource {
  constructor(
    type: string,
    name: string,
    args?: pulumi.Inputs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super(getComponentResourceType(type), name, args, opts);
  }

  public PickOutputs<K extends keyof this>(...keys: K[]) {
    return keys.reduce((acc, key) => {
      acc[key] = (this as any)[key];
      return acc;
    }, {} as Pick<this, K>);
  }
}

export interface BaseArgs extends WithVaultInfo, WithResourceGroup {}

export abstract class BaseResourceComponent<
  TArgs extends BaseArgs
> extends BaseComponent {
  private _secrets: { [key: string]: pulumi.Input<string> } = {};
  private _vaultSecretsCreated: boolean = false;
  public vaultSecrets?: { [key: string]: VaultSecretResult };

  constructor(
    private type: string,
    protected name: string,
    protected args: TArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super(type, name, args, opts);
  }

  private postCreated() {
    const { vaultInfo } = this.args;
    if (Object.keys(this._secrets).length <= 0 || !vaultInfo) return;
    //Ensure secrets only created once
    if (this._vaultSecretsCreated) return;

    const se: { [key: string]: SecretItemArgs } = {};
    for (const key in this._secrets) {
      se[key] = {
        value: this._secrets[key],
        contentType: `${this.type} ${key}`,
      };
    }

    this._vaultSecretsCreated = true;
    const rs = new VaultSecrets(
      this.name,
      {
        vaultInfo,
        secrets: se,
      },
      { parent: this }
    );

    this.vaultSecrets = rs.results;
  }

  protected getRsGroupInfo(): ResourceGroupInfo {
    const { rsGroup } = this.args;
    if (!rsGroup) throw new Error('Resource group is required.');
    if (rsGroup instanceof ResourceGroup)
      return { resourceGroupName: rsGroup.name, location: rsGroup.location };
    return rsGroup;
  }

  /** this methods allows to be called multiple times */
  protected addSecret(name: string, value: pulumi.Input<string>) {
    this._secrets[name] = value;
  }

  /** this methods allows to be called only one */
  protected addSecrets(secrets: { [key: string]: pulumi.Input<string> }) {
    this._secrets = { ...this._secrets, ...secrets };
  }

  protected registerOutputs(outputs?: pulumi.Inputs): void {
    this.postCreated();
    super.registerOutputs({ ...outputs, vaultSecrets: this.vaultSecrets });
  }
}
