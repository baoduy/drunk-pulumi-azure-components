import * as pulumi from '@pulumi/pulumi';
import * as sql from '@pulumi/azure-native/sql';
import * as types from '../types';
import * as vault from '../vault';
import * as vnet from '../vnet';

import { BaseResourceComponent, CommonBaseArgs } from '../base';

import { RandomPassword } from '../common';
import { azureEnv } from '../helpers';
import { convertToIpRange } from './helpers';
import { getStorageAccessKeyOutputs } from '../storage/helpers';
import { storageHelpers } from '../storage';

export type AzSqlSkuType = {
  /**
   * Capacity of the particular SKU.
   */
  capacity?: 0 | 50 | 100 | 200 | 300 | 400 | 800 | 1200 | number;
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
  tier?: 'Standard' | 'Basic' | string;
};

export type AzSqlDbType = Omit<
  sql.DatabaseArgs,
  | 'resourceGroupName'
  | 'serverName'
  | 'elasticPoolId'
  | 'encryptionProtector'
  | 'encryptionProtectorAutoRotation'
  | 'federatedClientId'
  | 'preferredEnclaveType'
  | 'sku'
> & {
  /** sample: sku: { name: 'Basic', tier: 'Basic', capacity: 0 } */
  sku?: AzSqlSkuType;
};
export interface AzSqlArgs
  extends
    CommonBaseArgs,
    types.WithEncryptionEnabler,
    Partial<
      Pick<
        sql.ServerArgs,
        'administratorLogin' | 'federatedClientId' | 'isIPv6Enabled' | 'restrictOutboundNetworkAccess' | 'version'
      >
    > {
  administrators: {
    azureAdOnlyAuthentication: boolean;
    useDefaultUAssignedIdForConnection?: boolean;
    /**additionalUAssignedClientIds exable: {'abc':identity.clientId}*/
    additionalUAssignedClientIds?: Record<string, pulumi.Input<string>>;
    adminGroup: { displayName: pulumi.Input<string>; objectId: pulumi.Input<string> };
  };

  elasticPoolCreate?: Partial<
    Pick<
      sql.ElasticPoolArgs,
      'autoPauseDelay' | 'availabilityZone' | 'highAvailabilityReplicaCount' | 'licenseType' | 'perDatabaseSettings'
    >
  > & {
    maxSizeGB?: number;
    sku: AzSqlSkuType;
  };
  network?: Omit<types.NetworkArgs, 'bypass' | 'defaultAction' | 'vnetRules'> & {
    subnets?: pulumi.Input<Array<{ id: string }>>;
  };
  vulnerabilityAssessment?: {
    logStorage: types.ResourceWithGroupInputs;
    alertEmails: pulumi.Input<string[]>;
    retentionDays?: number;
  };
  lock?: boolean;
  databases?: Record<string, AzSqlDbType>;
}

export class AzSql extends BaseResourceComponent<AzSqlArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: AzSqlArgs, opts?: pulumi.ComponentResourceOptions) {
    super('AzSql', name, args, opts);

    const { server, password } = this.createSql();
    const elastic = this.createElasticPool(server);

    this.createVulnerabilityAssessment(server);
    this.createNetwork(server);
    this.createDatabases(server, password, elastic);
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

  private createSql() {
    const {
      rsGroup,
      enableResourceIdentity,
      enableEncryption,
      defaultUAssignedId,
      administrators,
      network,
      lock,
      administratorLogin,
      ...props
    } = this.args;

    const adminLogin = administratorLogin ?? pulumi.interpolate`${this.name}-admin-${this.createRandomString().value}`;
    const password = this.createPassword();
    const encryptionKey = enableEncryption
      ? this.getEncryptionKey({ name: `${this.name}-az-sql`, keySize: 3072 })
      : undefined;

    const server = new sql.Server(
      this.name,
      {
        ...props,
        ...rsGroup,
        version: this.args.version ?? '12.0',
        minimalTlsVersion: '1.2',

        identity: enableResourceIdentity
          ? {
              type: defaultUAssignedId ? sql.IdentityType.SystemAssigned_UserAssigned : sql.IdentityType.SystemAssigned,
              userAssignedIdentities: defaultUAssignedId ? [defaultUAssignedId.id] : undefined,
            }
          : undefined,

        primaryUserAssignedIdentityId: defaultUAssignedId?.id,
        administratorLogin: adminLogin,
        administratorLoginPassword: password.value,
        keyId: encryptionKey?.id,

        administrators: administrators
          ? {
              administratorType: administrators.adminGroup?.objectId
                ? sql.AdministratorType.ActiveDirectory
                : undefined,

              azureADOnlyAuthentication: administrators.adminGroup?.objectId
                ? (administrators.azureAdOnlyAuthentication ?? true)
                : false,

              principalType: sql.PrincipalType.Group,
              tenantId: azureEnv.tenantId,
              sid: administrators.adminGroup?.objectId,
              login: administrators.adminGroup?.displayName,
            }
          : undefined,

        publicNetworkAccess: network?.privateLink
          ? sql.ServerNetworkAccessFlag.Disabled
          : sql.ServerNetworkAccessFlag.Enabled,
      },
      {
        ...this.opts,
        protect: lock ?? this.opts?.protect,
        dependsOn: this.opts?.dependsOn ? this.opts.dependsOn : password,
        ignoreChanges: ['administrators.azureAdOnlyAuthentication'],
        parent: this,
      },
    );

    this.createEncryptionProtector(server, encryptionKey);
    if (enableResourceIdentity) this.addIdentityToRole('readOnly', server.identity);

    return { server, password };
  }

  private createNetwork(server: sql.Server) {
    const { rsGroup, network } = this.args;
    if (!network) return;

    //Allows Ip Addresses
    if (network.allowAllInbound) {
      new sql.FirewallRule(
        `${this.name}-allows-all`,
        {
          ...rsGroup,
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
          const subName = vnet.vnetHelpers.getSubnetNameFromId(s.id);
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
    const { rsGroup, elasticPoolCreate } = this.args;
    if (!elasticPoolCreate) return undefined;

    return new sql.ElasticPool(
      `${this.name}-elasticPool`,
      {
        ...elasticPoolCreate,
        ...rsGroup,
        //autoPauseDelay: props.autoPauseDelay ?? azureEnv.isPrd ? -1 : 10,
        preferredEnclaveType: sql.AlwaysEncryptedEnclaveType.VBS,

        serverName: server.name,
        maxSizeBytes: elasticPoolCreate.maxSizeGB ? elasticPoolCreate.maxSizeGB * 1024 * 1024 * 1024 : undefined,
      },
      { dependsOn: server, parent: this },
    );
  }

  private createEncryptionProtector(server: sql.Server, key: vault.EncryptionKey | undefined) {
    if (!key) return undefined;
    const { rsGroup, vaultInfo } = this.args;
    // Enable a server key in the SQL Server with reference to the Key Vault Key
    const keyName = pulumi.interpolate`${vaultInfo!.resourceName}_${key.keyName}_${key.version}`;
    //Server key maybe auto created by Azure
    // const serverKey = new sql.ServerKey(
    //   `${sqlName}-serverKey`,
    //   {
    //     resourceGroupName: group.resourceGroupName,
    //     serverName: sqlName,
    //     serverKeyType: sql.ServerKeyType.AzureKeyVault,
    //     keyName,
    //     uri: encryptKey.url,
    //   },
    //   { dependsOn: sqlServer, retainOnDelete: true },
    // );

    //enable the EncryptionProtector
    return new sql.EncryptionProtector(
      `${this.name}-encryptionProtector`,
      {
        encryptionProtectorName: 'current',
        resourceGroupName: rsGroup.resourceGroupName,
        serverName: server.name,
        serverKeyType: sql.ServerKeyType.AzureKeyVault,
        serverKeyName: keyName, //serverKey.name,
        autoRotationEnabled: true,
      },
      { dependsOn: server, parent: this },
    );
  }

  private createVulnerabilityAssessment(server: sql.Server) {
    const { enableResourceIdentity, rsGroup, vulnerabilityAssessment, vaultInfo } = this.args;
    if (!vulnerabilityAssessment) return undefined;
    //this will allows sql server to able to write log into the storage account

    if (enableResourceIdentity) this.addIdentityToRole('contributor', server.identity);

    const stgEndpoints = storageHelpers.getStorageEndpointsOutputs(vulnerabilityAssessment.logStorage);
    const storageKey = getStorageAccessKeyOutputs(vulnerabilityAssessment.logStorage, vaultInfo);

    const alert = new sql.ServerSecurityAlertPolicy(
      `${this.name}-alert`,
      {
        ...rsGroup,
        securityAlertPolicyName: 'default',
        serverName: server.name,
        emailAccountAdmins: true,
        emailAddresses: vulnerabilityAssessment.alertEmails,
        retentionDays: (vulnerabilityAssessment.retentionDays ?? azureEnv.isPrd) ? 30 : 7,

        storageAccountAccessKey: storageKey,
        storageEndpoint: stgEndpoints.blob,
        state: 'Enabled',
      },
      { dependsOn: server, parent: this },
    );

    //Server Audit
    new sql.ExtendedServerBlobAuditingPolicy(
      `${this.name}-audit`,
      {
        ...rsGroup,
        auditActionsAndGroups: [
          'SUCCESSFUL_DATABASE_AUTHENTICATION_GROUP',
          'FAILED_DATABASE_AUTHENTICATION_GROUP',
          'BATCH_COMPLETED_GROUP',
        ],
        serverName: server.name,
        blobAuditingPolicyName: 'default',
        isAzureMonitorTargetEnabled: true,
        isStorageSecondaryKeyInUse: false,
        predicateExpression: "object_name = 'SensitiveData'",
        queueDelayMs: 4000,
        retentionDays: (vulnerabilityAssessment.retentionDays ?? azureEnv.isPrd) ? 30 : 7,
        state: 'Enabled',
        isDevopsAuditEnabled: true,

        storageAccountAccessKey: storageKey,
        storageAccountSubscriptionId: azureEnv.subscriptionId,
        storageEndpoint: stgEndpoints.blob,
      },
      { dependsOn: alert, parent: this },
    );

    //ServerVulnerabilityAssessment
    new sql.ServerVulnerabilityAssessment(
      `${this.name}-assessment`,
      {
        ...rsGroup,
        vulnerabilityAssessmentName: this.name,
        serverName: server.name,

        recurringScans: {
          isEnabled: true,
          emailSubscriptionAdmins: true,
          emails: vulnerabilityAssessment.alertEmails,
        },

        storageContainerPath: pulumi.interpolate`${stgEndpoints.blob}/${server.name}`,
        storageAccountAccessKey: storageKey,
      },
      { dependsOn: alert, parent: this },
    );
  }

  private createDatabases(server: sql.Server, password: RandomPassword, elasticPool?: sql.ElasticPool) {
    const { rsGroup, databases, administrators, defaultUAssignedId } = this.args;
    if (!databases) return undefined;

    return Object.keys(databases).map((k) => {
      const props = databases[k];
      const name = props.databaseName ?? k;

      const db = new sql.Database(
        `${this.name}-${name}`,
        {
          ...props,
          ...rsGroup,
          //autoPauseDelay: props.autoPauseDelay ?? azureEnv.isPrd ? -1 : 10,
          preferredEnclaveType: sql.AlwaysEncryptedEnclaveType.VBS,

          elasticPoolId: elasticPool?.id,
          sku: elasticPool?.id ? undefined : props.sku,
          serverName: server.name,
          databaseName: name,
        },
        { dependsOn: elasticPool ? [server, password, elasticPool] : [server, password], parent: this },
      );

      const secrets: Record<string, pulumi.Input<string>> = {
        [`${name}-sql-default-sysid-conn`]: pulumi.interpolate`Server=tcp:${server.name}.database.windows.net,1433; Initial Catalog=${db.name}; Authentication="Active Directory Default"; MultipleActiveResultSets=False;Encrypt=True; TrustServerCertificate=True; Connection Timeout=120;`,
      };

      if (defaultUAssignedId && administrators.useDefaultUAssignedIdForConnection)
        secrets[`${name}-sql-default-uid-conn`] =
          pulumi.interpolate`Server=tcp:${server.name}.database.windows.net,1433; Initial Catalog=${db.name}; Authentication="Active Directory Managed Identity"; User Id=${defaultUAssignedId?.principalId}; MultipleActiveResultSets=False; Encrypt=True; TrustServerCertificate=True; Connection Timeout=120;`;

      if (!administrators.azureAdOnlyAuthentication) {
        secrets[`${name}-sql-password-conn`] =
          pulumi.interpolate`Server=tcp:${server.name}.database.windows.net,1433; Initial Catalog=${db.name}; User Id=${server.administratorLogin}; Password=${password.value}; MultipleActiveResultSets=False; Encrypt=True; TrustServerCertificate=True; Connection Timeout=120;`;
      }

      const adds = administrators.additionalUAssignedClientIds;
      if (adds) {
        Object.keys(adds).forEach((k) => {
          const conn = pulumi.interpolate`Server=tcp:${server.name}.database.windows.net,1433; Initial Catalog=${db.name}; Authentication="Active Directory Managed Identity"; User Id=${adds[k]}; MultipleActiveResultSets=False; Encrypt=True; TrustServerCertificate=True; Connection Timeout=120;`;
          secrets[`${name}-sql-${k}-conn`] = conn;
        });
      }
      this.addSecrets(secrets);
      return db;
    });
  }
}
