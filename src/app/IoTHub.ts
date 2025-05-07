import * as pulumi from '@pulumi/pulumi';
import { BaseResourceComponent, CommonBaseArgs } from '../base';

export interface IoTHubArgs extends CommonBaseArgs {
  /** The name of the IoT hub */
  hubName: pulumi.Input<string>;
  /** The name of the resource group */
}

export class IoTHub extends BaseResourceComponent<IoTHubArgs> {
  //public readonly id: pulumi.Output<string>;
  //public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: IoTHubArgs, opts?: pulumi.ComponentResourceOptions) {
    super('IoTHub', name, args, opts);
  }
}
