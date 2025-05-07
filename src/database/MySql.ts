import * as pulumi from '@pulumi/pulumi';
import { BaseArgs, BaseResourceComponent } from '../base';
import * as types from '../types';
import { UserAssignedIdentity } from '../azAd';
import { azureEnv } from '../helpers';
import * as mysql from '@pulumi/azure-native/dbformysql';
import { convertToIpRange } from './helpers';
import * as vnet from '../vnet';

export interface MySqlArgs
  extends BaseArgs,
    types.WithEncryptionEnabler,
    types.WithResourceGroupInputs,
    types.WithGroupRolesArgs,
    types.WithUserAssignedIdentity,
    types.WithNetworkArgs,
    Pick<
      mysql.ServerArgs,
      | 'version'
      | 'storage'
      | 'administratorLogin'
      | 'maintenanceWindow'
      | 'backup'
      | 'highAvailability'
      | 'availabilityZone'
    > {
  sku: {
    /**
     * The name of the sku, e.g. Standard_D32s_v3.
     */
    name: pulumi.Input<string>;
    /**
     * The tier of the particular SKU, e.g. GeneralPurpose.
     */
    tier: mysql.ServerSkuTier;
  };
  enableAzureADAdmin?: boolean;
  databases?: Array<{ name: string }>;
  lock?: boolean;
}

export class MySql extends BaseResourceComponent<MySqlArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: MySqlArgs, opts?: pulumi.ComponentResourceOptions) {
    super('MySql', name, args, opts);

    const server = this.createMySql();
    this.createNetwork(server);
    this.enableADAdmin(server);
    this.createDatabases(server);

    if (args.lock) this.lockFromDeleting(server);

    this.id = server.id;
    this.resourceName = server.name;

    this.registerOutputs({
      id: this.id,
      resourceName: this.resourceName,
    });
  }

  private createMySql() {
    const { rsGroup, enableEncryption, lock } = this.args;

    const password = this.createPassword();
    const encryptionKey = enableEncryption ? this.getEncryptionKey() : undefined;
    const uAssignedId = this.getUAssignedId();

    const server = new mysql.Server(
      this.name,
      {
        ...this.args,
        ...rsGroup,

        administratorLoginPassword: password.value,
        version: this.args.version ?? mysql.ServerVersion.ServerVersion_8_0_21,
        storage: this.args.storage ?? { storageSizeGB: 30 },

        identity: {
          type: mysql.ManagedServiceIdentityType.UserAssigned,
          userAssignedIdentities: [uAssignedId.id],
        },

        dataEncryption: encryptionKey
          ? {
              type: mysql.DataEncryptionType.AzureKeyVault,
              primaryUserAssignedIdentityId: uAssignedId.id,
              primaryKeyURI: encryptionKey.id,
            }
          : { type: 'SystemManaged' },

        maintenanceWindow: this.args.maintenanceWindow ?? {
          customWindow: 'Enabled',
          dayOfWeek: 0, //0 is Sunday
          startHour: 0,
          startMinute: 0,
        },

        backup: this.args.backup ?? {
          geoRedundantBackup: azureEnv.isPrd ? 'Enabled' : 'Disabled',
          backupRetentionDays: azureEnv.isPrd ? 30 : 7,
        },

        highAvailability:
          this.args.sku.tier !== 'Burstable'
            ? this.args.highAvailability ?? {
                mode: azureEnv.isPrd ? 'ZoneRedundant' : 'SameZone',
                standbyAvailabilityZone: azureEnv.isPrd ? '3' : '1',
              }
            : undefined,
        availabilityZone: this.args.availabilityZone ?? azureEnv.isPrd ? '3' : '1',

        network: {
          publicNetworkAccess:
            this.args.network?.publicNetworkAccess ?? this.args.network?.privateLink ? 'Disabled' : 'Enabled',
        },
      },
      {
        ...this.opts,
        protect: lock ?? this.opts?.protect,
        parent: this,
      },
    );

    this.addSecrets({
      [`${this.name}-host`]: pulumi.interpolate`${server.name}.mysql.database.azure.com`,
      [`${this.name}-port`]: '3306',
      [`${this.name}-login`]: this.args.administratorLogin!,
      [`${this.name}-pass`]: password.value,
    });

    return server;
  }

  private createNetwork(server: mysql.Server) {
    const { rsGroup, network } = this.args;

    if (network?.ipRules) {
      pulumi.output(network.ipRules).apply((ips) =>
        convertToIpRange(ips).map(
          (f, i) =>
            new mysql.FirewallRule(
              `${this.name}-firewall-${i}`,
              {
                ...rsGroup,
                //firewallRuleName: `${this.name}-firewall-${i}`,
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
          type: 'mysql',
          resourceInfo: server,
        },
        { dependsOn: server, parent: this },
      );
    }
  }

  private enableADAdmin(server: mysql.Server) {
    const { rsGroup, groupRoles, enableAzureADAdmin } = this.args;
    if (!enableAzureADAdmin || !groupRoles) return undefined;

    return new mysql.AzureADAdministrator(
      this.name,
      {
        ...rsGroup,
        administratorName: `${this.name}-azure-ad`,
        serverName: server.name,

        login: server.administratorLogin.apply((login) => login as string),
        administratorType: 'ActiveDirectory',
        sid: groupRoles.contributor.objectId,
        tenantId: azureEnv.tenantId,
      },
      { dependsOn: server, parent: this },
    );
  }

  private createDatabases(server: mysql.Server) {
    const { rsGroup, databases } = this.args;
    if (!databases) return undefined;

    return databases.map((d) => {
      const db = new mysql.Database(
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

  private getUAssignedId() {
    const { defaultUAssignedId, rsGroup, groupRoles, vaultInfo } = this.args;
    if (defaultUAssignedId) return defaultUAssignedId;

    return new UserAssignedIdentity(
      this.name,
      { rsGroup, groupRoles, vaultInfo, memberof: groupRoles ? [groupRoles.readOnly] : undefined },
      { dependsOn: this.opts?.dependsOn, parent: this },
    );
  }
}
