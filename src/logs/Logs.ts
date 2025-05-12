import * as az from '@pulumi/azure-native';
import * as pulumi from '@pulumi/pulumi';
import { BaseArgs, BaseResourceComponent } from '../base';
import { StorageAccount } from '../storage';
import * as types from '../types';

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
  public readonly storage?: types.ResourceOutputs;
  public readonly workspace?: types.WorkspaceOutputs;
  public readonly appInsight?: types.AppInsightOutputs;

  constructor(name: string, args: LogsArgs, opts?: pulumi.ComponentResourceOptions) {
    super('Logs', name, args, opts);

    const storage = this.createStorage();
    const workspace = this.createWorkspace();
    const appInsight = this.createAppInsight(workspace);

    if (storage) {
      this.storage = {
        id: storage.id,
        resourceName: storage.resourceName,
      };
    }

    if (workspace) {
      this.workspace = {
        id: workspace.id,
        resourceName: workspace.name,
        customerId: pulumi.secret(workspace.customerId),
      };

      this.addSecret(`${name}-wp-customerId`, workspace.customerId);
    }

    if (appInsight) {
      this.appInsight = {
        id: appInsight.id,
        resourceName: appInsight.name,
        instrumentationKey: pulumi.secret(appInsight.instrumentationKey),
      };

      this.addSecret(`${name}-appInsight-key`, appInsight.instrumentationKey);
    }

    this.registerOutputs();
  }

  public getOutputs(): pulumi.Inputs | pulumi.Output<pulumi.Inputs> {
    return {
      storage: this.storage,
      workspace: this.workspace,
      appInsight: this.appInsight,
    };
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
    const { storage, rsGroup, retentionInDays, vaultInfo } = this.args;
    if (!storage?.enabled) return undefined;

    return new StorageAccount(
      this.name,
      {
        rsGroup,
        vaultInfo,
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
                      //daysAfterModificationGreaterThan: retentionInDays ?? 30,
                    },
                  },
                },
                filters: { blobTypes: ['blockBlob'] },
              },
            },
          ],
        },
      },
      { dependsOn: this.opts?.dependsOn, parent: this },
    );
  }
}
