import * as azAd from '@pulumi/azuread';
import * as pulumi from '@pulumi/pulumi';
import * as types from '../types';

import { RandomPassword, RandomPasswordArgs } from '../common/RandomPassword';
import { RandomString, RandomStringArgs } from '../common/RandomString';
import { VaultSecretResult, VaultSecrets } from '../vault/VaultSecrets';

import { BaseComponent } from './BaseComponent';
import { EncryptionKey } from '../vault/EncryptionKey';
import { ResourceLocker } from '../common/ResourceLocker';
import { RoleAssignment } from '../azAd/RoleAssignment';
import { SecretItemArgs } from '../vault/VaultSecret';
import { getComponentResourceType } from './helpers';
import * as enums from '@pulumi/azure-native/types/enums';

/**
 * Base interface for resource component arguments that combines vault information
 * and Azure AD group role requirements.
 *
 * This interface extends:
 * - WithVaultInfo: Provides Azure Key Vault configuration
 * - WithGroupRolesArgs: Defines Azure AD group role assignments
 */
export interface BaseArgs extends types.WithVaultInfo, types.WithGroupRolesArgs {}

/**
 * Extended interface that includes resource group input parameters
 * alongside base vault and role requirements
 */
export interface CommonBaseArgs extends BaseArgs, types.WithResourceGroupInputs {}

/**
 * BaseResourceComponent serves as a foundational abstract class for Azure resource management
 * with integrated Key Vault capabilities. It provides:
 *
 * Key Features:
 * - Automated secret management with Azure Key Vault integration
 * - Resource group handling and organization
 * - Managed identity role assignments
 * - Resource locking capabilities
 * - Random string/password generation
 * - Encryption key management
 *
 * This component is designed to be extended by specific Azure resource implementations
 * that require secure secret management and standardized resource organization.
 *
 * @template TArgs - Type parameter extending BaseArgs to define required component arguments
 */
export abstract class BaseResourceComponent<TArgs extends BaseArgs> extends BaseComponent<TArgs> {
  public vaultSecrets?: { [key: string]: VaultSecretResult };
  private _secrets: { [key: string]: pulumi.Input<string> } = {};
  private _vaultSecretsCreated: boolean = false;

  /**
   * Creates a new instance of BaseResourceComponent
   * @param type - The type of the resource component
   * @param name - The unique name of the resource component
   * @param args - Arguments containing vault and resource group information
   * @param opts - Optional component resource options
   */
  protected constructor(
    private readonly type: string,
    public readonly name: string,
    protected readonly args: TArgs,
    protected readonly opts?: pulumi.ComponentResourceOptions,
  ) {
    super(getComponentResourceType(type), name, args, opts);
  }

  /**
   * Adds a managed identity to a specified Azure AD group role
   * @param type - The type of group role to add the identity to (from GroupRoleTypes enum)
   * @param identity - A Pulumi output containing the managed identity with its principal ID
   * @returns A new GroupMember resource if successful, undefined if groupRoles not configured or identity invalid
   */
  public addIdentityToRole(
    type: types.GroupRoleTypes,
    identity: pulumi.Input<{ principalId: pulumi.Input<string> } | undefined>,
  ) {
    const { groupRoles } = this.args;
    if (!groupRoles) return;

    return pulumi.output(identity).apply((i) => {
      if (!i?.principalId) return;
      return new azAd.GroupMember(
        `${this.name}-${type}-${i.principalId}`,
        {
          groupObjectId: groupRoles[type].objectId,
          memberObjectId: i.principalId,
        },
        { parent: this },
      );
    });
  }

  public getOutputs(): pulumi.Inputs | pulumi.Output<pulumi.Inputs> {
    return { vaultSecrets: this.vaultSecrets };
  }

  protected grantPermissionsToIdentity({ identity, resource, roleNames }: types.GrantIdentityRoles) {
    return pulumi.output(identity).apply((id) => {
      if (!id?.principalId) return;
      return pulumi.output(resource).apply((re) =>
        roleNames.map((r) =>
          pulumi.interpolate`${this.name}-${re!.resourceName}-${r}`.apply(
            (n) =>
              new RoleAssignment(
                n,
                {
                  principalId: id!.principalId,
                  principalType: 'ServicePrincipal',
                  roleName: r,
                  scope: re.id,
                },
                { parent: this, deletedWith: this },
              ),
          ),
        ),
      );
    });
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
   * Overwrote this method with no parameters as it will be provided by calling getOutputs method.
   */
  protected registerOutputs(): void {
    this.postCreated();
    super.registerOutputs();
  }

  /**
   * Creates a new encryption key in the Azure Key Vault
   * @returns A new EncryptionKey instance if vaultInfo is provided, undefined otherwise
   */
  protected getEncryptionKey({ name, keySize }: { name?: string; keySize?: 2048 | 3072 | 4096 } = { keySize: 4096 }) {
    const vault = this.args.vaultInfo;
    if (!vault) {
      throw new Error(`The VaultInfo is required for encryption key creation in component "${this.type}:${this.name}"`);
    }

    return new EncryptionKey(
      name ? `${this.name}-${name}` : this.name,
      { vaultInfo: vault, keySize },
      { dependsOn: this.opts?.dependsOn, parent: this },
    );
  }

  /**
   * Generates a new random password with predefined settings
   * @returns A new RandomPassword instance with 20 characters length, yearly rotation policy, and no special characters
   */
  protected createPassword(
    props: RandomPasswordArgs & { name?: string } = { length: 20, policy: 'yearly', options: { special: false } },
  ) {
    return new RandomPassword(props.name ?? this.name, props, { parent: this });
  }

  protected createRandomString(
    props: RandomStringArgs & { name?: string } = { type: 'string', length: 10, options: { special: false } },
  ) {
    return new RandomString(props.name ?? this.name, props, { parent: this });
  }

  protected lockFromDeleting(resource: pulumi.CustomResource) {
    return new ResourceLocker(
      `${this.name}-lock`,
      {
        resource,
        level: 'CanNotDelete',
      },
      { dependsOn: resource, parent: this },
    );
  }

  /**
   * Internal method to handle post-creation secret management
   * Creates vault secrets if any secrets were added during component creation
   */
  private postCreated() {
    const { vaultInfo } = this.args;
    if (this._vaultSecretsCreated || Object.keys(this._secrets).length <= 0 || !vaultInfo) return;

    console.log(`\nAdding secrets for ${this.type}:${this.name}`);

    const se: { [key: string]: SecretItemArgs } = {};
    for (const key in this._secrets) {
      se[key] = {
        value: this._secrets[key],
        contentType: `${this.type} ${this.name}`,
      };
    }

    this._vaultSecretsCreated = true;
    const rs = new VaultSecrets(
      this.name,
      {
        vaultInfo,
        secrets: se,
      },
      { dependsOn: this.opts?.dependsOn, parent: this },
    );

    this.vaultSecrets = rs.results;
  }

  /** Assigns a role to a principal at the scope of this resource.
   * @param roleName The name of the role to assign (e.g., "Contributor", "Reader").
   * @param principalType The type of the principal (e.g., "User", "Group", "ServicePrincipal").
   * @param principalId The ID of the principal to whom the role is assigned.
   * @returns A RoleAssignment resource representing the role assignment.
   * */
  public roleAssignment({roleName,principalType,principalId}:{roleName:pulumi.Input<string>,principalId:pulumi.Input<string>,principalType:enums.authorization.PrincipalType}){
    const resourceId = this.getOutputs()?.id;
    if(!resourceId){
      throw new Error(`Resource ID is not available for role assignment in component "${this.type}:${this.name}"`);
    }
    return pulumi.output([roleName, principalId]).apply(
      ([role, id]) =>
        new RoleAssignment(
          `${this.name}-${role}-${id}`,
          {
            principalId: id,
            principalType,
            roleName: role,
            scope: resourceId,
          },
          { parent: this, deletedWith: this },
        ),
    );
  }
}
