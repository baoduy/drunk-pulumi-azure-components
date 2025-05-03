import * as pulumi from '@pulumi/pulumi';
import { SshKeyResource } from '@drunk-pulumi/azure-providers';
import { WithVaultInfo } from '../types';
import { VaultSecretResult, VaultSecrets } from '../vault';
import { BaseArgs, BaseComponentResource } from '../base';

export interface SshGeneratorArgs extends BaseArgs {
  password: pulumi.Input<string>;
}

export class SshGenerator extends BaseComponentResource<SshGeneratorArgs> {
  public readonly publicKey: pulumi.Output<string>;
  public readonly privateKey: pulumi.Output<string>;
  public readonly password?: pulumi.Output<string>;

  constructor(
    name: string,
    args: SshGeneratorArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('SshGenerator', name, args, opts);

    const ssh = new SshKeyResource(name, args, { ...opts, parent: this });

    this.publicKey = ssh.publicKey;
    this.privateKey = ssh.privateKey;
    this.password = pulumi.secret(args.password);

    this.addSecrets({
      publicKey: ssh.publicKey,
      privateKey: ssh.privateKey,
      password: args.password,
    });

    this.registerOutputs({
      publicKey: this.publicKey,
      privateKey: this.privateKey,
      password: this.password,
      vaultSecrets: this.vaultSecrets,
    });
  }
}
