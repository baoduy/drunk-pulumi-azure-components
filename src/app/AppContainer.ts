import * as app from '@pulumi/azure-native/app';
import * as inputs from '@pulumi/azure-native/types/input';
import * as pulumi from '@pulumi/pulumi';
import * as types from '../types';
import * as vnet from '../vnet';

import { BaseResourceComponent, CommonBaseArgs } from '../base';

/**
 * Azure Container App component providing secure, serverless container execution
 * with auto-scaling, ingress, and managed environment integration.
 */
export interface AppContainerArgs
  extends CommonBaseArgs,
    types.WithUserAssignedIdentity,
    Partial<Pick<app.ContainerAppArgs, 'workloadProfileName' | 'extendedLocation'>> {
  /** Resource ID of the Container Apps Managed Environment */
  managedEnvironmentId: pulumi.Input<string>;

  /** Container configuration */
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
        /** Container image (e.g., 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest') */
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
    /** Scaling configuration */
    scale?: Partial<
      Pick<inputs.app.ScaleArgs, 'cooldownPeriod' | 'pollingInterval'> & {
        minReplicas?: number;
        maxReplicas?: number;
        rules?: pulumi.Input<pulumi.Input<inputs.app.ScaleRuleArgs>[]>;
      }
    >;
    /** Volume definitions */
    volumes?: pulumi.Input<pulumi.Input<inputs.app.VolumeArgs>[]>;
    /** Revision suffix */
    revisionSuffix?: pulumi.Input<string>;
    /** Service bindings */
    serviceBinds?: pulumi.Input<pulumi.Input<inputs.app.ServiceBindArgs>[]>;
    /** Graceful termination period (seconds) */
    terminationGracePeriodSeconds?: pulumi.Input<number>;
  };

  /** Configuration settings */
  configuration?: {
    /** Revisions mode: 'Single' or 'Multiple' */
    activeRevisionsMode?: app.ActiveRevisionsMode;
    /** Ingress settings */
    ingress?: Partial<
      Pick<
        inputs.app.IngressArgs,
        | 'allowInsecure'
        | 'clientCertificateMode'
        | 'corsPolicy'
        | 'customDomains'
        | 'exposedPort'
        | 'ipSecurityRestrictions'
        | 'stickySessions'
        | 'targetPortHttpScheme'
        | 'transport'
        | 'additionalPortMappings'
      >
    > & {
      /** Enable external ingress */
      external?: boolean;
      /** Target port */
      targetPort?: number;
      /** Traffic weights */
      traffic?: pulumi.Input<pulumi.Input<inputs.app.TrafficWeightArgs>[]>;
    };
    /** Dapr configuration */
    dapr?: Partial<
      Pick<
        inputs.app.DaprArgs,
        | 'appHealth'
        | 'appId'
        | 'appPort'
        | 'appProtocol'
        | 'enableApiLogging'
        | 'httpMaxRequestSize'
        | 'httpReadBufferSize'
        | 'logLevel'
        | 'maxConcurrency'
      >
    > & {
      enabled?: boolean;
    };
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
    /** Max inactive revisions */
    maxInactiveRevisions?: pulumi.Input<number>;
  };

  /** Network configuration */
  network?: {
    privateLink?: vnet.PrivateEndpointType;
  };
}

export class AppContainer extends BaseResourceComponent<AppContainerArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;
  public readonly fqdn: pulumi.Output<string | undefined>;
  public readonly latestRevisionName: pulumi.Output<string>;
  public readonly outboundIpAddresses: pulumi.Output<string[]>;

  constructor(name: string, args: AppContainerArgs, opts?: pulumi.ComponentResourceOptions) {
    super('AppContainer', name, args, opts);

    const containerApp = this.createContainerApp();
    this.createPrivateLink(containerApp);

    this.id = containerApp.id;
    this.resourceName = containerApp.name;
    this.fqdn = containerApp.configuration.apply((c) => c?.ingress?.fqdn);
    this.latestRevisionName = containerApp.latestRevisionName;
    this.outboundIpAddresses = containerApp.outboundIpAddresses;

    this.addIdentityToRole('readOnly', containerApp.identity);

    this.registerOutputs();
  }

  public getOutputs() {
    return {
      resourceName: this.resourceName,
      id: this.id,
      fqdn: this.fqdn,
      latestRevisionName: this.latestRevisionName,
      outboundIpAddresses: this.outboundIpAddresses,
      vaultSecrets: this.vaultSecrets,
    };
  }

  private createContainerApp() {
    const { rsGroup, defaultUAssignedId, managedEnvironmentId, template, configuration, network, ...props } =
      this.args;

    return new app.ContainerApp(
      this.name,
      {
        ...props,
        ...rsGroup,
        managedEnvironmentId,

        identity: {
          type: defaultUAssignedId
            ? app.ManagedServiceIdentityType.SystemAssigned_UserAssigned
            : app.ManagedServiceIdentityType.SystemAssigned,
          userAssignedIdentities: defaultUAssignedId ? [defaultUAssignedId.id] : undefined,
        },

        configuration: configuration
          ? {
              activeRevisionsMode: configuration.activeRevisionsMode ?? app.ActiveRevisionsMode.Single,
              ingress: configuration.ingress
                ? {
                    ...configuration.ingress,
                    external: configuration.ingress.external ?? false,
                    targetPort: configuration.ingress.targetPort ?? 80,
                    allowInsecure: configuration.ingress.allowInsecure ?? false,
                    traffic: configuration.ingress.traffic,
                  }
                : undefined,
              dapr: configuration.dapr?.enabled
                ? {
                    ...configuration.dapr,
                    enabled: true,
                  }
                : undefined,
              registries: configuration.registries,
              secrets: configuration.secrets?.map((s) => ({
                name: s.name,
                value: s.value,
                keyVaultUrl: s.keyVaultUrl,
                identity: s.identity,
              })),
              maxInactiveRevisions: configuration.maxInactiveRevisions,
            }
          : undefined,

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
          scale: template.scale
            ? {
                cooldownPeriod: template.scale.cooldownPeriod,
                maxReplicas: template.scale.maxReplicas ?? 10,
                minReplicas: template.scale.minReplicas ?? 0,
                pollingInterval: template.scale.pollingInterval,
                rules: template.scale.rules,
              }
            : {
                minReplicas: 0,
                maxReplicas: 10,
              },
          volumes: template.volumes,
          revisionSuffix: template.revisionSuffix,
          serviceBinds: template.serviceBinds,
          terminationGracePeriodSeconds: template.terminationGracePeriodSeconds ?? 30,
        },
      },
      { ...this.opts, parent: this },
    );
  }

  private createPrivateLink(containerApp: app.ContainerApp) {
    const { rsGroup, network } = this.args;
    if (!network?.privateLink) return undefined;

    return new vnet.PrivateEndpoint(
      this.name,
      {
        ...network.privateLink,
        resourceInfo: containerApp,
        rsGroup,
        type: 'containerapp',
      },
      { dependsOn: containerApp, deletedWith: containerApp, parent: this },
    );
  }
}
