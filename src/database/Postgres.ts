import * as postgresql from '@pulumi/azure-native/dbforpostgresql';
import * as pulumi from '@pulumi/pulumi';
import { UserAssignedIdentity } from '../azAd';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import { azureEnv } from '../helpers';
import * as types from '../types';
import * as vnet from '../vnet';
import { convertToIpRange } from './helpers';

export interface PostgresArgs
  extends
    CommonBaseArgs,
    types.WithEncryptionEnabler,
    types.WithNetworkArgs,
    Pick<postgresql.ServerArgs, 'administratorLogin'>,
    Partial<
      Pick<
        postgresql.ServerArgs,
        'version' | 'storage' | 'maintenanceWindow' | 'backup' | 'highAvailability' | 'availabilityZone'
      >
    > {
  sku: {
    /** The name of postgres: Standard_B2ms,  */
    name: pulumi.Input<string>;
    /**
     * The tier of the particular SKU, e.g. Burstable.
     */
    tier: postgresql.SkuTier;
  };
  enableAzureADAdmin: boolean;
  enablePasswordAuth?: boolean;
  databases?: Array<{ name: string }>;
  lock?: boolean;
}

export class Postgres extends BaseResourceComponent<PostgresArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: PostgresArgs, opts?: pulumi.ComponentResourceOptions) {
    super('Postgres', name, args, opts);

    const { server, credentials } = this.createPostgres();
    this.createNetwork(server);
    this.createDatabases(server, credentials);
    if (args.lock) this.lockFromDeleting(server);

    this.id = server.id;
    this.resourceName = server.name;

    this.registerOutputs();
  }

  public getOutputs() {
    return {
      id: this.id,
      resourceName: this.resourceName,
    };
  }

  private createPostgres() {
    const {
      rsGroup,
      enableResourceIdentity,
      enableEncryption,
      administratorLogin,
      enableAzureADAdmin,
      enablePasswordAuth,
      lock,
    } = this.args;

    const adminLogin = administratorLogin ?? pulumi.interpolate`${this.name}-admin-${this.createRandomString().value}`;
    const password = this.createPassword();
    const encryptionKey = enableEncryption ? this.getEncryptionKey() : undefined;
    const uAssignedId = this.getUAssignedId();

    const server = new postgresql.Server(
      this.name,
      {
        ...this.args,
        ...rsGroup,

        version: this.args.version ?? postgresql.ServerVersion.ServerVersion_16,
        administratorLogin: adminLogin,
        administratorLoginPassword: password.value,
        storage: this.args.storage ?? { storageSizeGB: 32 },

        identity: enableResourceIdentity
          ? {
              type: postgresql.IdentityType.UserAssigned,
              userAssignedIdentities: pulumi.output(uAssignedId.id).apply((id) => ({ [id]: {} })),
            }
          : undefined,

        dataEncryption: encryptionKey?.id
          ? {
              type: postgresql.DataEncryptionType.AzureKeyVault,
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

        authConfig: {
          activeDirectoryAuth: enableAzureADAdmin ? 'Enabled' : 'Disabled',
          passwordAuth: enablePasswordAuth ? 'Enabled' : 'Disabled',
          tenantId: azureEnv.tenantId,
        },

        backup: this.args.backup ?? {
          geoRedundantBackup: azureEnv.isPrd ? 'Enabled' : 'Disabled',
          backupRetentionDays: azureEnv.isPrd ? 30 : 7,
        },

        highAvailability:
          this.args.sku?.tier !== 'Burstable'
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
      host: pulumi.interpolate`${server.name}.postgres.database.azure.com`,
      port: '5432',
      username: adminLogin,
      password: password.value,
    };

    this.addSecrets({
      [`${this.name}-postgres-host`]: credentials.host,
      [`${this.name}-postgres-port`]: credentials.port,
      [`${this.name}-postgres-login`]: this.args.administratorLogin!,
      [`${this.name}-postgres-pass`]: credentials.password,
    });

    return { server, credentials };
  }

  private createNetwork(server: postgresql.Server) {
    const { rsGroup, network } = this.args;

    if (network?.allowAllInbound) {
      new postgresql.FirewallRule(
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
            new postgresql.FirewallRule(
              `${this.name}-firewall-${i}`,
              {
                ...rsGroup,
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

  private createDatabases(server: postgresql.Server, cred: types.DbCredentialsType) {
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
      const conn = pulumi.interpolate`Host=${cred.host};Database=${d.name};User Id=${cred.username};Password=${cred.password};SslMode=Require;Encrypt=True;TrustServerCertificate=true`;
      this.addSecret(`${this.name}-${d.name}-postgres-conn`, conn);

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
