import * as pulumi from '@pulumi/pulumi';
import { BaseArgs, BaseResourceComponent } from '../base';
import * as redis from '@pulumi/azure-native/redis';
import * as types from '../types';
import { convertToIpRange } from './helpers';
import { PrivateEndpointType } from '../vnet';
import * as vnet from '../vnet';
import * as vault from '../vault';

export interface RedisArgs
  extends BaseArgs,
    types.WithResourceGroupInputs,
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
      | 'identity'
    > {
  network?: {
    subnetId: pulumi.Input<string>;
    staticIP?: pulumi.Input<string>;
    privateLink?: PrivateEndpointType;
    ipRules?: pulumi.Input<pulumi.Input<string>[]>;
  };
  lock?: boolean;
}

export class Redis extends BaseResourceComponent<RedisArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: RedisArgs, opts?: pulumi.ComponentResourceOptions) {
    super('Redis', name, args, opts);

    const server = this.createRedis();
    this.createNetwork(server);
    this.addSecretsToVault(server);

    if (args.lock) this.lockFromDeleting(server);

    this.id = server.id;
    this.resourceName = server.name;

    this.registerOutputs({
      id: this.id,
      resourceName: this.resourceName,
    });
  }

  private createRedis() {
    const { rsGroup, network, ...props } = this.args;

    const server = new redis.Redis(
      this.name,
      {
        ...props,
        ...rsGroup,

        minimumTlsVersion: '1.2',
        enableNonSslPort: false,
        redisVersion: props.redisVersion ?? '6.0',
        subnetId: network?.subnetId,
        staticIP: network?.staticIP,
        publicNetworkAccess: network?.privateLink ? 'Disabled' : 'Enabled',
        updateChannel: 'Stable',
      },
      { ...this.opts, parent: this },
    );

    return server;
  }

  private createNetwork(server: redis.Redis) {
    const { rsGroup, network } = this.args;

    if (network?.ipRules) {
      pulumi.output(network.ipRules).apply((ips) =>
        convertToIpRange(ips).map(
          (f, i) =>
            new redis.FirewallRule(
              `${this.name}-firewall-${i}`,
              {
                ...rsGroup,
                //ruleName: `${this.name}-firewall-${i}`,
                cacheName: server.name,
                startIP: f.start,
                endIP: f.end,
              },
              { dependsOn: server, parent: this },
            ),
        ),
      );
    }

    if (network?.privateLink) {
      new vnet.PrivateEndpoint(
        this.name,
        {
          ...network.privateLink,
          rsGroup,
          type: 'redis',
          resourceInfo: server,
        },
        { dependsOn: server, parent: this },
      );
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
            [`${this.name}-host`]: { value: h, contentType: `Redis host` },
            [`${this.name}-pass`]: { value: keys.primaryKey, contentType: `Redis pass` },
            [`${this.name}-port`]: { value: '6380', contentType: `Redis port` },
            [`${this.name}-conn`]: {
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
