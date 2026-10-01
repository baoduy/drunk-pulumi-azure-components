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
import { AzRole } from '../azAd';

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
    types.WithDiagnosticLogs,
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
  };

  elasticPoolCreate?: Partial<
    Pick<
      sql.ElasticPoolArgs,
      | 'autoPauseDelay'
      | 'availabilityZone'
      | 'highAvailabilityReplicaCount'
      | 'licenseType'
      | 'perDatabaseSettings'
      | 'zoneRedundant'
    >
  > & {
    maxSizeGB?: number;
    sku: AzSqlSkuType;
  };
  network?: Omit<types.NetworkArgs, 'bypass' | 'defaultAction' | 'vnetRules'> & {
    subnets?: pulumi.Input<Array<{ id: string }>>;
  };
  /**
   * Microsoft-managed (express) SQL vulnerability assessment plus the server security alert policy.
   * Express results appear in Microsoft Defender for Cloud and need Microsoft Defender for Azure SQL
   * enabled on the subscription. Express replaces (switches off) any classic, storage-backed assessment.
   * On by default in PRD; outside PRD it is on only when this block is supplied.
   */
  vulnerabilityAssessment?: {
    /**
     * Turn the assessment and alert policy on or off. `false` also skips the blob audit policy, even when
     * `logStorage` is set. Default: `true` in PRD or when this block is supplied.
     */
    enabled?: boolean;
    /** Optional storage account for alert logs and the server blob auditing policy. No audit policy without it. */
    logStorage?: types.ResourceWithGroupInputs;
    /** Extra alert recipients; subscription admins are always emailed. */
    alertEmails?: pulumi.Input<string[]>;
    /** Retention for alert and audit logs, used as given, including `0`. Default: 30 in PRD, else 7. */
    retentionDays?: number;
  };
  databases?: Record<string, AzSqlDbType>;
}

/** Only plain-string SKU values are classified; an unresolved `Input` counts as unknown. */
const plain = (value: unknown) => (typeof value === 'string' ? value.toUpperCase() : '');

/** vCore GeneralPurpose/BusinessCritical and DTU Premium support zone redundancy. */
const supportsZoneRedundancy = (sku?: AzSqlSkuType) =>
  ['GENERALPURPOSE', 'BUSINESSCRITICAL', 'PREMIUM'].includes(plain(sku?.tier)) ||
  /^(GP_|BC_|P\d+$)/.test(plain(sku?.name));

/** Hyperscale backup redundancy is set at creation only, so it gets no default. */
const isHyperscale = (sku?: AzSqlSkuType) => plain(sku?.tier) === 'HYPERSCALE' || plain(sku?.name).startsWith('HS_');

/** Serverless vCore SKUs carry `_S_` in the name, e.g. `GP_S_Gen5_1`. */
const isServerless = (sku?: AzSqlSkuType) => plain(sku?.name).includes('_S_');

/** Serverless never pauses in PRD and pauses after 60 minutes elsewhere; provisioned SKUs get no default. */
const defaultAutoPauseDelay = (sku?: AzSqlSkuType) => (isServerless(sku) ? (azureEnv.isPrd ? -1 : 60) : undefined);

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

  private createAdminGroupRole() {
    const n = this.name.toLowerCase().includes('sql') ? `${this.name}-ADMIN` : `${this.name}-SQL-ADMIN`;
    const aksAdminGroup = new AzRole(
      n,
      {
        preventDuplicateNames: true,
        description: `The Admin Group for Azure SQL ${this.name}`,
      },
      { ...this.childOpts, parent: this },
    );
    this.addMemberToGroupRole('readOnly', aksAdminGroup.group.objectId);

    return aksAdminGroup;
  }

  private createSql() {
    const {
      rsGroup,
      groupRoles,
      enableResourceIdentity,
      enableEncryption,
      defaultUAssignedId,
      administrators,
      network,
      administratorLogin,
      ...props
    } = this.args;

    const adminGroup = this.createAdminGroupRole().getOutputs();
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
              administratorType: adminGroup.objectId ? sql.AdministratorType.ActiveDirectory : undefined,
              azureADOnlyAuthentication: adminGroup.objectId
                ? (administrators.azureAdOnlyAuthentication ?? true)
                : false,

              principalType: sql.PrincipalType.Group,
              tenantId: azureEnv.tenantId,
              sid: adminGroup?.objectId,
              login: adminGroup?.displayName,
            }
          : undefined,

        publicNetworkAccess: network?.publicNetworkAccess
          ? sql.ServerNetworkAccessFlag.Enabled
          : network?.privateLink
            ? sql.ServerNetworkAccessFlag.Disabled
            : sql.ServerNetworkAccessFlag.Enabled,
      },
      {
        ...this.opts,
        parent: this,
      },
    );

    this.createEncryptionProtector(server, encryptionKey);
    if (enableResourceIdentity)
      this.addMemberToGroupRole(
        'readOnly',
        server.identity.apply((id) => id?.principalId),
      );

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
        zoneRedundant:
          elasticPoolCreate.zoneRedundant ??
          (supportsZoneRedundancy(elasticPoolCreate.sku) ? azureEnv.isPrd : undefined),
        autoPauseDelay: elasticPoolCreate.autoPauseDelay ?? defaultAutoPauseDelay(elasticPoolCreate.sku),
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
    const { rsGroup, vulnerabilityAssessment: va, vaultInfo } = this.args;
    if (!(va?.enabled ?? (azureEnv.isPrd || va !== undefined))) return undefined;

    const retentionDays = va?.retentionDays ?? (azureEnv.isPrd ? 30 : 7);
    const stgEndpoints = va?.logStorage ? storageHelpers.getStorageEndpointsOutputs(va.logStorage) : undefined;
    const storageKey = va?.logStorage ? getStorageAccessKeyOutputs(va.logStorage, vaultInfo) : undefined;

    const alert = new sql.ServerSecurityAlertPolicy(
      `${this.name}-alert`,
      {
        ...rsGroup,
        securityAlertPolicyName: 'default',
        serverName: server.name,
        emailAccountAdmins: true,
        emailAddresses: va?.alertEmails,
        retentionDays,
        storageAccountAccessKey: storageKey,
        storageEndpoint: stgEndpoints?.blob,
        state: 'Enabled',
      },
      { dependsOn: server, parent: this },
    );

    //Microsoft-managed (express) vulnerability assessment, no storage account needed.
    new sql.SqlVulnerabilityAssessmentsSetting(
      `${this.name}-sqlVa`,
      {
        resourceGroupName: rsGroup.resourceGroupName,
        serverName: server.name,
        vulnerabilityAssessmentName: 'default',
        state: 'Enabled',
      },
      { dependsOn: alert, parent: this },
    );

    if (!stgEndpoints) return undefined;

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
        retentionDays,
        state: 'Enabled',
        isDevopsAuditEnabled: true,

        storageAccountAccessKey: storageKey,
        storageAccountSubscriptionId: azureEnv.subscriptionId,
        storageEndpoint: stgEndpoints.blob,
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
      const sku = elasticPool ? this.args.elasticPoolCreate?.sku : props.sku;

      const db = new sql.Database(
        `${this.name}-${name}`,
        {
          ...props,
          ...rsGroup,
          //A pooled database inherits zone redundancy from its pool.
          zoneRedundant: elasticPool
            ? props.zoneRedundant
            : (props.zoneRedundant ?? (supportsZoneRedundancy(sku) ? azureEnv.isPrd : undefined)),
          requestedBackupStorageRedundancy:
            props.requestedBackupStorageRedundancy ??
            (isHyperscale(sku) ? undefined : azureEnv.isPrd ? 'Geo' : 'Local'),
          autoPauseDelay: props.autoPauseDelay ?? defaultAutoPauseDelay(sku),
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
          pulumi.interpolate`Server=tcp:${server.name}.database.windows.net,1433; Initial Catalog=${db.name}; Authentication="Active Directory Default"; User Id=${defaultUAssignedId?.principalId}; MultipleActiveResultSets=False; Encrypt=True; TrustServerCertificate=True; Connection Timeout=120;`;

      if (!administrators.azureAdOnlyAuthentication) {
        secrets[`${name}-sql-password-conn`] =
          pulumi.interpolate`Server=tcp:${server.name}.database.windows.net,1433; Initial Catalog=${db.name}; User Id=${server.administratorLogin}; Password=${password.value}; MultipleActiveResultSets=False; Encrypt=True; TrustServerCertificate=True; Connection Timeout=120;`;
      }

      const adds = administrators.additionalUAssignedClientIds;
      if (adds) {
        Object.keys(adds).forEach((k) => {
          const conn = pulumi.interpolate`Server=tcp:${server.name}.database.windows.net,1433; Initial Catalog=${db.name}; Authentication="Active Directory Default"; User Id=${adds[k]}; MultipleActiveResultSets=False; Encrypt=True; TrustServerCertificate=True; Connection Timeout=120;`;
          secrets[`${name}-sql-${k}-conn`] = conn;
        });
      }
      this.addSecrets(secrets);
      return db;
    });
  }
}
