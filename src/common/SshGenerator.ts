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
  public readonly vaultSecret?: {
    publicKey: VaultSecretResult;
    privateKey: VaultSecretResult;
    revocationCertificate: VaultSecretResult;
  };

  constructor(
    name: string,
    args: SshGeneratorArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("drunk-pulumi:index:SshGenerator", name, args, opts);

    const ssh = new SshKeyResource(name, args, opts);

    this.publicKey = ssh.publicKey;
    this.privateKey = ssh.privateKey;
    this.password = pulumi.output(args.password);

    // if (args.vaultInfo) {
    //   const secrets = new VaultSecrets(
    //     name,
    //     {
    //       vaultInfo: args.vaultInfo,
    //       secrets: {
    //         publicKey: {
    //           value: Ssh.publicKey,
    //           contentType: "SshGenerator",
    //         },
    //         privateKey: {
    //           value: Ssh.privateKey,
    //           contentType: "SshGenerator",
    //         },
    //         revocationCertificate: {
    //           value: Ssh.revocationCertificate,
    //           contentType: "SshGenerator",
    //         }
    //       }
    //     }
    //   );

    //this.vaultSecret = { publicKey: ssh.publicKey, privateKey: ssh.privateKey };


    this.registerOutputs({
      publicKey: this.publicKey,
      privateKey: this.privateKey,
      vaultSecret: this.vaultSecret,
    });
  }
}
