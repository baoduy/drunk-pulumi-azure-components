import * as logic from '@pulumi/azure-native/logic';
import * as pulumi from '@pulumi/pulumi';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import * as types from '../types';

export interface AzSearchArgs extends CommonBaseArgs, types.WithUserAssignedIdentity {
  integrationAccount: Pick<logic.IntegrationAccountArgs, 'integrationServiceEnvironment'> & {
    sku: logic.IntegrationAccountSkuName;
  };

  workflow: Pick<
    logic.WorkflowArgs,
    'accessControl' | 'definition' | 'endpointsConfiguration' | 'integrationServiceEnvironment' | 'parameters'
  >;
}

export class AzSearch extends BaseResourceComponent<AzSearchArgs> {
  //public readonly id: pulumi.Output<string>;
  //public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: AzSearchArgs, opts?: pulumi.ComponentResourceOptions) {
    super('AzSearch', name, args, opts);
  }
}
