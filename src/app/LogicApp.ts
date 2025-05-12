import * as logic from '@pulumi/azure-native/logic';
import * as pulumi from '@pulumi/pulumi';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import * as types from '../types';

export interface LogicAppArgs extends CommonBaseArgs, types.WithUserAssignedIdentity {
  integrationAccount: Pick<logic.IntegrationAccountArgs, 'integrationServiceEnvironment'> & {
    sku: logic.IntegrationAccountSkuName;
  };

  workflow: Pick<
    logic.WorkflowArgs,
    'accessControl' | 'definition' | 'endpointsConfiguration' | 'integrationServiceEnvironment' | 'parameters'
  >;
}

export class LogicApp extends BaseResourceComponent<LogicAppArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: LogicAppArgs, opts?: pulumi.ComponentResourceOptions) {
    super('LogicApp', name, args, opts);

    const { rsGroup, defaultUAssignedId, integrationAccount, workflow } = args;
    const account = new logic.IntegrationAccount(
      name,
      {
        ...integrationAccount,
        ...rsGroup,
        sku: { name: integrationAccount.sku },
      },
      { dependsOn: opts?.dependsOn, parent: this },
    );

    const wf = new logic.Workflow(
      name,
      {
        ...rsGroup,
        ...workflow,
        identity: {
          type: defaultUAssignedId?.id
            ? logic.ManagedServiceIdentityType.UserAssigned
            : logic.ManagedServiceIdentityType.SystemAssigned,

          userAssignedIdentities: defaultUAssignedId?.id ? [defaultUAssignedId.id] : undefined,
        },
        integrationAccount: { id: account.id },
      },
      {
        ...opts,
        dependsOn: account,
        parent: this,
      },
    );

    this.id = wf.id;
    this.resourceName = wf.name;

    this.registerOutputs();
  }

  public getOutputs(): pulumi.Inputs | pulumi.Output<pulumi.Inputs> {
    return {
      id: this.id,
      resourceName: this.resourceName,
    };
  }
}
