import * as app from '@pulumi/azure-native/app';
import * as inputs from '@pulumi/azure-native/types/input';
import * as pulumi from '@pulumi/pulumi';
import * as types from '../types';

import { BaseResourceComponent, CommonBaseArgs } from '../base';

/**
 * Azure Container Apps Managed Environment component providing isolated hosting
 * environment for container apps with networking, monitoring, and scaling features.
 */
export interface AppContainerEnvArgs
  extends CommonBaseArgs,
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
}

export class AppContainerEnv extends BaseResourceComponent<AppContainerEnvArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;
  public readonly defaultDomain: pulumi.Output<string>;
  public readonly staticIp: pulumi.Output<string>;

  constructor(name: string, args: AppContainerEnvArgs, opts?: pulumi.ComponentResourceOptions) {
    super('AppContainerEnv', name, args, opts);

    const managedEnv = this.createManagedEnvironment();

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
    const { rsGroup, vnetConfiguration, logAnalyticsWorkspace, dapr, ...props } = this.args;

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

        // VNet integration
        vnetConfiguration: vnetConfiguration
          ? {
              infrastructureSubnetId: vnetConfiguration.infrastructureSubnet.id,
              internal: vnetConfiguration.internal ?? false,
              platformReservedCidr: vnetConfiguration.platformReservedCidr,
              platformReservedDnsIP: vnetConfiguration.platformReservedDnsIP,
            }
          : undefined,

        // Logging and monitoring
        ...appLogsConfiguration,

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
}
