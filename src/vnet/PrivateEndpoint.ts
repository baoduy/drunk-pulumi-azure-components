import * as helpers from './helpers';
import * as network from '@pulumi/azure-native/network';
import * as pulumi from '@pulumi/pulumi';
import * as types from '../types';

import { BaseComponent } from '../base';
import { PrivateDnsZone } from './PrivateDnsZone';
import { getComponentResourceType } from '../base/helpers';
import { rsHelpers } from '../helpers';

export type PrivateEndpointServices =
  | 'azApi'
  | 'azSearch'
  | 'azConfig'
  | 'azurecr'
  | 'containerapp'
  | 'keyVault'
  | 'mysql'
  | 'postgres'
  | 'redis'
  | 'serviceBus'
  | 'signalR'
  | 'sqlServer'
  | 'storage';

export type StorageEndpointTypes = 'blob' | 'dfs' | 'file' | 'queue' | 'table' | 'web';

export type PrivateEndpointType = {
  subnetInfo: {
    /** Specify the IP address of the subnet as a static IP instead of using DHCP */
    staticPrivateIp?: pulumi.Input<string>;
    subnetId: pulumi.Input<string>;
  };
  /** Link the private DNS zone to these Vnet also */
  vnetLinks?: Array<pulumi.Input<{ vnetId: string }>>;
};

export interface PrivateEndpointArgs extends types.WithResourceGroupInputs, PrivateEndpointType {
  type: PrivateEndpointServices;
  storageType?: StorageEndpointTypes;
  resourceInfo: pulumi.CustomResource;
}

export class PrivateEndpoint extends BaseComponent<PrivateEndpointArgs> {
  public readonly privateEndpoint: pulumi.Output<{
    privateIpAddresses: string[];
    id: string;
  }>;
  public readonly privateDnsZone: types.ResourceOutputs;

  constructor(name: string, args: PrivateEndpointArgs, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('PrivateEndpoint'), name, args, opts);

    const linkInfo = this.getPrivateEndpointProps();

    const privateEndpoint = new network.PrivateEndpoint(
      name,
      {
        ...args.rsGroup,
        subnet: { id: args.subnetInfo.subnetId },
        customDnsConfigs: args.subnetInfo.staticPrivateIp
          ? [
              {
                ipAddresses: [args.subnetInfo.staticPrivateIp],
              },
            ]
          : undefined,
        ipConfigurations: args.subnetInfo.staticPrivateIp
          ? [
              {
                name: `${name}-ipconfig`,
                groupId: linkInfo.linkServiceGroupIds[0],
                memberName: linkInfo.linkServiceGroupIds[0],
                privateIPAddress: args.subnetInfo.staticPrivateIp,
              },
            ]
          : undefined,
        privateLinkServiceConnections: [
          {
            name: `${name}-conn`,
            groupIds: linkInfo.linkServiceGroupIds,
            privateLinkServiceId: args.resourceInfo.id,
          },
        ],
      },
      {
        ...opts,
        parent: this,
      },
    );

    const privateIpAddresses = privateEndpoint.customDnsConfigs.apply((c) => c!.flatMap((i) => i!.ipAddresses!));

    const zone = pulumi.output(args.resourceInfo.id).apply((rsId) => {
      const mainVnetId = pulumi
        .output(args.subnetInfo.subnetId)
        .apply((id) => ({ vnetId: helpers.getVnetIdFromSubnetId(id) }));

      const vnetLinks = args.vnetLinks ? [...args.vnetLinks, mainVnetId] : [mainVnetId];

      return new PrivateDnsZone(
        `${rsHelpers.getRsNameFromId(rsId)}.${linkInfo.privateDnsZoneName}`,
        {
          rsGroup: args.rsGroup,
          vnetLinks,
          aRecords: [
            { name: '@', ipv4Address: privateIpAddresses },
            { name: '*', ipv4Address: privateIpAddresses },
          ],
        },
        {
          dependsOn: privateEndpoint,
          deletedWith: privateEndpoint,
          parent: this,
        },
      ).getOutputs();
    });

    this.privateEndpoint = pulumi.output({
      id: privateEndpoint.id,
      privateIpAddresses,
    });

    this.privateDnsZone = zone;

    this.registerOutputs();
  }

  public getOutputs() {
    return {
      privateEndpoint: this.privateEndpoint,
      privateDnsZone: this.privateDnsZone,
    };
  }

  private getPrivateEndpointProps(): {
    privateDnsZoneName: string;
    linkServiceGroupIds: string[];
  } {
    const { type, storageType } = this.args;
    switch (type) {
      case 'azApi':
        return {
          privateDnsZoneName: 'privatelink.azure-api.net',
          linkServiceGroupIds: ['Gateway'],
        };
      case 'azSearch':
        return {
          privateDnsZoneName: 'privatelink.search.windows.net',
          linkServiceGroupIds: ['searchService'],
        };
      case 'azConfig':
        return {
          privateDnsZoneName: 'privatelink.azconfig.io',
          linkServiceGroupIds: ['configurationStores'],
        };
      case 'azurecr':
        return {
          privateDnsZoneName: 'privatelink.azurecr.io',
          linkServiceGroupIds: ['azurecr'],
        };
      case 'containerapp':
        return {
          privateDnsZoneName: 'privatelink.azurecontainerapps.io',
          linkServiceGroupIds: ['containerApps'],
        };
      case 'keyVault':
        return {
          privateDnsZoneName: 'privatelink.vaultcore.azure.net',
          linkServiceGroupIds: ['vault'],
        };
      case 'mysql':
        return {
          privateDnsZoneName: 'mysql.database.azure.com',
          linkServiceGroupIds: ['mysql'],
        };
      case 'postgres':
        return {
          privateDnsZoneName: 'privatelink.postgres.database.azure.com',
          linkServiceGroupIds: ['postgresqlServer'],
        };
      case 'redis':
        return {
          privateDnsZoneName: 'privatelink.redis.cache.windows.net',
          linkServiceGroupIds: ['redisCache'],
        };
      case 'serviceBus':
        return {
          privateDnsZoneName: 'privatelink.servicebus.windows.net',
          linkServiceGroupIds: ['namespace'],
        };
      case 'signalR':
        return {
          privateDnsZoneName: 'privatelink.service.signalr.net',
          linkServiceGroupIds: ['signalr'],
        };
      case 'sqlServer':
        return {
          privateDnsZoneName: 'privatelink.database.windows.net',
          linkServiceGroupIds: ['sqlServer'],
        };
      case 'storage':
        if (!storageType) {
          throw new Error('Storage type must be specified for storage private endpoints');
        }
        return {
          privateDnsZoneName: `privatelink.${storageType}.core.windows.net`,
          linkServiceGroupIds: [storageType],
        };
      default:
        throw new Error(`Unsupported private endpoint type: ${this.args.type}`);
    }
  }
}
