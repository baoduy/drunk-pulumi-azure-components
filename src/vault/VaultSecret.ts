import { WithVaultInfo } from '../types';
import * as pulumi from '@pulumi/pulumi';
import {
  configHelper,
  stackInfo,
  removeLeadingAndTrailingDash,
} from '../helpers';
import { VaultSecretResource } from '@drunk-pulumi/azure-providers/VaultSecret';
import { getComponentResourceType } from '../base';

export type SecretItemArgs = {
  //** The value of the secret. If it is not provided the value will get from project secret. */
  value?: pulumi.Input<string>;
  contentType?: pulumi.Input<string>;
  tags?: {
    [key: string]: string;
  };
};

export interface VaultSecretArgs
  extends SecretItemArgs,
    Required<WithVaultInfo> {}

export class VaultSecret extends pulumi.ComponentResource {
  public readonly id: pulumi.Output<string>;
  public readonly vaultUrl: pulumi.Output<string>;
  public readonly version: pulumi.Output<string>;

  constructor(
    private name: string,
    args: VaultSecretArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super(getComponentResourceType('VaultSecret'), name, args, opts);
    const secretValue = args.value ?? configHelper.getSecret(name) ?? '';
    const secretName = this.getSecretName();

    const secret = new VaultSecretResource(
      name,
      {
        name: secretName,
        value: secretValue,
        vaultName: pulumi.output(args.vaultInfo).apply((v) => v.resourceName),
        contentType: args.contentType,
        tags: args.tags,
      },
      opts
    );

    this.id = secret.id;
    this.vaultUrl = secret.vaultUrl;
    this.version = secret.version;

    this.registerOutputs({
      id: this.id,
      vaultUrl: this.vaultUrl,
      version: this.version,
    });
  }

  private getSecretName() {
    const name = this.name
      .replace(new RegExp(stackInfo.stack, 'g'), '') // Replace occurrences of "stack" variable with "-"
      .replace(/\.|_|\s/g, '-') // Replace ".", "_", and spaces with "-"
      .replace(/-+/g, '-') // Replace multiple dashes with a single dash
      .toLowerCase(); // Convert the result to lowercase

    return removeLeadingAndTrailingDash(name);
  }
}
