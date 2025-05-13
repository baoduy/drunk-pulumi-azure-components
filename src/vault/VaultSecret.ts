import { VaultSecretResource } from '@drunk-pulumi/azure-providers/VaultSecret';
import * as pulumi from '@pulumi/pulumi';
import { BaseComponent } from '../base/BaseComponent';
import { getComponentResourceType } from '../base/helpers';
import { configHelper } from '../helpers';
import { WithVaultInfo } from '../types';
import * as vaultHelpers from './helpers';

export type SecretItemArgs = {
  //** The value of the secret. If it is not provided the value will get from project secret. */
  value?: pulumi.Input<string>;
  contentType?: pulumi.Input<string>;
  tags?: {
    [key: string]: string;
  };
};

export interface VaultSecretArgs extends SecretItemArgs, Required<WithVaultInfo> {}

export class VaultSecret extends BaseComponent<VaultSecretArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly vaultUrl: pulumi.Output<string>;
  public readonly version: pulumi.Output<string>;

  constructor(name: string, args: VaultSecretArgs, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('VaultSecret'), name, args, opts);
    const secretValue = args.value ?? configHelper.getSecret(name) ?? '';
    const secretName = vaultHelpers.getSecretName(this.name);

    const secret = new VaultSecretResource(
      name,
      {
        name: secretName,
        value: secretValue,
        vaultName: pulumi.output(args.vaultInfo).apply((v) => v.resourceName),
        contentType: args.contentType,
        tags: args.tags,
      },
      opts,
    );

    this.id = secret.id;
    this.vaultUrl = secret.vaultUrl;
    this.version = secret.version;

    this.registerOutputs(this.getOutputs());
  }

  public getOutputs() {
    return {
      id: this.id,
      vaultUrl: this.vaultUrl,
      version: this.version,
    };
  }
}
