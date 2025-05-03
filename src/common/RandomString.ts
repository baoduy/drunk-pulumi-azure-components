import * as pulumi from '@pulumi/pulumi';
import * as random from '@pulumi/random';
import { BaseArgs, BaseComponentResource } from '../base';

export interface RandomStringArgs extends BaseArgs {
  type: 'string' | 'uuId';
  length?: pulumi.Input<number>;
  options?: {
    lower?: pulumi.Input<boolean>;
    upper?: pulumi.Input<boolean>;
    numeric?: pulumi.Input<boolean>;
    special?: pulumi.Input<boolean>;
  };
}

export class RandomString extends BaseComponentResource<RandomStringArgs> {
  public readonly value: pulumi.Output<string>;

  constructor(
    name: string,
    args: RandomStringArgs = { length: 25, type: 'string' },
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('RandomString', name, args, opts);

    const options = args.options || {
      lower: true,
      upper: true,
      numeric: true,
      special: false,
    };

    const randomString =
      args.type == 'string'
        ? new random.RandomString(
            name,
            {
              length: args.length || 25,
              minLower: 2,
              minUpper: 2,
              minNumeric: 2,
              minSpecial: options.special ? 2 : 0,
              ...options,
            },
            { ...opts, parent: this }
          )
        : new random.RandomUuid(name, {}, opts);

    this.addSecret('value', randomString.result);

    this.value = randomString.result;
    this.registerOutputs({
      value: this.value,
    });
  }
}
