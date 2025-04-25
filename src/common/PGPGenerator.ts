import * as pulumi from "@pulumi/pulumi";
import { generateKey } from "openpgp";

type UserInfo = { name: string; email: string };

export interface PGPGeneratorArgs {
  user: UserInfo;
  passphrase?: string;
  type?: "ecc" | "rsa";
  validDays?: number;
}

export class PGPGenerator extends pulumi.ComponentResource {
  public readonly publicKey: pulumi.Output<string>;
  public readonly privateKey: pulumi.Output<string>;
  public readonly revocationCertificate: pulumi.Output<string>;

  constructor(
    name: string,
    args: PGPGeneratorArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("drunk-pulumi:index:PGPGenerator", name, args, opts);

    //Date preparation
    const now = new Date();
    const expireDate = new Date();
    if (args.validDays)
      expireDate.setDate(expireDate.getDate() + args.validDays);

    const pgp = generateKey({
      curve: "brainpoolP512r1",
      format: "armored",
      type: args.type ?? "rsa",
      date: now,
      keyExpirationTime: args.validDays ? expireDate.getTime() : undefined,
      passphrase: args.passphrase,
      userIDs: [args.user],
    });

    const pgpOutputs = pulumi.output(pgp);

    this.publicKey = pgpOutputs.publicKey;
    this.privateKey = pgpOutputs.privateKey;
    this.revocationCertificate = pgpOutputs.revocationCertificate;

    this.registerOutputs({
      publicKey: pgpOutputs.publicKey,
      privateKey: pgpOutputs.privateKey,
      revocationCertificate: pgpOutputs.revocationCertificate,
    });
  }
}
