import * as web from '@pulumi/azure-native/web';
import * as pulumi from '@pulumi/pulumi';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
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

export interface AppServiceArgs
  extends CommonBaseArgs, Omit<web.AppServicePlanArgs, 'resourceGroupName' | 'location' | 'name' | 'kind'> {
  kind?: AppKind;
  webApps: Array<
    Omit<web.WebAppArgs, 'resourceGroupName' | 'location' | 'serverFarmId' | 'kind' | 'name'> & {
      name: string;
      kind?: AppKind;
    }
  >;
}

export class AppService extends BaseResourceComponent<AppServiceArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: AppServiceArgs, opts?: pulumi.ComponentResourceOptions) {
    super('AppService', name, args, opts);

    const { rsGroup, groupRoles, vaultInfo, ...props } = args;

    const appPlan = new web.AppServicePlan(
      name,
      {
        ...props,
        ...args.rsGroup,
      },
      { dependsOn: opts?.dependsOn, parent: this },
    );

    this.createWebApps(appPlan);

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

  private createWebApps(appPlan: web.AppServicePlan) {
    const { webApps } = this.args;
    if (!webApps || webApps.length === 0) return undefined;

    return webApps.map(
      (webApp) =>
        new web.WebApp(
          `${this.name}-${webApp.name}`,
          {
            ...webApp,
            ...this.args.rsGroup,
            serverFarmId: appPlan.id,
          },
          { dependsOn: appPlan, parent: this },
        ),
    );
  }
}
