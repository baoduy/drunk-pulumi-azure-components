import { PGPResource } from '@drunk-pulumi/azure-providers';
import * as pulumi from '@pulumi/pulumi';
import { BaseArgs, BaseResourceComponent } from '../base/BaseResourceComponent';

type UserInfo = { name: string; email: string };

export interface PGPGeneratorArgs extends BaseArgs {
  user: pulumi.Input<UserInfo>;
  passphrase?: pulumi.Input<string>;
  type?: 'ecc' | 'rsa';
  validDays?: pulumi.Input<number>;
}

export class PGPGenerator extends BaseResourceComponent<PGPGeneratorArgs> {
  public readonly publicKey: pulumi.Output<string>;
  public readonly privateKey: pulumi.Output<string>;
  public readonly passphrase?: pulumi.Output<string>;
  public readonly revocationCertificate: pulumi.Output<string>;

  constructor(name: string, args: PGPGeneratorArgs, opts?: pulumi.ComponentResourceOptions) {
    super('PGPGenerator', name, args, opts);

    const pgp = new PGPResource(name, args, { ...opts, parent: this });

    this.publicKey = pgp.publicKey;
    this.privateKey = pgp.privateKey;
    this.revocationCertificate = pgp.revocationCertificate;
    if (args.passphrase) this.passphrase = pulumi.secret(args.passphrase);

    this.addSecrets({
      publicKey: pgp.publicKey,
      privateKey: pgp.privateKey,
      revocationCertificate: pgp.revocationCertificate,
    });
    if (args.passphrase) this.addSecrets({ passphrase: args.passphrase });

    this.registerOutputs();
  }

  public getOutputs(): pulumi.Inputs | pulumi.Output<pulumi.Inputs> {
    return {
      publicKey: this.publicKey,
      privateKey: this.privateKey,
      passphrase: this.passphrase,
      revocationCertificate: this.revocationCertificate,
    };
  }
}
