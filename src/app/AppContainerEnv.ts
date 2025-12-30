import * as app from '@pulumi/azure-native/app';
import * as pulumi from '@pulumi/pulumi';
import * as types from '../types';
import { AppContainer, AppContainerArgs } from './AppContainer';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import * as enums from '@pulumi/azure-native/types/enums';

interface ScheduledEntryArgs {
  /**
   * Length of maintenance window range from 8 to 24 hours.
   */
  durationHours: pulumi.Input<number>;
  /**
   * Start hour after which managed environment maintenance can start from 0 to 23 hour.
   */
  startHourUtc: pulumi.Input<number>;
  /**
   * Day of the week when a managed environment can be patched.
   */
  weekDay: pulumi.Input<enums.app.WeekDay>;
}

/**
 * Azure Container Apps Managed Environment component providing isolated hosting
 * environment for container apps with networking, monitoring, and scaling features.
 */
export interface AppContainerEnvArgs
  extends
    CommonBaseArgs,
    types.WithUserAssignedIdentity,
    Partial<
      Pick<
        app.ManagedEnvironmentArgs,
        | 'daprAIConnectionString'
        | 'daprAIInstrumentationKey'
        | 'customDomainConfiguration'
        | 'infrastructureResourceGroup'
        | 'peerAuthentication'
        | 'peerTrafficConfiguration'
        | 'workloadProfiles'
        | 'zoneRedundant'
        | 'appInsightsConfiguration'
        | 'appLogsConfiguration'
        | 'openTelemetryConfiguration'
        | 'publicNetworkAccess'
      >
    > {
  /** VNet configuration for internal networking */
  vnetConfiguration?: {
    /** Subnet resource info for infrastructure components */
    infrastructureSubnet: types.SubResourceInputs;
    /** Enable internal-only ingress */
    internal?: boolean;
    /** Platform-reserved CIDR (e.g., '10.0.0.0/23') - must not overlap with infrastructure subnet */
    platformReservedCidr?: pulumi.Input<string>;
    /** Platform-reserved DNS IP (must be within platformReservedCidr) */
    platformReservedDnsIP?: pulumi.Input<string>;
  };

  /** Log Analytics workspace for Container App logs and metrics */
  logAnalyticsWorkspace?: types.ResourceInputs;

  /** Dapr configuration */
  dapr?: {
    /** Application Insights connection string for Dapr telemetry */
    connectionString?: pulumi.Input<string>;
    /** Application Insights instrumentation key for Dapr telemetry */
    instrumentationKey?: pulumi.Input<string>;
  };

  containerApps?: Record<string, Omit<AppContainerArgs, types.CommonProps | 'managedEnvironmentId'>>;
  maintenanceSchedules?: pulumi.Input<ScheduledEntryArgs>[];
}

export class AppContainerEnv extends BaseResourceComponent<AppContainerEnvArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;
  public readonly defaultDomain: pulumi.Output<string>;
  public readonly staticIp: pulumi.Output<string>;

  constructor(name: string, args: AppContainerEnvArgs, opts?: pulumi.ComponentResourceOptions) {
    super('AppContainerEnv', name, args, opts);

    const managedEnv = this.createManagedEnvironment();
    this.createMaintenance(managedEnv);
    this.createApps(managedEnv);

    this.id = managedEnv.id;
    this.resourceName = managedEnv.name;
    this.defaultDomain = managedEnv.defaultDomain;
    this.staticIp = managedEnv.staticIp;

    this.registerOutputs();
  }

  public getOutputs() {
    return {
      resourceName: this.resourceName,
      id: this.id,
      defaultDomain: this.defaultDomain,
      staticIp: this.staticIp,
      vaultSecrets: this.vaultSecrets,
    };
  }

  private createManagedEnvironment() {
    const { rsGroup, defaultUAssignedId, vnetConfiguration, logAnalyticsWorkspace, dapr, ...props } = this.args;

    // Build Log Analytics configuration
    const appLogsConfiguration = logAnalyticsWorkspace
      ? {
          appLogsConfiguration: {
            logAnalyticsConfiguration: {
              customerId: logAnalyticsWorkspace.id,
              sharedKey: pulumi.secret(logAnalyticsWorkspace.id), // In practice, retrieve actual shared key
            },
          },
        }
      : undefined;

    return new app.ManagedEnvironment(
      this.name,
      {
        ...props,
        ...rsGroup,
        // Logging and monitoring
        ...appLogsConfiguration,

        // identity: {
        //   type: defaultUAssignedId
        //     ? app.ManagedServiceIdentityType.SystemAssigned_UserAssigned
        //     : app.ManagedServiceIdentityType.SystemAssigned,
        //   userAssignedIdentities: defaultUAssignedId ? [defaultUAssignedId.id] : undefined,
        // },

        // VNet integration
        vnetConfiguration: vnetConfiguration
          ? {
              infrastructureSubnetId: vnetConfiguration.infrastructureSubnet.id,
              internal: vnetConfiguration.internal ?? false,
              platformReservedCidr: vnetConfiguration.platformReservedCidr,
              platformReservedDnsIP: vnetConfiguration.platformReservedDnsIP,
            }
          : undefined,

        // Dapr telemetry
        daprAIConnectionString: dapr?.connectionString ?? this.args.daprAIConnectionString,
        daprAIInstrumentationKey: dapr?.instrumentationKey ?? this.args.daprAIInstrumentationKey,

        // Custom domain
        customDomainConfiguration: this.args.customDomainConfiguration,
        // Infrastructure resource group (optional separate RG for managed resources)
        infrastructureResourceGroup: this.args.infrastructureResourceGroup,
        // mTLS peer authentication
        peerAuthentication: this.args.peerAuthentication,
        // Peer traffic encryption
        peerTrafficConfiguration: this.args.peerTrafficConfiguration,
        // Workload profiles for dedicated compute
        workloadProfiles: this.args.workloadProfiles,
        // Zone redundancy for high availability
        zoneRedundant: this.args.zoneRedundant ?? false,
        // Public network access
        publicNetworkAccess: this.args.publicNetworkAccess,
        // App Insights configuration
        appInsightsConfiguration: this.args.appInsightsConfiguration,
        // OpenTelemetry configuration
        openTelemetryConfiguration: this.args.openTelemetryConfiguration,
      },
      { ...this.opts, parent: this },
    );
  }

  private createMaintenance(env: app.ManagedEnvironment) {
    const { rsGroup, maintenanceSchedules } = this.args;

    new app.MaintenanceConfiguration(
      `${this.name}-maintenance`,
      {
        configName: 'default',
        environmentName: env.name,
        resourceGroupName: rsGroup.resourceGroupName,
        scheduledEntries: maintenanceSchedules ?? [
          {
            weekDay: 'Sunday',
            durationHours: 8,
            startHourUtc: 0,
          },
        ],
      },
      { dependsOn: env, deletedWith: env, parent: this },
    );
  }

  private createApps(env: app.ManagedEnvironment) {
    const { containerApps, rsGroup, vaultInfo, defaultUAssignedId, groupRoles } = this.args;
    if (!containerApps) return undefined;

    return Object.entries(containerApps).forEach(
      ([appName, appArgs]) =>
        new AppContainer(
          appName,
          { ...appArgs, rsGroup, vaultInfo, defaultUAssignedId, groupRoles, managedEnvironmentId: env.id },
          { dependsOn: env, deletedWith: env, parent: this },
        ),
    );
  }
}
