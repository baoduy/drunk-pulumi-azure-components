import * as search from '@pulumi/azure-native/search';
import * as pulumi from '@pulumi/pulumi';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import * as types from '../types';
import * as vault from '../vault';
import { PrivateEndpoint } from '../vnet/PrivateEndpoint';

export interface NatGatewayArgs
  extends CommonBaseArgs,
    types.WithUserAssignedIdentity,
    types.WithEncryptionEnabler,
    Pick<search.ServiceArgs, 'authOptions' | 'hostingMode' | 'partitionCount' | 'replicaCount' | 'semanticSearch'> {
  sku: search.SkuName;
  disableLocalAuth?: boolean;
  network?: Pick<types.NetworkArgs, 'publicNetworkAccess' | 'ipRules' | 'privateLink'>;
}

export class NatGateway extends BaseResourceComponent<NatGatewayArgs> {
  //public readonly id: pulumi.Output<string>;
  //public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: NatGatewayArgs, opts?: pulumi.ComponentResourceOptions) {
    super('NatGateway', name, args, opts);
  }
}
