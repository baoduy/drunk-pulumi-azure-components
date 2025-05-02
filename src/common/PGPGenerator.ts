import * as pulumi from "@pulumi/pulumi";
import { PGPResource } from "@drunk-pulumi/azure-providers";
import { WithVaultInfo } from '../types';
import { VaultSecretResult, VaultSecrets } from '../vault';

type UserInfo = { name: string; email: string };

export interface PGPGeneratorArgs extends WithVaultInfo {
  user: pulumi.Input<UserInfo>;
  passphrase?: pulumi.Input<string>;
  type?: "ecc" | "rsa";
  validDays?: pulumi.Input<number>;
}

export class PGPGenerator extends pulumi.ComponentResource {
  public readonly publicKey: pulumi.Output<string>;
  public readonly privateKey: pulumi.Output<string>;
  public readonly passphrase?: pulumi.Output<string>;
  public readonly revocationCertificate: pulumi.Output<string>;
  public readonly vaultSecret?: {
    publicKey: VaultSecretResult;
    privateKey: VaultSecretResult;
    revocationCertificate: VaultSecretResult;
    passphrase?: VaultSecretResult;
  };

  constructor(
    name: string,
    args: PGPGeneratorArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("drunk-pulumi:index:PGPGenerator", name, args, opts);

    const pgp = new PGPResource(name, args, opts);

    this.publicKey = pgp.publicKey;
    this.privateKey = pgp.privateKey;
    this.revocationCertificate = pgp.revocationCertificate;
    if (args.passphrase) this.passphrase = pulumi.secret(args.passphrase);

    if (args.vaultInfo) {
      const items: { [key: string]: any } = {
        publicKey: {
          value: pgp.publicKey,
          contentType: "PGPGenerator",
        },
        privateKey: {
          value: pgp.privateKey,
          contentType: "PGPGenerator",
        },
        revocationCertificate: {
          value: pgp.revocationCertificate,
          contentType: "PGPGenerator",
        }
      };

      if (args.passphrase) items['passphrase'] = {
        value: args.passphrase,
        contentType: "PGPGenerator",
      };

      const secrets = new VaultSecrets(
        name,
        {
          vaultInfo: args.vaultInfo,
          secrets: items,
        }
      );

      this.vaultSecret = { publicKey: secrets.results.publicKey, privateKey: secrets.results.privateKey, revocationCertificate: secrets.results.revocationCertificate, passphrase: secrets.results.passphrase };
    }

    this.registerOutputs({
      publicKey: this.publicKey,
      privateKey: this.privateKey,
      passphrase: this.passphrase,
      revocationCertificate: this.revocationCertificate,
      vaultSecret: this.vaultSecret,
    });
  }
}
