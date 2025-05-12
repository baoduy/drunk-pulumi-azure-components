import * as pulumi from '@pulumi/pulumi';
import { getComponentResourceType } from './helpers';

/**
 * Base component class providing common functionalities for resource components
 */
export abstract class BaseComponent<TArgs extends pulumi.Inputs> extends pulumi.ComponentResource<TArgs> {
  constructor(
    type: string,
    public readonly name: string,
    protected readonly args: TArgs,
    protected readonly opts?: pulumi.ComponentResourceOptions,
  ) {
    super(getComponentResourceType(type), name, args, opts);
  }

  protected registerOutputs(outputs: pulumi.Inputs | pulumi.Output<pulumi.Inputs>): void {
    super.registerOutputs(outputs);
  }

  /**
   * Abstract getter that must be implemented by derived classes
   * Returns the main resource managed by this component
   */
  public abstract getOutputs(): pulumi.Inputs | pulumi.Output<pulumi.Inputs>;

  /**
   * Selectively picks properties from the component instance
   * @param keys - Array of property keys to pick from the component
   * @returns Object containing only the selected properties
   */
  public PickOutputs<K extends keyof this>(...keys: K[]) {
    return keys.reduce((acc, key) => {
      acc[key] = (this as any)[key];
      return acc;
    }, {} as Pick<this, K>);
  }
}
