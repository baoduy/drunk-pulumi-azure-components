import { SshKeyResource } from '@drunk-pulumi/azure-providers';
import * as pulumi from '@pulumi/pulumi';
import { BaseArgs, BaseResourceComponent } from '../base';

export interface SshGeneratorArgs extends BaseArgs {
  /** if vaultInfo is provided this password will be added into Key vault together with public key and private key */
  password: pulumi.Input<string>;
}

export class SshGenerator extends BaseResourceComponent<SshGeneratorArgs> {
  public readonly publicKey: pulumi.Output<string>;
  public readonly privateKey: pulumi.Output<string>;
  public readonly password?: pulumi.Output<string>;

  constructor(name: string, args: SshGeneratorArgs, opts?: pulumi.ComponentResourceOptions) {
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

    this.registerOutputs();
  }

  public getOutputs(): pulumi.Inputs | pulumi.Output<pulumi.Inputs> {
    return {
      publicKey: this.publicKey,
      privateKey: this.privateKey,
      password: this.password,
    };
  }
}
