import * as pulumi from "@pulumi/pulumi";
import { SshKeyResource } from "@drunk-pulumi/azure-providers";
import { WithVaultInfo } from '../types';
import { VaultSecretResult, VaultSecrets } from '../vault';

export interface SshGeneratorArgs extends WithVaultInfo {
  password: pulumi.Input<string>;
}

export class SshGenerator extends pulumi.ComponentResource {
  public readonly publicKey: pulumi.Output<string>;
  public readonly privateKey: pulumi.Output<string>;
  public readonly password?: pulumi.Output<string>;

  public readonly vaultSecrets?: {
    publicKey: VaultSecretResult;
    privateKey: VaultSecretResult;
    password: VaultSecretResult;
  };

  constructor(
    name: string,
    args: SshGeneratorArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("drunk-pulumi:index:SshGenerator", name, args, opts);

    const ssh = new SshKeyResource(name, args, { ...opts, parent: this });

    this.publicKey = ssh.publicKey;
    this.privateKey = ssh.privateKey;
    this.password = pulumi.secret(args.password);

    if (args.vaultInfo) {
      const secrets = new VaultSecrets(
        name,
        {
          vaultInfo: args.vaultInfo,
          secrets: {
            publicKey: {
              value: ssh.publicKey,
              contentType: "SshGenerator",
            },
            privateKey: {
              value: ssh.privateKey,
              contentType: "SshGenerator",
            },
            password: {
              value: args.password,
              contentType: "SshGenerator",
            }
          }
        }, { dependsOn: ssh, parent: this }
      );

      this.vaultSecrets = { publicKey: secrets.results.publicKey, privateKey: secrets.results.privateKey, password: secrets.results.password };
    }

    this.registerOutputs({
      publicKey: this.publicKey,
      privateKey: this.privateKey,
      password: this.password,
      vaultSecrets: this.vaultSecrets,
    });
  }
}
