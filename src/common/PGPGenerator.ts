import * as pulumi from "@pulumi/pulumi";
import { PGPResource } from "@drunk-pulumi/azure-providers";
import { WithVaultInfo } from '../types';
import { VaultSecretResult, VaultSecrets } from '../vault';

type UserInfo = { name: string; email: string };

export interface PGPGeneratorArgs extends WithVaultInfo {
  user: UserInfo;
  passphrase?: string;
  type?: "ecc" | "rsa";
  validDays?: number;
}

export class PGPGenerator extends pulumi.ComponentResource {
  public readonly publicKey: pulumi.Output<string>;
  public readonly privateKey: pulumi.Output<string>;
  public readonly revocationCertificate: pulumi.Output<string>;
  public readonly vaultSecret?: {
    publicKey: VaultSecretResult;
    privateKey: VaultSecretResult;
    revocationCertificate: VaultSecretResult;
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

    if (args.vaultInfo) {
      const secrets = new VaultSecrets(
        name,
        {
          vaultInfo: args.vaultInfo,
          secrets: {
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
          }
        }
      );

      this.vaultSecret = { publicKey: secrets.results.publicKey, privateKey: secrets.results.privateKey, revocationCertificate: secrets.results.revocationCertificate };
    }

    this.registerOutputs({
      publicKey: this.publicKey,
      privateKey: this.privateKey,
      revocationCertificate: this.revocationCertificate,
      vaultSecret: this.vaultSecret,
    });
  }
}
