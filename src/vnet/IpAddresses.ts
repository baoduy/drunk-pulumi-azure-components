import * as network from '@pulumi/azure-native/network';
import * as pulumi from '@pulumi/pulumi';
import { BaseResourceComponent, CommonBaseArgs } from '../base';

export interface IpAddressesArgs extends CommonBaseArgs {
  sku: {
    /**
     * Name of a public IP address SKU.
     */
    name?: network.PublicIPAddressSkuName;
    /**
     * Tier of a public IP address SKU.
     */
    tier?: network.PublicIPAddressSkuTier;
  };
  prefix?: { length: 28 | 29 | 30 | 31 | number };
  config?: Omit<
    network.PublicIPAddressArgs,
    'id' | 'ipAddress' | 'publicIPPrefix' | 'resourceGroupName' | 'location' | 'sku' | 'publicIPAllocationMethod'
  >;
  ipAddresses: Array<{ name: string }>;
}

export class IpAddresses extends BaseResourceComponent<IpAddressesArgs> {
  public readonly ipAddresses: Record<
    string,
    {
      id: pulumi.Output<string>;
      resourceName: pulumi.Output<string>;
      address: pulumi.Output<string | undefined>;
    }
  > = {};

  constructor(name: string, args: IpAddressesArgs, opts?: pulumi.ComponentResourceOptions) {
    super('IpAddresses', name, args, opts);

    const { rsGroup, sku, config, ipAddresses } = this.args;
    const prefix = this.createIpPrefix();

    ipAddresses.map((ip) => {
      const ipAddress = new network.PublicIPAddress(
        `${name}-${ip.name}`,
        {
          ...config,
          ...rsGroup,
          sku,
          publicIPPrefix: prefix ? { id: prefix.id } : undefined,
          publicIPAllocationMethod: network.IPAllocationMethod.Static,
        },
        { ...opts, dependsOn: prefix ? prefix : opts?.dependsOn, parent: this },
      );

      this.ipAddresses[ip.name] = { id: ipAddress.id, resourceName: ipAddress.name, address: ipAddress.ipAddress };
    });

    this.registerOutputs({ ipAddresses: this.ipAddresses });
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
