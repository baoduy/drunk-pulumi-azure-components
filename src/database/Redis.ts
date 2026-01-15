import * as pulumi from '@pulumi/pulumi';
import * as redis from '@pulumi/azure-native/redis';
import * as vault from '../vault';
import * as vnet from '../vnet';
import { PrivateEndpointType } from '../vnet';

import { BaseResourceComponent, CommonBaseArgs } from '../base';
import { convertToIpRange } from './helpers';
import { zoneHelper } from '../helpers';
import * as types from '../types';

export interface RedisArgs
  extends
    CommonBaseArgs,
    Partial<
      Pick<
        redis.RedisArgs,
        'zones' | 'redisVersion' | 'replicasPerMaster' | 'replicasPerPrimary' | 'tenantSettings' | 'redisConfiguration'
      >
    >,
    Partial<Pick<redis.PatchScheduleArgs, 'scheduleEntries'>> {
  sku: {
    /**
     * The size of the Redis cache to deploy. Valid values: for C (Basic/Standard) family (0, 1, 2, 3, 4, 5, 6), for P (Premium) family (1, 2, 3, 4).
     */
    capacity: pulumi.Input<number>;
    /**
     * The SKU family to use. Valid values: (C, P). (C = Basic/Standard, P = Premium).
     */
    family: 'C' | 'P';
    /**
     * The type of Redis cache to deploy. Valid values: (Basic, Standard, Premium)
     */
    name: 'Basic' | 'Standard' | 'Premium';
  };
  disableAccessKeyAuthentication: boolean;
  additionalUserAssignedIds?: Array<{
    name: string;
    accessPolicy: 'Data Owner' | 'Data Contributor' | 'Data Reader';
    clientId: pulumi.Input<string>;
  }>;
  network?: {
    allowAllInbound?: boolean;
    subnetId?: pulumi.Input<string>;
    staticIP?: pulumi.Input<string>;
    privateLink?: PrivateEndpointType;
    ipRules?: pulumi.Input<pulumi.Input<string>[]>;
  };
  lock?: boolean;
}

export class Redis extends BaseResourceComponent<RedisArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;
  public privateLink: ReturnType<vnet.PrivateEndpoint['getOutputs']> | undefined;

  constructor(name: string, args: RedisArgs, opts?: pulumi.ComponentResourceOptions) {
    super('Redis', name, args, opts);

    const server = this.createRedis();
    this.createNetwork(server);
    this.createMaintenance(server);
    this.AccessPolicyAssignments(server);
    this.addSecretsToVault(server);

    if (args.lock) this.lockFromDeleting(server);

    this.id = server.id;
    this.resourceName = server.name;

    this.registerOutputs();
  }

  public getOutputs(): types.ResourceOutputs & { privateLink?: ReturnType<vnet.PrivateEndpoint['getOutputs']> } {
    return {
      id: this.id,
      resourceName: this.resourceName,
      resourceGroupName: pulumi.output(this.args.rsGroup.resourceGroupName),
      privateLink: this.privateLink,
    };
  }

  private createRedis() {
    const { rsGroup, enableResourceIdentity, network, lock, defaultUAssignedId, ...props } = this.args;

    const sku = props.sku ?? { name: 'Basic', family: 'C', capacity: 0 };

    return new redis.Redis(
      this.name,
      {
        ...props,
        ...rsGroup,
        sku,
        redisVersion: props.redisVersion ?? '6.0',
        minimumTlsVersion: '1.2',
        enableNonSslPort: false,
        subnetId: network?.subnetId,
        staticIP: network?.staticIP,
        publicNetworkAccess: network?.privateLink ? 'Disabled' : 'Enabled',
        updateChannel: redis.UpdateChannel.Stable,
        zones: sku.name === 'Premium' ? zoneHelper.getDefaultZones(props.zones) : undefined,

        identity: enableResourceIdentity
          ? {
              type: defaultUAssignedId
                ? redis.ManagedServiceIdentityType.UserAssigned
                : redis.ManagedServiceIdentityType.SystemAssigned,
              userAssignedIdentities: defaultUAssignedId ? [defaultUAssignedId.id] : undefined,
            }
          : undefined,
      },
      { ...this.opts, protect: lock ?? this.opts?.protect, parent: this, ignoreChanges: ['name'] },
    );
  }

  private AccessPolicyAssignments(server: redis.Redis) {
    const { rsGroup, defaultUAssignedId, additionalUserAssignedIds } = this.args;
    if (defaultUAssignedId)
      new redis.AccessPolicyAssignment(
        `${this.name}-default-uid-policy`,
        {
          ...rsGroup,
          accessPolicyName: 'Data Contributor',
          cacheName: server.name,
          objectId: defaultUAssignedId.clientId,
          objectIdAlias: defaultUAssignedId.clientId,
        },
        { dependsOn: server, deletedWith: server, parent: this },
      );

    if (additionalUserAssignedIds) {
      additionalUserAssignedIds.map((u) => {
        return new redis.AccessPolicyAssignment(
          `${this.name}-${u.name}-${u.accessPolicy}`,
          {
            ...rsGroup,
            accessPolicyName: u.accessPolicy,
            cacheName: server.name,
            objectId: u.clientId,
            objectIdAlias: u.clientId,
          },
          { dependsOn: server, deletedWith: server, parent: this },
        );
      });
    }
  }

  private createMaintenance(rds: redis.Redis) {
    const { rsGroup, scheduleEntries } = this.args;

    // Use provided scheduleEntries or default to Sunday maintenance
    const schedule = scheduleEntries ?? [
      {
        dayOfWeek: redis.DayOfWeek.Sunday,
        startHourUtc: 0,
        maintenanceWindow: 'PT5H', // 5 hour maintenance window
      },
    ];

    return new redis.PatchSchedule(
      this.name,
      {
        ...rsGroup,
        name: rds.name,
        default: 'default',
        scheduleEntries: schedule,
      },
      { dependsOn: rds, deletedWith: rds, parent: this },
    );
  }

  private createNetwork(server: redis.Redis) {
    const { rsGroup, network } = this.args;
    const sanitizedName = this.name.replace(/[^a-zA-Z0-9_]/g, '_');

    if (network?.allowAllInbound) {
      new redis.FirewallRule(
        `${sanitizedName}-firewall-allow-all`,
        {
          ...rsGroup,
          ruleName: `${sanitizedName}_firewall_allow_all`,
          cacheName: server.name,
          startIP: '0.0.0.0',
          endIP: '255.255.255.255',
        },
        { dependsOn: server, parent: this },
      );
    } else if (network?.ipRules) {
      pulumi.output(network.ipRules).apply((ips) =>
        convertToIpRange(ips).map((f, i) => {
          return new redis.FirewallRule(
            `${sanitizedName}-firewall-${i}`,
            {
              ...rsGroup,
              ruleName: `${sanitizedName}_firewall_${i}`,
              cacheName: server.name,
              startIP: f.start,
              endIP: f.end,
            },
            { dependsOn: server, parent: this },
          );
        }),
      );
    }

    if (network?.privateLink) {
      this.privateLink = new vnet.PrivateEndpoint(
        this.name,
        {
          ...network.privateLink,
          rsGroup,
          type: 'redis',
          resourceInfo: server,
        },
        { dependsOn: server, parent: this },
      ).getOutputs();
    }
  }

  private addSecretsToVault(server: redis.Redis) {
    const { rsGroup, vaultInfo, disableAccessKeyAuthentication } = this.args;
    if (!vaultInfo) return;

    return server.hostName.apply(async (h) => {
      if (!h) return;

      const keys = redis.listRedisKeysOutput({
        name: server.name,
        resourceGroupName: rsGroup.resourceGroupName,
      });

      return new vault.VaultSecrets(
        this.name,
        {
          vaultInfo,
          secrets: {
            [`${this.name}-redis-host`]: { value: h, contentType: `Redis host` },
            [`${this.name}-redis-pass`]: { value: keys.primaryKey, contentType: `Redis pass` },
            [`${this.name}-redis-port`]: { value: '6380', contentType: `Redis port` },
            [`${this.name}-redis-conn`]: {
              value: disableAccessKeyAuthentication
                ? pulumi.interpolate`rediss://${h}:6380`
                : pulumi.interpolate`rediss://:${keys.primaryKey}@${h}:6380`,
              contentType: `Redis Connection String For General Use`,
            },
            [`${this.name}-redis-net-conn`]: {
              value: disableAccessKeyAuthentication
                ? pulumi.interpolate`${h}:6380,ssl=True,abortConnect=False`
                : pulumi.interpolate`${h}:6380,password=${keys.primaryKey},ssl=True,abortConnect=False`,
              contentType: `Redis Connection String For .NET Apps`,
            },
          },
        },
        { dependsOn: server, parent: this },
      );
    });
  }
}
