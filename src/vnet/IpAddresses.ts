import * as network from '@pulumi/azure-native/network';
import * as pulumi from '@pulumi/pulumi';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import { zoneHelper } from '../helpers';
import * as types from '../types';

type IpSku = {
  /**
   * Name of a public IP address SKU.
   */
  name: network.PublicIPAddressSkuName | string;
  /**
   * Tier of a public IP address SKU.
   */
  tier?: network.PublicIPAddressSkuTier;
};

export interface IpAddressesArgs extends CommonBaseArgs {
  sku: IpSku;
  prefix?: { length: 28 | 29 | 30 | 31 | number };
  /** The default config for all Ip address. */
  defaultConfig?: Omit<
    network.PublicIPAddressArgs,
    | 'id'
    | 'ipAddress'
    | 'publicIPPrefix'
    | 'resourceGroupName'
    | 'location'
    | 'sku'
    | 'publicIPAllocationMethod'
    | 'natGateway'
  >;
  ipAddresses: Array<Partial<Pick<network.PublicIPAddressArgs, 'zones'>> & { name: string; sku?: IpSku }>;
}

export class IpAddresses extends BaseResourceComponent<IpAddressesArgs> {
  public readonly ipAddresses: Record<
    string,
    types.ResourceOutputs & {
      ipAddress: pulumi.Output<string | undefined>;
    }
  > = {};

  constructor(name: string, args: IpAddressesArgs, opts?: pulumi.ComponentResourceOptions) {
    super('IpAddresses', name, args, opts);

    const { rsGroup, sku, defaultConfig, ipAddresses } = this.args;
    const prefix = this.createIpPrefix();

    ipAddresses.map((ip) => {
      const ipAddress = new network.PublicIPAddress(
        `${name}-${ip.name}`,
        {
          ...defaultConfig,
          ...rsGroup,
          sku: ip.sku ?? sku,
          publicIPPrefix: prefix ? { id: prefix.id } : undefined,
          publicIPAllocationMethod: network.IPAllocationMethod.Static,
          zones: zoneHelper.getDefaultZones(ip.zones ?? defaultConfig?.zones),
        },
        { ...opts, dependsOn: prefix ? prefix : opts?.dependsOn, parent: this, ignoreChanges: ['natGateway'] },
      );

      this.ipAddresses[ip.name] = {
        id: ipAddress.id,
        resourceName: ipAddress.name,
        resourceGroupName: pulumi.output(this.args.rsGroup.resourceGroupName),
        ipAddress: ipAddress.ipAddress,
      };
      return ipAddress;
    });

    this.registerOutputs();
  }

  public getOutputs(): Record<string, types.ResourceOutputs & { ipAddress: pulumi.Output<string | undefined> }> {
    return this.ipAddresses;
  }

  private createIpPrefix() {
    const { prefix, rsGroup, sku } = this.args;
    if (!prefix) return undefined;

    return new network.PublicIPPrefix(
      this.name,
      {
        ...rsGroup,
        prefixLength: prefix.length,
        sku,
      },
      { ...this.opts, parent: this },
    );
  }
}
