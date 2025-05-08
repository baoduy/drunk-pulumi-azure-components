import * as pulumi from '@pulumi/pulumi';
import { CommonBaseArgs, BaseResourceComponent } from '../base';
import { PrivateEndpoint } from '../vnet/PrivateEndpoint';
import * as types from '../types';
import * as registry from '@pulumi/azure-native';

export interface AzKubernetesArgs
  extends CommonBaseArgs,
    types.WithEncryptionEnabler,
    types.WithGroupRolesArgs,
    types.WithUserAssignedIdentity {}

export class AzKubernetes extends BaseResourceComponent<AzKubernetesArgs> {
  //public readonly id: pulumi.Output<string>;
  //public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: AzKubernetesArgs, opts?: pulumi.ComponentResourceOptions) {
    super('AzKubernetes', name, args, opts);
  }
}
