import * as pulumi from '@pulumi/pulumi';
import * as types from '../types';
import { BaseArgs, BaseResourceComponent } from '../base';
import * as az from '@pulumi/azure-native';
import { StorageAccount } from '../storage';

export type WorkspaceResult = types.ResourceType & { customerId: string };
export type AppInsightResult = types.ResourceType & { instrumentationKey: string };

export interface LogsArgs extends BaseArgs, types.WithResourceGroupInputs {
  retentionInDays?: pulumi.Input<number>;

  workspace?: {
    enabled: boolean;
    appInsightEnabled?: boolean;
    sku?: az.operationalinsights.WorkspaceSkuNameEnum;
    dailyQuotaGb?: pulumi.Input<number>;
    publicNetworkAccessForIngestion?: pulumi.Input<'Disabled' | 'Enabled'>;
    publicNetworkAccessForQuery?: pulumi.Input<'Disabled' | 'Enabled'>;
    samplingPercentage?: pulumi.Input<number>;
    disableLocalAuth?: pulumi.Input<boolean>;
    enableDataExport?: pulumi.Input<boolean>;
    enableLogAccessUsingOnlyResourcePermissions?: pulumi.Input<boolean>;
    immediatePurgeDataOn30Days?: pulumi.Input<boolean>;
  };
  storage?: { enabled: boolean };
}

export class Logs extends BaseResourceComponent<LogsArgs> {
  public readonly storage?: pulumi.Output<types.ResourceType>;
  public readonly workspace?: pulumi.Output<WorkspaceResult>;
  public readonly appInsight?: pulumi.Output<AppInsightResult>;

  constructor(name: string, args: LogsArgs, private opts?: pulumi.ComponentResourceOptions) {
    super('Logs', name, args, opts);

    const storage = this.createStorage();
    const workspace = this.createWorkspace();
    const appInsight = this.createAppInsight(workspace);

    if (storage) {
      this.storage = pulumi.output({
        id: storage.id,
        resourceName: storage.name,
      });
    }

    if (workspace) {
      this.workspace = pulumi.output({
        id: workspace.id,
        resourceName: workspace.name,
        customerId: workspace.customerId,
      });

      this.addSecret(`${name}-wp-customerId`, workspace.customerId);
    }

    if (appInsight) {
      this.appInsight = pulumi.output({
        id: appInsight.id,
        resourceName: appInsight.name,
        instrumentationKey: appInsight.instrumentationKey,
      });

      this.addSecret(`${name}-appInsight-key`, appInsight.instrumentationKey);
    }

    this.registerOutputs({
      storage: this.storage,
      workspace: this.workspace,
      appInsight: this.appInsight,
    });
  }

  private createWorkspace() {
    const { workspace, rsGroup, retentionInDays } = this.args;
    if (!workspace?.enabled) return undefined;

    const sku = workspace.sku || az.operationalinsights.WorkspaceSkuNameEnum.Free;
    const dailyQuotaGb = workspace.dailyQuotaGb || 0.1;

    return new az.operationalinsights.Workspace(
      `${this.name}-wp`,
      {
        ...rsGroup,
        publicNetworkAccessForIngestion: workspace.publicNetworkAccessForIngestion,
        publicNetworkAccessForQuery: workspace.publicNetworkAccessForQuery,
        features: {
          immediatePurgeDataOn30Days: workspace.immediatePurgeDataOn30Days ?? true,
          disableLocalAuth: workspace.disableLocalAuth,
          enableLogAccessUsingOnlyResourcePermissions: workspace.enableLogAccessUsingOnlyResourcePermissions,
          enableDataExport: workspace.enableDataExport,
        },
        workspaceCapping: sku === az.operationalinsights.WorkspaceSkuNameEnum.Free ? undefined : { dailyQuotaGb },
        retentionInDays: sku === az.operationalinsights.WorkspaceSkuNameEnum.Free ? 7 : retentionInDays ?? 30,
        sku: { name: sku },
      },
      { dependsOn: this.opts?.dependsOn, parent: this },
    );
  }

  private createAppInsight(wp: az.operationalinsights.Workspace | undefined) {
    const { workspace, rsGroup, retentionInDays } = this.args;
    if (!wp || !workspace?.appInsightEnabled) return undefined;

    return new az.applicationinsights.Component(
      `${this.name}-ais`,
      {
        ...rsGroup,
        kind: 'web',
        disableIpMasking: true,
        applicationType: 'web',
        flowType: 'Bluefield',
        publicNetworkAccessForIngestion: workspace.publicNetworkAccessForIngestion,
        publicNetworkAccessForQuery: workspace.publicNetworkAccessForQuery,
        samplingPercentage: workspace.samplingPercentage || 70,
        retentionInDays: retentionInDays ?? 30,
        immediatePurgeDataOn30Days: workspace.immediatePurgeDataOn30Days ?? true,
        ingestionMode: 'LogAnalytics',
        disableLocalAuth: workspace.disableLocalAuth,
        workspaceResourceId: wp.id,
      },
      { dependsOn: wp, parent: this },
    );
  }

  private createStorage() {
    const { storage, rsGroup, retentionInDays } = this.args;
    if (!storage?.enabled) return undefined;

    return new StorageAccount(
      this.name,
      {
        rsGroup,
        allowSharedKeyAccess: true,
        policies: {
          defaultManagementPolicyRules: [
            {
              name: 'auto-delete-all-containers',
              type: 'Lifecycle',
              enabled: true,
              definition: {
                actions: {
                  baseBlob: {
                    delete: {
                      daysAfterCreationGreaterThan: retentionInDays ?? 30,
                      daysAfterModificationGreaterThan: retentionInDays ?? 30,
                    },
                  },
                },
                filters: { blobTypes: ['blockBlob'] },
              },
            },
          ],
        },
      },
      { parent: this },
    );
  }
}
