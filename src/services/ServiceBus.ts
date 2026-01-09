import * as bus from '@pulumi/azure-native/servicebus';
import * as pulumi from '@pulumi/pulumi';
import * as types from '../types';
import * as vault from '../vault';

import { BaseResourceComponent, CommonBaseArgs } from '../base';

import { PrivateEndpoint } from '../vnet';
import { azureEnv, zoneHelper } from '../helpers';

const defaultQueueOptions: Partial<bus.QueueArgs> = {
  //duplicateDetectionHistoryTimeWindow: 'P10M',
  //maxMessageSizeInKilobytes: 1024,
  //autoDeleteOnIdle: isPrd ? 'P180D' : 'P90D',
  maxDeliveryCount: 10,
  enableBatchedOperations: true,
  enablePartitioning: false,
  maxSizeInMegabytes: 1024,
  //Default is 'PT1M' (1 minute) and max is 5 minutes.
  lockDuration: 'PT1M',
  defaultMessageTimeToLive: azureEnv.isPrd ? 'P14D' : 'P5D',
  deadLetteringOnMessageExpiration: true,
};

const defaultTopicOptions: Partial<bus.TopicArgs> = {
  //duplicateDetectionHistoryTimeWindow: 'P10M',
  //maxMessageSizeInKilobytes: 1024,
  //autoDeleteOnIdle: isPrd ? 'P180D' : 'P90D',
  defaultMessageTimeToLive: azureEnv.isPrd ? 'P14D' : 'P5D',
  enablePartitioning: false,
  maxSizeInMegabytes: 1024,
  enableBatchedOperations: true,
};

const defaultSubOptions: Partial<bus.SubscriptionArgs> = {
  duplicateDetectionHistoryTimeWindow: 'P10M',
  //autoDeleteOnIdle: isPrd ? 'P180D' : 'P90D',
  defaultMessageTimeToLive: azureEnv.isPrd ? 'P14D' : 'P5D',
  enableBatchedOperations: true,
  deadLetteringOnMessageExpiration: true,
  lockDuration: 'PT1M',
  maxDeliveryCount: 10,
};

type SubscriptionsType = Record<
  string,
  Omit<bus.SubscriptionArgs, 'namespaceName' | 'topicName' | 'subscriptionName' | 'resourceGroupName' | 'status'>
>;

export interface ServiceBusArgs
  extends
    CommonBaseArgs,
    types.WithEncryptionEnabler,
    types.WithNetworkArgs,
    Partial<Pick<bus.NamespaceArgs, 'sku' | 'zoneRedundant' | 'alternateName' | 'premiumMessagingPartitions'>> {
  disableLocalAuth: boolean;
  sku: {
    /**
     * Messaging units for your service bus premium namespace. Valid capacities are {1, 2, 4, 8, 16} multiples of your properties.premiumMessagingPartitions setting. For example, If properties.premiumMessagingPartitions is 1 then possible capacity values are 1, 2, 4, 8, and 16. If properties.premiumMessagingPartitions is 4 then possible capacity values are 4, 8, 16, 32 and 64
     */
    capacity?: pulumi.Input<number>;
    /**
     * Name of this SKU.
     */
    name: bus.SkuName;
    /**
     * The billing tier of this particular SKU.
     */
    tier?: bus.SkuTier;
  };

  queues?: Record<string, Omit<bus.QueueArgs, 'namespaceName' | 'queueName' | 'resourceGroupName' | 'status'>>;
  topics?: Record<
    string,
    Omit<bus.TopicArgs, 'namespaceName' | 'topicName' | 'resourceGroupName' | 'status'> & {
      subscriptions?: SubscriptionsType;
    }
  >;
}

export class ServiceBus extends BaseResourceComponent<ServiceBusArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: ServiceBusArgs, opts?: pulumi.ComponentResourceOptions) {
    super('ServiceBus', name, args, opts);

    const service = this.createBusNamespace();
    this.createNetwork(service);
    this.createConnectionStrings(service);

    this.createQueues(service);
    this.createTopics(service);

    this.id = service.id;
    this.resourceName = service.name;
    this.registerOutputs();
  }

  public getOutputs() {
    return {
      id: this.id,
      resourceName: this.resourceName,
    };
  }

  private createBusNamespace() {
    const {
      rsGroup,
      enableResourceIdentity,
      defaultUAssignedId,
      vaultInfo,
      enableEncryption,
      network,
      disableLocalAuth,
      ...props
    } = this.args;
    const encryptionKey = enableEncryption && props.sku.name === 'Premium' ? this.getEncryptionKey() : undefined;

    const service = new bus.Namespace(
      this.name,
      {
        ...props,
        ...rsGroup,
        minimumTlsVersion: '1.2',
        disableLocalAuth,
        zoneRedundant: props.zoneRedundant ?? (zoneHelper.getDefaultZones(undefined) ? true : undefined),

        identity: enableResourceIdentity
          ? {
              type: defaultUAssignedId
                ? bus.ManagedServiceIdentityType.SystemAssigned_UserAssigned
                : bus.ManagedServiceIdentityType.SystemAssigned,
              //all uuid must assign here before use
              userAssignedIdentities: defaultUAssignedId ? [defaultUAssignedId.id] : undefined,
            }
          : undefined,

        encryption: encryptionKey
          ? {
              keySource: bus.KeySource.Microsoft_KeyVault,
              keyVaultProperties: [
                {
                  ...encryptionKey,
                  identity: defaultUAssignedId ? { userAssignedIdentity: defaultUAssignedId.id } : undefined,
                },
              ],
              requireInfrastructureEncryption: true,
            }
          : undefined,

        publicNetworkAccess: network?.publicNetworkAccess ? 'Enabled' : network?.privateLink ? 'Disabled' : 'Enabled',
      },
      {
        ...this.opts,
        parent: this,
      },
    );

    //Add Root Manage Shared Access Key to Key Vault
    this.addConnectionsToVault(service);
    this.addSecret('bus-hostname', pulumi.interpolate`${service.name}.servicebus.windows.net`);
    if (disableLocalAuth) {
      this.addSecret('bus-default-conn', pulumi.interpolate`sb://${service.name}.servicebus.windows.net`);
    }

    return service;
  }

  private createNetwork(service: bus.Namespace) {
    const { rsGroup, network } = this.args;
    if (!network) return;

    new bus.NamespaceNetworkRuleSet(
      this.name,
      {
        ...rsGroup,
        namespaceName: service.name,
        defaultAction: network.defaultAction ? network.defaultAction : 'Allow',
        trustedServiceAccessEnabled: true,

        ipRules: network.ipRules
          ? pulumi.output(network.ipRules).apply((ips) =>
              ips.map((i) => ({
                ipMask: i,
                action: bus.NetworkRuleIPAction.Allow,
              })),
            )
          : undefined,
        virtualNetworkRules: network.vnetRules
          ? pulumi.output(network.vnetRules).apply((vIds) =>
              vIds.map((v) => ({
                ignoreMissingVnetServiceEndpoint: v.ignoreMissingVnetServiceEndpoint,
                subnet: { id: v.subnetId },
              })),
            )
          : undefined,
      },
      { dependsOn: service, parent: this },
    );

    if (network.privateLink) {
      return new PrivateEndpoint(
        this.name,
        { ...network.privateLink, resourceInfo: service, rsGroup, type: 'serviceBus' },
        { dependsOn: service, parent: this },
      );
    }
  }

  private createConnectionStrings(service: bus.Namespace) {
    const { disableLocalAuth, rsGroup } = this.args;
    if (disableLocalAuth) return;

    const listenRule = new bus.NamespaceAuthorizationRule(
      `${this.name}-listen`,
      {
        ...rsGroup,
        namespaceName: service.name,
        authorizationRuleName: `${this.name}-listen`,
        rights: ['Listen'],
      },
      { dependsOn: service, parent: this },
    );

    const sendRule = new bus.NamespaceAuthorizationRule(
      `${this.name}-send`,
      {
        ...rsGroup,
        namespaceName: service.name,
        authorizationRuleName: `${this.name}-send`,
        rights: ['Listen', 'Send'],
      },
      { dependsOn: service, parent: this },
    );

    this.addConnectionsToVault(service, listenRule);
    this.addConnectionsToVault(service, sendRule);
  }

  private addConnectionsToVault(service: bus.Namespace, rule?: bus.NamespaceAuthorizationRule) {
    const { rsGroup, vaultInfo } = this.args;
    if (!vaultInfo) return;

    const ruleName = rule ? rule.name : 'RootManageSharedAccessKey';
    pulumi.output([service.name, ruleName, rsGroup.resourceGroupName]).apply(async ([svName, rName, rsName]) => {
      const keys = await bus.listNamespaceKeys({
        resourceGroupName: rsName,
        authorizationRuleName: rName,
        namespaceName: svName,
      });

      new vault.VaultSecrets(
        `${this.name}-${rName}`,
        {
          vaultInfo,
          secrets: {
            [`${this.name}-${rName}-primary-conn`]: {
              value: keys.primaryConnectionString,
              contentType: 'ServiceBus Primary ConnectionString',
            },
            [`${this.name}-${rName}-secondary-conn`]: {
              value: keys.secondaryConnectionString,
              contentType: 'ServiceBus Secondary ConnectionString',
            },
          },
        },
        { dependsOn: rule ? [service, rule] : [service], parent: this },
      );
    });
  }

  private createQueues(service: bus.Namespace) {
    const { queues, rsGroup } = this.args;
    if (!queues) return;

    Object.keys(queues).map((k) => {
      const queueOps = queues[k];
      return new bus.Queue(
        `${this.name}-${k}`,
        {
          ...rsGroup,
          queueName: k,
          namespaceName: service.name,
          ...defaultQueueOptions,
          ...queueOps,
        },
        { dependsOn: service, parent: this },
      );
    });
  }

  private createTopics(service: bus.Namespace) {
    const { topics, rsGroup } = this.args;
    if (!topics) return;

    Object.keys(topics).map((k) => {
      const topicOps = topics[k];
      const topic = new bus.Topic(
        `${this.name}-${k}`,
        {
          ...rsGroup,
          topicName: k,
          namespaceName: service.name,
          ...defaultTopicOptions,
          ...topicOps,
        },
        { dependsOn: service, parent: this },
      );

      if (topicOps.subscriptions) this.createSubscriptions(service, topic, topicOps.subscriptions);
      return topic;
    });
  }

  private createSubscriptions(service: bus.Namespace, topic: bus.Topic, subscriptions: SubscriptionsType) {
    const { rsGroup } = this.args;
    topic.name.apply((topicName) =>
      Object.keys(subscriptions).map((k) => {
        const subOps = subscriptions[k];
        return new bus.Subscription(
          `${this.name}-${topicName}-${k}`,
          {
            ...rsGroup,
            topicName: topicName,
            namespaceName: service.name,
            subscriptionName: k,
            ...defaultTopicOptions,
            ...subOps,
          },
          { dependsOn: [service, topic], parent: this },
        );
      }),
    );
  }
}
