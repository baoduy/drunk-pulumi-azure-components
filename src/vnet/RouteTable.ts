import * as network from '@pulumi/azure-native/network';
import * as pulumi from '@pulumi/pulumi';
import { BaseComponent } from '../base';
import { getComponentResourceType } from '../base/helpers';
import * as types from '../types';

export type RouteArgs = Omit<
  network.RouteArgs,
  'id' | 'resourceGroupName' | 'routeTableName' | 'name' | 'nextHopType' | 'routeName' | 'type'
> & {
  nextHopType: network.RouteNextHopType;
};

export interface RouteTableArgs
  extends types.WithResourceGroupInputs, Partial<Pick<network.RouteTableArgs, 'disableBgpRoutePropagation'>> {
  routes?: Array<
    RouteArgs & {
      name: string;
    }
  >;
}

export class RouteTable extends BaseComponent<RouteTableArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: RouteTableArgs, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('RouteTable'), name, args, opts);

    const { rsGroup, routes = [], ...props } = args;
    const tb = new network.RouteTable(
      name,
      {
        ...props,
        ...rsGroup,
        routes: undefined,
      },
      { ...opts, ignoreChanges: ['routes'], parent: this },
    );

    this.id = tb.id;
    this.resourceName = tb.name;

    routes.map((r) => {
      this.addRoute(r.name, { ...r, ...rsGroup });
    });

    this.registerOutputs();
  }

  public getOutputs() {
    return {
      id: this.id,
      resourceName: this.resourceName,
    };
  }

  public addRoute(name: string, props: RouteArgs) {
    const { rsGroup } = this.args;
    return new network.Route(`${this.name}-${name}`, {
      ...rsGroup,
      ...props,
      routeTableName: this.resourceName,
      routeName: name,
    });
  }
}
