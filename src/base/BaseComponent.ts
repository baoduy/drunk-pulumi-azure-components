import * as pulumi from '@pulumi/pulumi';
import { getComponentResourceType } from './helpers';

/**
 * BaseComponent serves as an abstract foundation class for Pulumi resource components.
 * It provides core functionality and structure for creating custom infrastructure components.
 *
 * @template TArgs - Generic type parameter extending pulumi.Inputs to define component arguments
 * @extends pulumi.ComponentResource<TArgs>
 */
/**
 * @template TArgs - Generic type parameter extending pulumi.Inputs
 * @example
 * // Add usage example here
 * const component = new MyComponent('name', args);
 */
export abstract class BaseComponent<TArgs extends pulumi.Inputs> extends pulumi.ComponentResource<TArgs> {
  /**
   * Creates a new instance of BaseComponent
   * @param type - The resource type identifier for this component
   * @param name - Unique name for this component instance
   * @param args - Configuration arguments for this component
   * @param opts - Optional Pulumi resource options to control component behavior
   */
  constructor(
    type: string,
    public readonly name: string,
    protected readonly args: TArgs,
    protected readonly opts?: pulumi.ComponentResourceOptions,
  ) {
    super(getComponentResourceType(type), name, args, opts);
  }

  /**
   * Registers component outputs with the Pulumi engine.
   * This method should be overridden by derived classes to ensure proper output registration.
   * @param outputs - The outputs to register for this component
   */
  protected registerOutputs(outputs: pulumi.Inputs | pulumi.Output<pulumi.Inputs>): void {
    super.registerOutputs(outputs);
  }

  /**
   * Abstract method that must be implemented by derived classes to expose component outputs.
   * This method should return all relevant outputs that consumers of the component might need.
   * @returns An object containing the component's outputs, either as direct values or Pulumi outputs
   */
  public abstract getOutputs(): pulumi.Inputs | pulumi.Output<pulumi.Inputs>;
}
