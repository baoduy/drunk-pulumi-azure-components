import * as inputs from '@pulumi/azure-native/types/input';
import * as web from '@pulumi/azure-native/web';
import * as pulumi from '@pulumi/pulumi';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import { azureEnv } from '../helpers';
import * as types from '../types';

/**
 * Represents different kinds of Azure App Service configurations
 */
export enum AppKind {
  /**
   * Windows Web App
   */
  App = 'app',

  /**
   * Linux Web App
   */
  AppLinux = 'app,linux',

  /**
   * Linux Container Web App
   */
  AppLinuxContainer = 'app,linux,container',

  /**
   * Windows Container Web App (Hyper-V)
   */
  HyperV = 'hyperV',

  /**
   * Windows Container Web App
   */
  AppContainerWindows = 'app,container,windows',

  /**
   * Linux Web App on Azure Arc
   */
  AppLinuxKubernetes = 'app,linux,kubernetes',

  /**
   * Linux Container Web App on Azure Arc
   */
  AppLinuxContainerKubernetes = 'app,linux,container,kubernetes',

  /**
   * Function Code App
   */
  FunctionApp = 'functionapp',

  /**
   * Linux Consumption Function App
   */
  FunctionAppLinux = 'functionapp,linux',

  /**
   * Function Container App on Azure Arc
   */
  FunctionAppLinuxContainerKubernetes = 'functionapp,linux,container,kubernetes',

  /**
   * Function Code App on Azure Arc
   */
  FunctionAppLinuxKubernetes = 'functionapp,linux,kubernetes',
}

/** Plan SKU tiers that accept `alwaysOn: true`. */
const ALWAYS_ON_TIERS = [
  'Basic',
  'Standard',
  'Premium',
  'PremiumV2',
  'PremiumV3',
  'PremiumMV3',
  'PremiumV4',
  'Isolated',
  'IsolatedV2',
];

/** Plan SKU tiers that support zone redundancy. */
const ZONE_REDUNDANT_TIERS = ['PremiumV2', 'PremiumV3', 'PremiumMV3', 'PremiumV4', 'ElasticPremium', 'IsolatedV2'];

/** Azure's minimum instance count for a zone-redundant plan. */
const ZONE_REDUNDANT_MIN_CAPACITY = 2;

/**
 * Arguments for {@link AppService}.
 *
 * Every web app gets secure defaults for any value the caller leaves unset: `httpsOnly: true`,
 * `siteConfig.minTlsVersion: '1.2'`, `siteConfig.ftpsState: 'Disabled'`, `siteConfig.http20Enabled: true`.
 * In PRD, `siteConfig.alwaysOn` and the plan's `zoneRedundant` default to `true` where the plan SKU supports them.
 * A value the caller sets always wins.
 *
 * Breaking:
 * - Basic-auth (publish-profile) FTP and SCM publishing is disabled on every web app by default.
 *   SCM (Kudu/zip) deploys with publish-profile credentials need `allowBasicPublishing: true` on that web app.
 * - `siteConfig.ftpsState` defaults to `'Disabled'`, which turns FTP off on its own. FTP deploys need both
 *   `allowBasicPublishing: true` and `siteConfig.ftpsState: 'FtpsOnly'` (or `'AllAllowed'`) on that web app.
 * - Existing PRD plans on a zone-capable tier with `sku.capacity` of 2 or more get `zoneRedundant: true` on their
 *   next `up`. Set `zoneRedundant: false` to keep the current state.
 */
export interface AppServiceArgs
  extends CommonBaseArgs, Omit<web.AppServicePlanArgs, 'resourceGroupName' | 'location' | 'name' | 'kind'> {
  kind?: AppKind;
  webApps: Array<
    Omit<web.WebAppArgs, 'resourceGroupName' | 'location' | 'serverFarmId' | 'kind' | 'name'> & {
      name: string;
      kind?: AppKind;
      /**
       * Re-enables basic-auth (publish-profile username/password) publishing over FTP and SCM (Kudu/zip deploy)
       * for this web app. Default `false`: both are disabled.
       * On its own this flag restores SCM only. FTP also stays off while `siteConfig.ftpsState` is `'Disabled'`
       * (the default); set `siteConfig.ftpsState` to `'FtpsOnly'` or `'AllAllowed'` as well to restore FTP.
       */
      allowBasicPublishing?: boolean;
    }
  >;
}

export class AppService extends BaseResourceComponent<AppServiceArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: AppServiceArgs, opts?: pulumi.ComponentResourceOptions) {
    super('AppService', name, args, opts);

    const { rsGroup, groupRoles, vaultInfo, ...props } = args;

    // A sku passed as an Output (or a non-literal tier/capacity) is treated as unknown: no PRD defaults.
    const sku = props.sku as inputs.web.SkuDescriptionArgs | undefined;
    const tier = typeof sku?.tier === 'string' ? sku.tier : '';
    const capacity = typeof sku?.capacity === 'number' ? sku.capacity : 0;

    const appPlan = new web.AppServicePlan(
      name,
      {
        ...props,
        ...args.rsGroup,
        zoneRedundant:
          props.zoneRedundant ??
          (azureEnv.isPrd && ZONE_REDUNDANT_TIERS.includes(tier) && capacity >= ZONE_REDUNDANT_MIN_CAPACITY),
      },
      { dependsOn: opts?.dependsOn, parent: this },
    );

    this.createWebApps(appPlan, azureEnv.isPrd && ALWAYS_ON_TIERS.includes(tier));

    this.id = appPlan.id;
    this.resourceName = appPlan.name;

    this.registerOutputs();
  }

  public getOutputs(): types.ResourceOutputs {
    return {
      id: this.id,
      resourceName: this.resourceName,
      resourceGroupName: pulumi.output(this.args.rsGroup.resourceGroupName),
    };
  }

  private createWebApps(appPlan: web.AppServicePlan, alwaysOn: boolean) {
    const { webApps, rsGroup } = this.args;
    if (!webApps || webApps.length === 0) return undefined;

    return webApps.map(({ allowBasicPublishing, ...webApp }) => {
      const app = new web.WebApp(
        `${this.name}-${webApp.name}`,
        {
          ...webApp,
          ...rsGroup,
          httpsOnly: webApp.httpsOnly ?? true,
          siteConfig: pulumi.output(webApp.siteConfig).apply((siteConfig) => ({
            minTlsVersion: '1.2',
            ftpsState: 'Disabled',
            http20Enabled: true,
            alwaysOn,
            ...siteConfig,
          })),
          serverFarmId: appPlan.id,
        },
        { dependsOn: appPlan, parent: this },
      );

      const publishing = {
        allow: allowBasicPublishing ?? false,
        name: app.name,
        resourceGroupName: rsGroup.resourceGroupName,
      };
      new web.WebAppFtpAllowed(`${this.name}-${webApp.name}-ftp`, publishing, { dependsOn: app, parent: this });
      new web.WebAppScmAllowed(`${this.name}-${webApp.name}-scm`, publishing, { dependsOn: app, parent: this });

      return app;
    });
  }
}
