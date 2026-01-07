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
  AppContainer,
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

export interface AppResourcesArgs extends CommonBaseArgs, types.WithNetworkArgs {
  storageAccount?: Partial<StorageAccountArgs>;
  serviceBus?: Partial<ServiceBusArgs> & Pick<ServiceBusArgs, 'sku'>;
  automation?: Partial<AutomationArgs>;
  azSearch?: Partial<AzSearchArgs> & Pick<AzSearchArgs, 'sku'>;
  apim?: Partial<ApimArgs> & Pick<ApimArgs, 'sku'>;
  appCert?: Partial<AppCertArgs> & Pick<AppCertArgs, 'domain' | 'productType'>;
  appConfig?: Partial<AppConfigArgs>;
  appContainerEnv?: Partial<AppContainerEnvArgs>;
  iotHub?: Partial<IoTHubArgs> & Pick<IoTHubArgs, 'sku'>;
  logicApp?: Partial<LogicAppArgs> & Pick<LogicAppArgs, 'integrationAccount' | 'workflow'>;
  signalR?: Partial<SignalRArgs> & Pick<SignalRArgs, 'sku'>;
  azSql?: Partial<AzSqlArgs>;
  mySql?: Partial<MySqlArgs> & Pick<MySqlArgs, 'sku' | 'administratorLogin'>;
  postgres?: Partial<PostgresArgs> & Pick<PostgresArgs, 'sku' | 'administratorLogin'>;
  redis?: Partial<RedisArgs>;
}

export class AppResources extends BaseComponent<AppResourcesArgs> {
  public readonly storage?: StorageAccount;
  public readonly automation?: Automation;
  public readonly azSearch?: AzSearch;
  public readonly appCert?: AppCert;
  public readonly appConfig?: AppConfig;
  public readonly appContainer?: AppContainer;
  public readonly appContainerEnv?: AppContainerEnv;
  public readonly iotHub?: IoTHub;
  public readonly logicApp?: LogicApp;
  public readonly signalR?: SignalR;
  public readonly azSql?: AzSql;
  public readonly mySql?: MySql;
  public readonly postgres?: Postgres;
  public readonly redis?: Redis;
  private serviceBus?: ServiceBus;
  private apim?: Apim;

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

    this.apim = apim ? new Apim(name, { ...others, ...apim }, { ...opts, parent: this }) : undefined;

    this.storage = storageAccount
      ? new StorageAccount(name, { ...others, ...storageAccount }, { ...opts, parent: this })
      : undefined;

    this.serviceBus = serviceBus
      ? new ServiceBus(name, { ...others, ...serviceBus }, { ...opts, parent: this })
      : undefined;

    this.automation = automation
      ? new Automation(name, { ...others, ...automation }, { ...opts, parent: this })
      : undefined;

    this.azSearch = azSearch ? new AzSearch(name, { ...others, ...azSearch }, { ...opts, parent: this }) : undefined;

    this.appCert = appCert ? new AppCert(name, { ...others, ...appCert }, { ...opts, parent: this }) : undefined;

    this.appConfig = appConfig
      ? new AppConfig(name, { ...others, ...appConfig }, { ...opts, parent: this })
      : undefined;

    this.appContainerEnv = appContainerEnv
      ? new AppContainerEnv(name, { ...others, ...appContainerEnv }, { ...opts, parent: this })
      : undefined;

    this.iotHub = iotHub ? new IoTHub(name, { ...others, ...iotHub }, { ...opts, parent: this }) : undefined;

    this.logicApp = logicApp ? new LogicApp(name, { ...others, ...logicApp }, { ...opts, parent: this }) : undefined;

    this.signalR = signalR ? new SignalR(name, { ...others, ...signalR }, { ...opts, parent: this }) : undefined;

    this.azSql = azSql ? new AzSql(name, { ...others, ...azSql }, { ...opts, parent: this }) : undefined;

    this.mySql = mySql ? new MySql(name, { ...others, ...mySql }, { ...opts, parent: this }) : undefined;

    this.postgres = postgres ? new Postgres(name, { ...others, ...postgres }, { ...opts, parent: this }) : undefined;

    this.redis = redis ? new Redis(name, { ...others, ...redis }, { ...opts, parent: this }) : undefined;
  }

  getOutputs() {
    return {
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
}
