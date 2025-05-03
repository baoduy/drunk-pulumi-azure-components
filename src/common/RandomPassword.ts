import * as pulumi from '@pulumi/pulumi';
import * as random from '@pulumi/random';
import { BaseArgs, BaseComponentResource } from '../base';

export interface RandomPasswordArgs extends BaseArgs {
  policy?: pulumi.Input<'monthly' | 'yearly' | boolean>;
  length?: pulumi.Input<number>;
  options?: {
    lower?: pulumi.Input<boolean>;
    upper?: pulumi.Input<boolean>;
    numeric?: pulumi.Input<boolean>;
    special?: pulumi.Input<boolean>;
  };
}

export class RandomPassword extends BaseComponentResource<RandomPasswordArgs> {
  public readonly value: pulumi.Output<string>;

  constructor(
    name: string,
    args: RandomPasswordArgs = { length: 50, policy: 'yearly' },
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('RandomPassword', name, args, opts);

    const keepKey = this.generateKeepKey();
    const options = args.options || {
      lower: true,
      upper: true,
      numeric: true,
      special: true,
    };

    const randomPass = new random.RandomPassword(
      name,
      {
        keepers: { keepKey },
        length: args.length || 50,
        minLower: 2,
        minUpper: 2,
        minNumeric: 2,
        minSpecial: options.special ? 2 : 0,
        ...options,
        //Exclude some special characters that are not accepted by XML and SQLServer.
        overrideSpecial: options.special == false ? '' : '#%&*+-/:<>?^_|~',
      },
      { ...opts, parent: this }
    );

    this.addSecret('password', randomPass.result);

    this.value = randomPass.result;
    this.registerOutputs({
      value: this.value,
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
