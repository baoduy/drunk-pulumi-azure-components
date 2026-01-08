import * as pulumi from '@pulumi/pulumi';
import * as types from './types';
import { BaseComponent, CommonBaseArgs } from './base';
import { getComponentResourceType } from './base/helpers';
import { StorageAccount, StorageAccountArgs } from './storage';
import { Automation, AutomationArgs, AzSearch, AzSearchArgs, ServiceBus, ServiceBusArgs } from './services';
import { Apim, ApimArgs } from './apim';
import {
  AppCert,
  AppCertArgs,
  AppConfig,
  AppConfigArgs,
  AppContainerEnv,
  AppContainerEnvArgs,
  IoTHub,
  IoTHubArgs,
  LogicApp,
  LogicAppArgs,
  SignalR,
  SignalRArgs,
} from './app';
import { AzSql, AzSqlArgs, MySql, MySqlArgs, Postgres, PostgresArgs, Redis, RedisArgs } from './database';
import { KeyVault, KeyVaultArgs } from './vault';

export interface AppResourcesArgs extends CommonBaseArgs, types.WithNetworkArgs {
  vaultCreate?: types.WithName & Partial<KeyVaultArgs>;
  storageAccount?: types.WithName & Partial<StorageAccountArgs>;
  serviceBus?: types.WithName & Partial<ServiceBusArgs> & Pick<ServiceBusArgs, 'sku'>;
  automation?: types.WithName & Partial<AutomationArgs>;
  azSearch?: types.WithName & Partial<AzSearchArgs> & Pick<AzSearchArgs, 'sku'>;
  apim?: types.WithName & Partial<ApimArgs> & Pick<ApimArgs, 'sku'>;
  appCert?: types.WithName & Partial<AppCertArgs> & Pick<AppCertArgs, 'domain' | 'productType'>;
  appConfig?: types.WithName & Partial<AppConfigArgs>;
  appContainerEnv?: types.WithName & Partial<AppContainerEnvArgs>;
  iotHub?: types.WithName & Partial<IoTHubArgs> & Pick<IoTHubArgs, 'sku'>;
  logicApp?: types.WithName & Partial<LogicAppArgs> & Pick<LogicAppArgs, 'integrationAccount' | 'workflow'>;
  signalR?: types.WithName & Partial<SignalRArgs> & Pick<SignalRArgs, 'sku'>;
  azSql?: types.WithName & Partial<AzSqlArgs>;
  mySql?: types.WithName & Partial<MySqlArgs> & Pick<MySqlArgs, 'sku' | 'administratorLogin'>;
  postgres?: types.WithName & Partial<PostgresArgs> & Pick<PostgresArgs, 'sku' | 'administratorLogin'>;
  redis?: types.WithName & Partial<RedisArgs>;
}

export class AppResources extends BaseComponent<AppResourcesArgs> {
  public readonly storage?: StorageAccount;
  public readonly automation?: Automation;
  public readonly azSearch?: AzSearch;
  public readonly appCert?: AppCert;
  public readonly appConfig?: AppConfig;
  public readonly appContainerEnv?: AppContainerEnv;
  public readonly iotHub?: IoTHub;
  public readonly logicApp?: LogicApp;
  public readonly signalR?: SignalR;
  public readonly azSql?: AzSql;
  public readonly mySql?: MySql;
  public readonly postgres?: Postgres;
  public readonly redis?: Redis;
  public serviceBus?: ServiceBus;
  public apim?: Apim;
  public vaultInfo?: types.ResourceOutputs;

  constructor(name: string, args: AppResourcesArgs, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('AppResources'), name, args, opts);
    const {
      apim,
      storageAccount,
      serviceBus,
      automation,
      azSearch,
      appCert,
      appConfig,
      appContainerEnv,
      iotHub,
      logicApp,
      signalR,
      azSql,
      mySql,
      postgres,
      redis,
      ...others
    } = args;

    this.vaultInfo = this.createVault();
    this.apim = apim
      ? new Apim(apim.name ?? name, { ...others, ...apim, vaultInfo: this.vaultInfo }, { ...opts, parent: this })
      : undefined;

    this.storage = storageAccount
      ? new StorageAccount(
          storageAccount.name ?? name,
          { ...others, ...storageAccount, vaultInfo: this.vaultInfo },
          { ...opts, parent: this },
        )
      : undefined;

    this.serviceBus = serviceBus
      ? new ServiceBus(
          serviceBus.name ?? name,
          { ...others, ...serviceBus, vaultInfo: this.vaultInfo },
          { ...opts, parent: this },
        )
      : undefined;

    this.automation = automation
      ? new Automation(
          automation.name ?? name,
          { ...others, ...automation, vaultInfo: this.vaultInfo },
          { ...opts, parent: this },
        )
      : undefined;

    this.azSearch = azSearch
      ? new AzSearch(
          azSearch.name ?? name,
          { ...others, ...azSearch, vaultInfo: this.vaultInfo },
          { ...opts, parent: this },
        )
      : undefined;

    this.appCert = appCert
      ? new AppCert(
          appCert.name ?? name,
          { ...others, ...appCert, vaultInfo: this.vaultInfo },
          { ...opts, parent: this },
        )
      : undefined;

    this.appConfig = appConfig
      ? new AppConfig(
          appConfig.name ?? name,
          { ...others, ...appConfig, vaultInfo: this.vaultInfo },
          { ...opts, parent: this },
        )
      : undefined;

    this.appContainerEnv = appContainerEnv
      ? new AppContainerEnv(
          appContainerEnv.name ?? name,
          { ...others, ...appContainerEnv, vaultInfo: this.vaultInfo },
          { ...opts, parent: this },
        )
      : undefined;

    this.iotHub = iotHub
      ? new IoTHub(iotHub.name ?? name, { ...others, ...iotHub, vaultInfo: this.vaultInfo }, { ...opts, parent: this })
      : undefined;

    this.logicApp = logicApp
      ? new LogicApp(
          logicApp.name ?? name,
          { ...others, ...logicApp, vaultInfo: this.vaultInfo },
          { ...opts, parent: this },
        )
      : undefined;

    this.signalR = signalR
      ? new SignalR(
          signalR.name ?? name,
          { ...others, ...signalR, vaultInfo: this.vaultInfo },
          { ...opts, parent: this },
        )
      : undefined;

    this.azSql = azSql
      ? new AzSql(azSql.name ?? name, { ...others, ...azSql, vaultInfo: this.vaultInfo }, { ...opts, parent: this })
      : undefined;

    this.mySql = mySql
      ? new MySql(mySql.name ?? name, { ...others, ...mySql, vaultInfo: this.vaultInfo }, { ...opts, parent: this })
      : undefined;

    this.postgres = postgres
      ? new Postgres(
          postgres.name ?? name,
          { ...others, ...postgres, vaultInfo: this.vaultInfo },
          { ...opts, parent: this },
        )
      : undefined;

    this.redis = redis
      ? new Redis(redis.name ?? name, { ...others, ...redis, vaultInfo: this.vaultInfo }, { ...opts, parent: this })
      : undefined;
  }

  getOutputs() {
    return {
      vaultInfo: this.vaultInfo,
      apim: this.apim?.getOutputs(),
      storage: this.storage?.getOutputs(),
      serviceBus: this.serviceBus?.getOutputs(),
      automation: this.automation?.getOutputs(),
      azSearch: this.azSearch?.getOutputs(),
      appCert: this.appCert?.getOutputs(),
      appConfig: this.appConfig?.getOutputs(),
      appContainerEnv: this.appContainerEnv?.getOutputs(),
      iotHub: this.iotHub?.getOutputs(),
      logicApp: this.logicApp?.getOutputs(),
      signalR: this.signalR?.getOutputs(),
      azSql: this.azSql?.getOutputs(),
      mySql: this.mySql?.getOutputs(),
      postgres: this.postgres?.getOutputs(),
      redis: this.redis?.getOutputs(),
    };
  }

  private createVault(): types.ResourceOutputs | undefined {
    const { rsGroup, groupRoles, vaultInfo, vaultCreate, network } = this.args;
    if (vaultInfo) return { resourceName: pulumi.output(vaultInfo.resourceName), id: pulumi.output(vaultInfo.id) };
    if (!vaultCreate) return undefined;

    return new KeyVault(
      vaultCreate.name ?? this.name,
      { ...vaultCreate, rsGroup: rsGroup, groupRoles: groupRoles, network },
      {
        ...this.opts,
        parent: this,
      },
    ).getOutputs();
  }
}
