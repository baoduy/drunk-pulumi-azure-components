import * as pulumi from '@pulumi/pulumi';
import { getComponentResourceType } from '../base/helpers';
import { WithVaultInfo } from '../types';
import { SecretItemArgs, VaultSecret } from './VaultSecret';
import { BaseComponent } from '../base/BaseComponent';

export type VaultSecretResult = {
  id: pulumi.Output<string>;
  vaultUrl: pulumi.Output<string>;
  version: pulumi.Output<string>;
};

export interface VaultSecretsArgs extends Required<WithVaultInfo> {
  secrets: { [key: string]: SecretItemArgs };
}

export class VaultSecrets extends BaseComponent<VaultSecretsArgs> {
  public readonly results: {
    [key: string]: VaultSecretResult;
  } = {};

  constructor(name: string, args: VaultSecretsArgs, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('VaultSecrets'), name, args, opts);

    Object.keys(args.secrets).forEach((key) => {
      const secret = new VaultSecret(
        key.includes(name) ? key : `${name}-${key}`,
        {
          ...args.secrets[key],
          vaultInfo: args.vaultInfo,
        },
        opts,
      );

      this.results[key] = {
        id: secret.id,
        vaultUrl: secret.vaultUrl,
        version: secret.version,
      };
    });

    this.registerOutputs(this.getOutputs());
  }

  public getOutputs(): pulumi.Inputs | pulumi.Output<pulumi.Inputs> {
    return {
      results: this.results,
    };
  }
}
