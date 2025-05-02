import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { WithVaultInfo } from '../types';
import { VaultSecretResult, VaultSecret } from '../vault';

export interface RandomStringArgs extends WithVaultInfo {
  type: "string" | "uuId";
  length?: pulumi.Input<number>;
  options?: {
    lower?: pulumi.Input<boolean>;
    upper?: pulumi.Input<boolean>;
    numeric?: pulumi.Input<boolean>;
    special?: pulumi.Input<boolean>;
  };
}

export class RandomString extends pulumi.ComponentResource {
  public readonly value: pulumi.Output<string>;
  public readonly vaultSecret?: VaultSecretResult;

  constructor(
    name: string,
    args: RandomStringArgs = { length: 25, type: "string" },
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("drunk-pulumi:index:RandomString", name, args, opts);

    const options = args.options || { lower: true, upper: true, numeric: true, special: false, };

    const randomString = args.type == "string" ? new random.RandomString(name, {

      length: args.length || 25,
      minLower: 2,
      minUpper: 2,
      minNumeric: 2,
      minSpecial: options.special ? 2 : 0,
      ...options,
    }, { ...opts, parent: this }) : new random.RandomUuid(name, {}, opts);

    if (args.vaultInfo) {
      const secret = new VaultSecret(name, {
        vaultInfo: args.vaultInfo,
        value: randomString.result,
        contentType: `random ${args.type}`,
      }, { dependsOn: randomString, parent: this });

      this.vaultSecret = {
        id: secret.id,
        vaultUrl: secret.vaultUrl,
        version: secret.version,
      };
    }

    this.value = randomString.result;
    this.registerOutputs({
      value: this.value,
      vaultSecret: this.vaultSecret,
    });
  }
}