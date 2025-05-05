import * as pulumi from '@pulumi/pulumi';
import { BaseArgs, BaseResourceComponent } from '../base';
import * as types from '../types';
import { UserAssignedIdentity } from '../azureAd';
import { RandomPassword } from '../common';
import { azureEnv } from '../helpers';
import * as postgresql from '@pulumi/azure-native/dbforpostgresql';
import { convertToIpRange } from './helpers';
import * as vnet from '../vnet';

export interface PostgresArgs
  extends BaseArgs,
    types.WithEncryptionEnabler,
    types.WithResourceGroupInputs,
    types.WithGroupRolesArgs,
    types.WithUserAssignedIdentity,
    types.WithNetworkArgs,
    Pick<
      postgresql.ServerArgs,
      | 'version'
      | 'sku'
      | 'storage'
      | 'administratorLogin'
      | 'maintenanceWindow'
      | 'backup'
      | 'highAvailability'
      | 'availabilityZone'
    > {
  enableAzureADAdmin?: boolean;
  databases?: Array<{ name: string }>;
}

export class Postgres extends BaseResourceComponent<PostgresArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: PostgresArgs, private opts?: pulumi.ComponentResourceOptions) {
    super('Postgres', name, args, opts);

    const server = this.createPostgres();
    this.createNetwork(server);
    this.createDatabases(server);

    this.id = server.id;
    this.resourceName = server.name;

    this.registerOutputs({
      id: this.id,
      resourceName: this.resourceName,
    });
  }

  private createPostgres() {
    const { rsGroup, enableEncryption } = this.args;

    const password = this.createPassword();
    const encryptionKey = enableEncryption ? this.getEncryptionKey() : undefined;
    const uAssignedId = this.getUAssignedId();

    const server = new postgresql.Server(
      this.name,
      {
        ...rsGroup,
        version: this.args.version ?? postgresql.ServerVersion.ServerVersion_16,
        sku: this.args.sku ?? { name: 'Standard_B2ms', tier: 'Burstable' },
        storage: this.args.storage,

        identity: {
          type: postgresql.IdentityType.UserAssigned,
          userAssignedIdentities: pulumi.output(uAssignedId.id).apply((id) => ({ [id]: {} })),
        },

        administratorLogin: this.args.administratorLogin,
        administratorLoginPassword: password.value,

        dataEncryption: encryptionKey
          ? {
              type: postgresql.DataEncryptionType.AzureKeyVault,
              primaryUserAssignedIdentityId: uAssignedId.id,
              primaryKeyURI: encryptionKey.id,
            }
          : { type: postgresql.DataEncryptionType.SystemAssigned },

        maintenanceWindow: this.args.maintenanceWindow ?? {
          customWindow: 'Enabled',
          dayOfWeek: 0, //0 is Sunday
          startHour: 0,
          startMinute: 0,
        },

        authConfig: {
          activeDirectoryAuth: this.args.enableAzureADAdmin ? 'Enabled' : 'Disabled',
          passwordAuth: 'Enabled',
          tenantId: azureEnv.tenantId,
        },

        backup: this.args.backup ?? {
          geoRedundantBackup: azureEnv.isPrd ? 'Enabled' : 'Disabled',
          backupRetentionDays: azureEnv.isPrd ? 30 : 7,
        },

        highAvailability: this.args.highAvailability ?? {
          mode: azureEnv.isPrd ? 'ZoneRedundant' : 'Disabled',
          standbyAvailabilityZone: '3',
        },
        availabilityZone: this.args.availabilityZone ?? azureEnv.isPrd ? '3' : '1',

        network: {
          publicNetworkAccess:
            this.args.network?.publicNetworkAccess ?? this.args.network?.privateLink ? 'Disabled' : 'Enabled',
        },
      },
      {
        ...this.opts,
        parent: this,
      },
    );

    this.addSecrets({
      [`${this.name}-host`]: pulumi.interpolate`${server.name}.postgres.database.azure.com`,
      [`${this.name}-port`]: '5432',
      [`${this.name}-login`]: this.args.administratorLogin!,
      [`${this.name}-pass`]: password.value,
    });

    return server;
  }

  private createNetwork(server: postgresql.Server) {
    const { rsGroup, network } = this.args;

    if (network?.ipRules) {
      pulumi.output(network.ipRules).apply((ips) =>
        convertToIpRange(ips).map(
          (f, i) =>
            new postgresql.FirewallRule(
              `${this.name}-firewall-${i}`,
              {
                ...rsGroup,
                firewallRuleName: `${this.name}-firewall-${i}`,
                serverName: server.name,
                startIpAddress: f.start,
                endIpAddress: f.end,
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
          type: 'postgres',
          resourceInfo: server,
        },
        { dependsOn: server, parent: this },
      );
    }
  }

  private createDatabases(server: postgresql.Server) {
    const { rsGroup, databases } = this.args;
    if (!databases) return undefined;

    return databases.map((d) => {
      const db = new postgresql.Database(
        `${this.name}-${d.name}`,
        {
          ...rsGroup,
          serverName: server.name,
          databaseName: d.name,
        },
        { dependsOn: server, parent: this },
      );

      //add connection string to vault
      //   const conn = pulumi.interpolate``;
      //   this.addSecret(`${this.name}-${d.name}-conn`, conn);

      return db;
    });
  }

  private createPassword() {
    return new RandomPassword(
      this.name,
      { length: 20, policy: 'yearly', options: { special: false } },
      { parent: this },
    );
  }
  private getUAssignedId() {
    const { defaultUAssignedId, rsGroup, groupRoles, vaultInfo } = this.args;
    if (defaultUAssignedId) return defaultUAssignedId;

    return new UserAssignedIdentity(
      this.name,
      { rsGroup, groupRoles, vaultInfo, memberof: groupRoles ? [groupRoles.readOnly] : undefined },
      { parent: this },
    );
  }
}
