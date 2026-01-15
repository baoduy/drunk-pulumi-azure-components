import * as mysql from '@pulumi/azure-native/dbformysql';
import * as pulumi from '@pulumi/pulumi';
import { UserAssignedIdentity } from '../azAd';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import { azureEnv } from '../helpers';
import * as types from '../types';
import * as vnet from '../vnet';
import { convertToIpRange } from './helpers';

export interface MySqlArgs
  extends
    CommonBaseArgs,
    types.WithEncryptionEnabler,
    types.WithNetworkArgs,
    Pick<mysql.ServerArgs, 'administratorLogin'>,
    Partial<
      Pick<
        mysql.ServerArgs,
        'version' | 'storage' | 'maintenanceWindow' | 'backup' | 'highAvailability' | 'availabilityZone'
      >
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
  enableAzureADAdmin: boolean;
  databases?: Array<{ name: string }>;
  lock?: boolean;
}

export class MySql extends BaseResourceComponent<MySqlArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: MySqlArgs, opts?: pulumi.ComponentResourceOptions) {
    super('MySql', name, args, opts);

    const uAssignedId = this.getUAssignedId();
    const { server, credentials } = this.createMySql(uAssignedId);
    this.createNetwork(server);
    this.enableADAdmin(server, uAssignedId);
    this.createDatabases(server, credentials);

    if (args.lock) this.lockFromDeleting(server);

    this.id = server.id;
    this.resourceName = server.name;

    this.registerOutputs();
  }

  public getOutputs(): types.ResourceOutputs {
    return {
      id: this.id,
      resourceName: this.resourceName,
      resourceGroupName: pulumi.output(this.args.rsGroup.resourceGroupName),
    };
  }

  private createMySql(uid: types.UserAssignedIdentityInputs) {
    const { rsGroup, enableResourceIdentity, enableEncryption, administratorLogin, lock } = this.args;

    const adminLogin = administratorLogin ?? pulumi.interpolate`${this.name}-admin-${this.createRandomString().value}`;
    const password = this.createPassword();
    const encryptionKey = enableEncryption ? this.getEncryptionKey() : undefined;

    const server = new mysql.Server(
      this.name,
      {
        ...this.args,
        ...rsGroup,
        //serverName: this.name,
        administratorLogin: adminLogin,
        administratorLoginPassword: password.value,
        version: this.args.version ?? mysql.ServerVersion.ServerVersion_8_0_21,
        storage: this.args.storage ?? { storageSizeGB: 30 },

        identity: enableResourceIdentity
          ? {
              type: mysql.ManagedServiceIdentityType.UserAssigned,
              userAssignedIdentities: [uid.id],
            }
          : undefined,

        dataEncryption: encryptionKey
          ? {
              type: mysql.DataEncryptionType.AzureKeyVault,
              primaryUserAssignedIdentityId: uid.id,
              primaryKeyURI: encryptionKey.id,
            }
          : { type: 'SystemManaged' },

        maintenanceWindow:
          this.args.sku.tier !== 'Burstable'
            ? (this.args.maintenanceWindow ?? {
                customWindow: 'Enabled',
                dayOfWeek: 0, //0 is Sunday
                startHour: 0,
                startMinute: 0,
              })
            : undefined,

        backup: this.args.backup ?? {
          geoRedundantBackup: azureEnv.isPrd ? 'Enabled' : 'Disabled',
          backupRetentionDays: azureEnv.isPrd ? 30 : 7,
        },

        highAvailability:
          this.args.sku.tier !== 'Burstable'
            ? (this.args.highAvailability ?? {
                mode: azureEnv.isPrd ? 'ZoneRedundant' : 'SameZone',
                standbyAvailabilityZone: azureEnv.isPrd ? '3' : '1',
              })
            : undefined,
        availabilityZone: (this.args.availabilityZone ?? azureEnv.isPrd) ? '3' : '1',

        network: {
          publicNetworkAccess:
            (this.args.network?.publicNetworkAccess ?? this.args.network?.privateLink) ? 'Disabled' : 'Enabled',
        },
      },
      {
        ...this.opts,
        protect: lock ?? this.opts?.protect,
        parent: this,
      },
    );

    const credentials: types.DbCredentialsType = {
      host: pulumi.interpolate`${server.name}.mysql.database.azure.com`,
      port: '3306',
      username: adminLogin,
      password: password.value,
    };

    this.addSecrets({
      [`${this.name}-mysql-host`]: credentials.host,
      [`${this.name}-mysql-port`]: credentials.port,
      [`${this.name}-mysql-login`]: credentials.username,
      [`${this.name}-mysql-pass`]: credentials.password,
    });

    return { server, credentials };
  }

  private createNetwork(server: mysql.Server) {
    const { rsGroup, network } = this.args;

    if (network?.allowAllInbound) {
      new mysql.FirewallRule(
        `${this.name}-firewall-allow-all`,
        {
          ...rsGroup,
          serverName: server.name,
          startIpAddress: '0.0.0.0',
          endIpAddress: '255.255.255.255',
        },
        { dependsOn: server, parent: this },
      );
    } else if (network?.ipRules) {
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

  private enableADAdmin(server: mysql.Server, uid: types.UserAssignedIdentityInputs) {
    const { rsGroup, groupRoles, enableAzureADAdmin } = this.args;
    if (!enableAzureADAdmin || !groupRoles) return undefined;

    return new mysql.AzureADAdministrator(
      this.name,
      {
        ...rsGroup,
        administratorName: 'activeDirectory',
        serverName: server.name,
        login: groupRoles.admin.displayName,
        administratorType: 'ActiveDirectory',
        sid: groupRoles.admin.objectId,
        tenantId: azureEnv.tenantId,
        identityResourceId: uid.id,
      },
      { dependsOn: server, parent: this },
    );
  }

  private createDatabases(server: mysql.Server, cred: types.DbCredentialsType) {
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
      const conn = pulumi.interpolate`Server=${cred.host};Database=${d.name};Uid=${cred.username};Pwd=${cred.password};SslMode=Require;Encrypt=True;TrustServerCertificate=true`;
      this.addSecret(`${this.name}-${d.name}-mysql-conn`, conn);

      return db;
    });
  }

  private getUAssignedId() {
    const { defaultUAssignedId, rsGroup, groupRoles, vaultInfo } = this.args;
    if (defaultUAssignedId) return defaultUAssignedId;

    return new UserAssignedIdentity(
      this.name,
      { rsGroup, vaultInfo, memberof: groupRoles ? [groupRoles.readOnly] : undefined },
      { dependsOn: this.opts?.dependsOn, parent: this },
    );
  }
}
