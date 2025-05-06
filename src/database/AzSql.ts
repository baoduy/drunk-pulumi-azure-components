import * as pulumi from '@pulumi/pulumi';
import { BaseArgs, BaseResourceComponent } from '../base';
import * as types from '../types';
import * as sql from '@pulumi/azure-native/sql';
import { azureEnv } from '../helpers';
import { convertToIpRange } from './helpers';
import * as vnet from '../vnet';

export interface AzSqlArgs
  extends BaseArgs,
    types.WithEncryptionEnabler,
    types.WithResourceGroupInputs,
    types.WithGroupRolesArgs,
    types.WithUserAssignedIdentity,
    Pick<
      sql.ServerArgs,
      'administratorLogin' | 'federatedClientId' | 'isIPv6Enabled' | 'restrictOutboundNetworkAccess' | 'version'
    > {
  administrators: {
    azureAdOnlyAuthentication?: boolean;
    adminGroup: { displayName: pulumi.Input<string>; objectId: pulumi.Input<string> };
  };
  elasticPool?: Pick<
    sql.ElasticPoolArgs,
    | 'autoPauseDelay'
    | 'availabilityZone'
    | 'highAvailabilityReplicaCount'
    | 'licenseType'
    | 'perDatabaseSettings'
    | 'preferredEnclaveType'
  > & {
    maxSizeGB: number;
    sku: {
      /**
       * Capacity of the particular SKU.
       */
      capacity?: 50 | 100 | 200 | 300 | 400 | 800 | 1200;
      /**
       * If the service has different generations of hardware, for the same SKU, then that can be captured here.
       */
      family?: pulumi.Input<string>;
      /**
       * The name of the SKU, typically, a letter + Number code, e.g. P3.
       */
      name: pulumi.Input<string>;
      /**
       * Size of the particular SKU
       */
      size?: pulumi.Input<string>;
      /**
       * The tier or edition of the particular SKU, e.g. Basic, Premium.
       */
      tier?: 'Standard' | 'Basic';
    };
  };
  network?: Omit<types.NetworkArgs, 'bypass' | 'defaultAction' | 'vnetRules'> & {
    acceptAllPublicConnection?: boolean;
    subnets?: pulumi.Input<Array<{ id: string }>>;
  };
  lock?: boolean;
  databases?: Record<string, FullSqlDbPropsType>;
}

export class AzSql extends BaseResourceComponent<AzSqlArgs> {
  constructor(name: string, args: AzSqlArgs, private opts?: pulumi.ComponentResourceOptions) {
    super('AzSql', name, args, opts);

    const server = this.createSql();
    const elastic = this.createElasticPool(server);

    this.createNetwork(server);

    if (args.lock) this.lockFromDeleting(server);
  }

  private createSql() {
    const { rsGroup, enableEncryption, defaultUAssignedId, administrators, network, ...props } = this.args;

    const password = this.createPassword();
    const encryptionKey = enableEncryption ? this.getEncryptionKey() : undefined;

    const sqlServer = new sql.Server(
      this.name,
      {
        ...props,
        ...rsGroup,
        version: this.args.version ?? '12.0',
        minimalTlsVersion: '1.2',

        identity: {
          type: defaultUAssignedId ? sql.IdentityType.SystemAssigned_UserAssigned : sql.IdentityType.SystemAssigned,
          userAssignedIdentities: defaultUAssignedId ? [defaultUAssignedId.id] : undefined,
        },

        primaryUserAssignedIdentityId: defaultUAssignedId?.id,
        administratorLogin: this.args.administratorLogin,
        administratorLoginPassword: password.value,
        keyId: encryptionKey?.id,

        administrators: {
          administratorType: administrators.adminGroup?.objectId ? sql.AdministratorType.ActiveDirectory : undefined,
          azureADOnlyAuthentication: administrators.adminGroup?.objectId
            ? administrators.azureAdOnlyAuthentication ?? true
            : false,

          principalType: sql.PrincipalType.Group,
          tenantId: azureEnv.tenantId,
          sid: administrators.adminGroup?.objectId,
          login: administrators.adminGroup?.displayName,
        },

        publicNetworkAccess: network?.privateLink
          ? sql.ServerNetworkAccessFlag.Disabled
          : sql.ServerNetworkAccessFlag.Enabled,
      },
      {
        ...this.opts,
        dependsOn: this.opts?.dependsOn ? this.opts.dependsOn : password,
        parent: this,
      },
    );

    this.addIdentityToRole('readOnly', sqlServer.identity);

    return sqlServer;
  }

  private createNetwork(server: sql.Server) {
    const { rsGroup, network } = this.args;
    if (!network) return;

    //Allows Ip Addresses
    if (network.acceptAllPublicConnection) {
      new sql.FirewallRule(
        `${this.name}-allows-all-connection`,
        {
          ...rsGroup,
          //firewallRuleName: 'allows-all-connection',
          serverName: server.name,
          startIpAddress: '0.0.0.0',
          endIpAddress: '255.255.255.255',
        },
        { dependsOn: server, parent: this },
      );
    } else if (network.ipRules) {
      pulumi.output(network.ipRules).apply((ips) =>
        convertToIpRange(ips).map((ip, i) => {
          const n = `${this.name}-fwRule-${i}`;
          return new sql.FirewallRule(
            n,
            {
              ...rsGroup,
              //firewallRuleName: n,
              serverName: server.name,
              startIpAddress: ip.start,
              endIpAddress: ip.end,
            },
            { dependsOn: server, parent: this },
          );
        }),
      );
    }

    //Allows Subnets
    if (network.subnets) {
      pulumi.output(network.subnets).apply((subIds) =>
        subIds.map((s) => {
          const subName = vnet.helpers.getSubnetNameFromId(s.id);
          new sql.VirtualNetworkRule(
            `${this.name}-sub-${subName}`,
            {
              ...rsGroup,
              serverName: server.name,
              virtualNetworkSubnetId: s.id,
              ignoreMissingVnetServiceEndpoint: false,
            },
            { dependsOn: server, parent: this },
          );
        }),
      );
    }

    //Private Link
    if (network.privateLink) {
      new vnet.PrivateEndpoint(
        this.name,
        {
          ...network.privateLink,
          rsGroup,
          type: 'sqlServer',
          resourceInfo: server,
        },
        { dependsOn: server, parent: this },
      );
    }
  }

  private createElasticPool(server: sql.Server) {
    const { rsGroup, elasticPool } = this.args;
    if (!elasticPool) return undefined;

    return new sql.ElasticPool(
      `${this.name}-elasticPool`,
      {
        ...elasticPool,
        ...rsGroup,
        serverName: server.name,
        maxSizeBytes: elasticPool.maxSizeGB * 1024 * 1024 * 1024,
      },
      { dependsOn: server, parent: this },
    );
  }
}
