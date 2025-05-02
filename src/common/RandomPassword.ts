import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { WithVaultInfo } from '../types';
import { VaultSecretResult, VaultSecret } from '../vault';

export interface RandomPasswordArgs extends WithVaultInfo {
  policy?: pulumi.Input<'monthly' | 'yearly' | boolean>;
  length?: pulumi.Input<number>;
  options?: {
    lower?: pulumi.Input<boolean>;
    upper?: pulumi.Input<boolean>;
    numeric?: pulumi.Input<boolean>;
    special?: pulumi.Input<boolean>;
  };
}

export class RandomPassword extends pulumi.ComponentResource {
  public readonly value: pulumi.Output<string>;
  public readonly vaultSecret?: VaultSecretResult;

  constructor(
    private name: string,
    private args: RandomPasswordArgs = { length: 50, policy: 'yearly' },
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("drunk-pulumi:index:RandomPassword", name, args, opts);

    const keepKey = this.generateKeepKey();
    const options = args.options || { lower: true, upper: true, numeric: true, special: true, };

    const randomPass = new random.RandomPassword(name, {
      keepers: { keepKey },
      length: args.length || 50,
      minLower: 2,
      minUpper: 2,
      minNumeric: 2,
      minSpecial: options.special ? 2 : 0,
      ...options,
      //Exclude some special characters that are not accepted by XML and SQLServer.
      overrideSpecial: options.special == false ? '' : '#%&*+-/:<>?^_|~',
    }, opts);

    if (args.vaultInfo) {
      const secret = new VaultSecret(name, {
        vaultInfo: args.vaultInfo,
        value: randomPass.result,
        contentType: 'random password',
      }, { dependsOn: randomPass });

      this.vaultSecret = {
        id: secret.id,
        vaultUrl: secret.vaultUrl,
        version: secret.version,
      };
    }

    this.value = randomPass.result;
    this.registerOutputs({
      value: this.value,
      vaultSecret: this.vaultSecret,
    });
  }

  private generateKeepKey() {
    return this.args.policy === 'monthly'
      ? `${new Date().getMonth()}.${new Date().getFullYear()}`
      : this.args.policy === 'yearly'
        ? `${new Date().getFullYear()}`
        : this.name;
  }
}