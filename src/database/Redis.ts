import * as redis from '@pulumi/azure-native/redis';
import * as pulumi from '@pulumi/pulumi';
import { BaseArgs, BaseResourceComponent } from '../base';
import * as types from '../types';
import * as vault from '../vault';
import * as vnet from '../vnet';
import { PrivateEndpointType } from '../vnet';
import { convertToIpRange } from './helpers';

export interface RedisArgs
  extends BaseArgs,
    types.WithResourceGroupInputs,
    types.WithUserAssignedIdentity,
    Partial<
      Pick<
        redis.RedisArgs,
        | 'sku'
        | 'zones'
        | 'disableAccessKeyAuthentication'
        | 'redisVersion'
        | 'replicasPerMaster'
        | 'replicasPerPrimary'
        | 'tenantSettings'
        | 'redisConfiguration'
      >
    >,
    Partial<Pick<redis.PatchScheduleArgs, 'scheduleEntries'>> {
  network?: {
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
    this.addSecretsToVault(server);

    if (args.lock) this.lockFromDeleting(server);

    this.id = server.id;
    this.resourceName = server.name;

    this.registerOutputs();
  }

  public getOutputs() {
    return {
      id: this.id,
      resourceName: this.resourceName,
      privateLink: this.privateLink,
    };
  }

  private createRedis() {
    const { rsGroup, network, lock, defaultUAssignedId, ...props } = this.args;

    const server = new redis.Redis(
      this.name,
      {
        ...props,
        ...rsGroup,
        sku: props.sku ?? { name: 'Basic', family: 'C', capacity: 0 },
        redisVersion: props.redisVersion ?? '6.0',
        minimumTlsVersion: '1.2',
        enableNonSslPort: false,
        subnetId: network?.subnetId,
        staticIP: network?.staticIP,
        publicNetworkAccess: network?.privateLink ? 'Disabled' : 'Enabled',
        updateChannel: redis.UpdateChannel.Stable,

        identity: {
          type: defaultUAssignedId
            ? redis.ManagedServiceIdentityType.UserAssigned
            : redis.ManagedServiceIdentityType.SystemAssigned,
          userAssignedIdentities: defaultUAssignedId ? [defaultUAssignedId.id] : undefined,
        },
      },
      { ...this.opts, protect: lock ?? this.opts?.protect, parent: this, ignoreChanges: ['name'] },
    );

    return server;
  }

  private createMaintenance(rds: redis.Redis) {
    const { rsGroup, scheduleEntries } = this.args;
    if (!scheduleEntries) return undefined;

    return new redis.PatchSchedule(
      this.name,
      {
        ...rsGroup,
        name: rds.name,
        default: 'default',
        scheduleEntries,
      },
      { dependsOn: rds, deletedWith: rds, parent: this },
    );
  }

  private createNetwork(server: redis.Redis) {
    const { rsGroup, network } = this.args;

    if (network?.ipRules) {
      pulumi.output(network.ipRules).apply((ips) =>
        convertToIpRange(ips).map((f, i) => {
          const sanitizedName = this.name.replace(/[^a-zA-Z0-9_]/g, '_');
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
    const { rsGroup, vaultInfo } = this.args;
    if (!vaultInfo) return;

    return server.hostName.apply(async (h) => {
      if (!h) return;

      const keys = await redis.listRedisKeysOutput({
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
              value: pulumi.interpolate`${h}:6380,password=${keys.primaryKey},ssl=True,abortConnect=False`,
              contentType: `Redis conn`,
            },
          },
        },
        { dependsOn: server, parent: this },
      );
    });
  }
}
