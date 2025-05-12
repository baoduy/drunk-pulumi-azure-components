import * as devices from '@pulumi/azure-native/iothub';
import * as pulumi from '@pulumi/pulumi';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import * as types from '../types';

export interface IoTHubArgs
  extends CommonBaseArgs,
    types.WithUserAssignedIdentity,
    Pick<devices.IotHubResourceArgs, 'properties' | 'sku'> {}

export class IoTHub extends BaseResourceComponent<IoTHubArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: IoTHubArgs, opts?: pulumi.ComponentResourceOptions) {
    super('IoTHub', name, args, opts);

    const { rsGroup, defaultUAssignedId, ...props } = args;

    const iot = new devices.IotHubResource(
      name,
      {
        ...props,
        ...rsGroup,

        identity: {
          type: defaultUAssignedId
            ? devices.ResourceIdentityType.SystemAssigned_UserAssigned
            : devices.ResourceIdentityType.SystemAssigned,
          userAssignedIdentities: defaultUAssignedId ? [defaultUAssignedId.id] : undefined,
        },
        properties: {
          enableFileUploadNotifications: false,
          features: devices.Capabilities.None,
          messagingEndpoints: {
            fileNotifications: {
              lockDurationAsIso8601: 'PT1M',
              maxDeliveryCount: 10,
              ttlAsIso8601: 'PT1H',
            },
          },
          minTlsVersion: '1.2',
          ...props?.properties,
        },
      },
      { ...opts, parent: this },
    );

    this.id = iot.id;
    this.resourceName = iot.name;

    this.registerOutputs();
  }

  public getOutputs(): pulumi.Inputs | pulumi.Output<pulumi.Inputs> {
    return {
      id: this.id,
      resourceName: this.resourceName,
    };
  }
}
