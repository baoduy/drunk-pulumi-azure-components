import * as app from '@pulumi/azure-native/app';
import * as inputs from '@pulumi/azure-native/types/input';
import * as pulumi from '@pulumi/pulumi';

import { BaseResourceComponent, CommonBaseArgs } from '../base';

/**
 * Azure Container App Job component providing scheduled or event-driven job execution
 * with auto-scaling, managed environment integration, and multiple trigger types.
 */
export interface AppJobArgs
  extends CommonBaseArgs, Partial<Pick<app.JobArgs, 'workloadProfileName' | 'extendedLocation'>> {
  /** Resource ID of the Container Apps Managed Environment */
  managedEnvironmentId: pulumi.Input<string>;

  /** Container configuration template */
  template: {
    /** Container definitions (at least one required) */
    containers: Array<
      Partial<
        Pick<
          inputs.app.ContainerArgs,
          'args' | 'command' | 'env' | 'probes' | 'volumeMounts' | 'resources' | 'imageType'
        >
      > & {
        /** Container name */
        name: string;
        /** Container image (e.g., 'mcr.microsoft.com/azuredocs/containerapps-job:latest') */
        image: pulumi.Input<string>;
      }
    >;
    /** Init containers */
    initContainers?: Array<
      Partial<Pick<inputs.app.InitContainerArgs, 'args' | 'command' | 'env' | 'volumeMounts' | 'resources'>> & {
        name: string;
        image: pulumi.Input<string>;
      }
    >;
    /** Volume definitions */
    volumes?: pulumi.Input<pulumi.Input<inputs.app.VolumeArgs>[]>;
  };

  /** Job configuration */
  configuration: {
    /** Trigger configuration (Manual, Schedule, or Event) */
    triggerType: app.TriggerType | 'Manual' | 'Schedule' | 'Event';

    /** Replica timeout in seconds (default: 1800) */
    replicaTimeout?: pulumi.Input<number>;

    /** Replica retry limit (default: 1) */
    replicaRetryLimit?: pulumi.Input<number>;

    /** Manual trigger configuration */
    manualTriggerConfig?: Partial<
      Pick<inputs.app.JobConfigurationManualTriggerConfigArgs, 'replicaCompletionCount' | 'parallelism'>
    >;

    /** Schedule trigger configuration (required if triggerType is 'Schedule') */
    scheduleTriggerConfig?: {
      /** Cron expression for schedule (e.g., '0 0 * * *' for daily at midnight) */
      cronExpression: pulumi.Input<string>;
      replicaCompletionCount?: pulumi.Input<number>;
      parallelism?: pulumi.Input<number>;
    };

    /** Event trigger configuration (required if triggerType is 'Event') */
    eventTriggerConfig?: Partial<
      Pick<inputs.app.JobConfigurationEventTriggerConfigArgs, 'replicaCompletionCount' | 'parallelism' | 'scale'>
    >;

    /** Registry credentials */
    registries?: pulumi.Input<pulumi.Input<inputs.app.RegistryCredentialsArgs>[]>;

    /** Secrets for environment variables or registry auth */
    secrets?: Array<{
      name: string;
      /** Plain value OR keyVaultUrl (prefer Key Vault) */
      value?: pulumi.Input<string>;
      keyVaultUrl?: pulumi.Input<string>;
      identity?: pulumi.Input<string>;
    }>;
  };
}

export class AppJob extends BaseResourceComponent<AppJobArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;
  public readonly outboundIpAddresses: pulumi.Output<string[]>;
  public readonly eventStreamEndpoint: pulumi.Output<string>;

  constructor(name: string, args: AppJobArgs, opts?: pulumi.ComponentResourceOptions) {
    super('AppJob', name, args, opts);

    const job = this.createJob();

    this.id = job.id;
    this.resourceName = job.name;
    this.outboundIpAddresses = job.outboundIpAddresses;
    this.eventStreamEndpoint = job.eventStreamEndpoint;

    this.registerOutputs();
  }

  public getOutputs() {
    return {
      resourceName: this.resourceName,
      id: this.id,
      outboundIpAddresses: this.outboundIpAddresses,
      eventStreamEndpoint: this.eventStreamEndpoint,
      vaultSecrets: this.vaultSecrets,
    };
  }

  private createJob() {
    const {
      rsGroup,
      enableResourceIdentity,
      defaultUAssignedId,
      managedEnvironmentId,
      template,
      configuration,
      ...props
    } = this.args;

    return new app.Job(
      this.name,
      {
        ...props,
        ...rsGroup,
        environmentId: managedEnvironmentId,
        identity: enableResourceIdentity
          ? {
              type: defaultUAssignedId
                ? app.ManagedServiceIdentityType.SystemAssigned_UserAssigned
                : app.ManagedServiceIdentityType.SystemAssigned,
              userAssignedIdentities: defaultUAssignedId ? [defaultUAssignedId.id] : undefined,
            }
          : undefined,

        configuration: {
          triggerType: configuration.triggerType,
          replicaTimeout: configuration.replicaTimeout ?? 1800,
          replicaRetryLimit: configuration.replicaRetryLimit ?? 1,
          manualTriggerConfig: configuration.manualTriggerConfig
            ? {
                replicaCompletionCount: configuration.manualTriggerConfig.replicaCompletionCount ?? 1,
                parallelism: configuration.manualTriggerConfig.parallelism ?? 1,
              }
            : undefined,
          scheduleTriggerConfig: configuration.scheduleTriggerConfig
            ? (() => {
                if (!configuration.scheduleTriggerConfig!.cronExpression) {
                  throw new Error('cronExpression is required when scheduleTriggerConfig is provided');
                }
                return {
                  cronExpression: configuration.scheduleTriggerConfig.cronExpression,
                  replicaCompletionCount: configuration.scheduleTriggerConfig.replicaCompletionCount ?? 1,
                  parallelism: configuration.scheduleTriggerConfig.parallelism ?? 1,
                };
              })()
            : undefined,
          eventTriggerConfig: configuration.eventTriggerConfig
            ? {
                replicaCompletionCount: configuration.eventTriggerConfig.replicaCompletionCount ?? 1,
                parallelism: configuration.eventTriggerConfig.parallelism ?? 1,
                scale: configuration.eventTriggerConfig.scale,
              }
            : undefined,
          registries: configuration.registries,
          secrets: configuration.secrets?.map((s) => ({
            name: s.name,
            value: s.value,
            keyVaultUrl: s.keyVaultUrl,
            identity: s.identity,
          })),
        },

        template: {
          containers: template.containers.map((c) => ({
            ...c,
            name: c.name,
            image: c.image,
            resources: c.resources ?? {
              cpu: 0.25,
              memory: '0.5Gi',
            },
          })),
          initContainers: template.initContainers?.map((ic) => ({
            ...ic,
            name: ic.name,
            image: ic.image,
          })),
          volumes: template.volumes,
        },
      },
      { ...this.opts, parent: this, deletedWith: this },
    );
  }
}
