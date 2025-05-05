import * as pulumi from '@pulumi/pulumi';
import * as azAd from '@pulumi/azuread';
import * as types from '../types';
import { GroupRoleTypes } from '../azureAd';
import { VaultSecrets, SecretItemArgs, VaultSecretResult, EncryptionKey } from '../vault';

/**
 * Formats the component resource type to ensure it follows the drunk-pulumi naming convention
 * @param type - The resource type string
 * @returns Formatted resource type string with drunk-pulumi prefix if not already present
 */
export const getComponentResourceType = (type: string) =>
  type.includes('drunk-pulumi') ? type : `drunk-pulumi:index:${type}`;

/**
 * Base interface for resource component arguments
 * Combines vault information and resource group requirements
 */
export interface BaseArgs extends types.WithVaultInfo, types.WithGroupRolesArgs {}

export interface BaseArgsWithRsGroup extends BaseArgs, types.WithResourceGroupInputs {}

/**
 * Extended base component that handles Azure resources with vault integration
 * Provides secret management and resource group handling capabilities
 */
export abstract class BaseResourceComponent<TArgs extends BaseArgs> extends pulumi.ComponentResource {
  private _secrets: { [key: string]: pulumi.Input<string> } = {};
  private _vaultSecretsCreated: boolean = false;
  public vaultSecrets?: { [key: string]: VaultSecretResult };

  /**
   * Creates a new instance of BaseResourceComponent
   * @param type - The type of the resource component
   * @param name - The unique name of the resource component
   * @param args - Arguments containing vault and resource group information
   * @param opts - Optional component resource options
   */
  constructor(
    private type: string,
    public name: string,
    protected args: TArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    super(type, name, args, opts);
  }

  /**
   * Internal method to handle post-creation secret management
   * Creates vault secrets if any secrets were added during component creation
   */
  private postCreated() {
    const { vaultInfo } = this.args;
    if (Object.keys(this._secrets).length <= 0 || !vaultInfo) return;
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
      { parent: this },
    );

    this.vaultSecrets = rs.results;
  }

  /**
   * Adds a single secret to the component
   * Can be called multiple times to add different secrets
   * @param name - The name of the secret
   * @param value - The value to be stored in the secret
   */
  protected addSecret(name: string, value: pulumi.Input<string>) {
    this._secrets[name] = value;
  }

  /**
   * Adds multiple secrets to the component at once
   * Should only be called once as it replaces existing secrets
   * @param secrets - Object containing secret name-value pairs
   */
  protected addSecrets(secrets: { [key: string]: pulumi.Input<string> }) {
    this._secrets = { ...this._secrets, ...secrets };
  }

  /**
   * Registers component outputs including vault secrets
   * @param outputs - Optional additional outputs to register
   */
  protected registerOutputs(outputs?: pulumi.Inputs): void {
    this.postCreated();
    super.registerOutputs({ ...outputs, vaultSecrets: this.vaultSecrets });
  }

  protected getEncryptionKey() {
    if (!this.args.vaultInfo) return undefined;
    return new EncryptionKey(this.name, { vaultInfo: this.args.vaultInfo }, { parent: this });
  }

  public addIdentityToRole(type: GroupRoleTypes, identity: pulumi.Output<{ principalId: string } | undefined>) {
    const { groupRoles } = this.args;
    if (!groupRoles) return;

    return identity.apply((i) => {
      if (!i?.principalId) return;
      return new azAd.GroupMember(`${this.name}-${type}-${i.principalId}`, {
        groupObjectId: groupRoles[type].objectId,
        memberObjectId: i.principalId,
      });
    });
  }

  /**
   * Selectively picks properties from the component instance
   * @param keys - Array of property keys to pick from the component
   * @returns Object containing only the selected properties
   */
  public PickOutputs<K extends keyof this>(...keys: K[]) {
    return keys.reduce((acc, key) => {
      acc[key] = (this as any)[key];
      return acc;
    }, {} as Pick<this, K>);
  }
}
