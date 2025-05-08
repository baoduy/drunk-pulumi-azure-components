import * as nw from '@pulumi/azure-native/network';
import * as pulumi from '@pulumi/pulumi';
import { getComponentResourceType } from '../base/helpers';
import * as types from '../types';

export interface BasionArgs
  extends types.WithResourceGroupInputs,
    Pick<
      nw.BastionHostArgs,
      | 'disableCopyPaste'
      | 'dnsName'
      | 'enableFileCopy'
      | 'enableIpConnect'
      | 'enableKerberos'
      | 'enablePrivateOnlyBastion'
      | 'enableSessionRecording'
      | 'enableShareableLink'
      | 'enableTunneling'
      | 'scaleUnits'
      | 'zones'
      | 'tags'
    > {
  sku: nw.BastionHostSkuName;
  publicIPAddress: types.SubResourceInputs;
  subnetId: pulumi.Input<string>;
  network?: Pick<types.NetworkArgs, 'ipRules'>;
}

export class Basion extends pulumi.ComponentResource<BasionArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: BasionArgs, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('Basion'), name, args, opts);

    const { rsGroup, sku, network, publicIPAddress, subnetId, ...props } = args;

    const bs = new nw.BastionHost(
      name,
      {
        ...props,
        ...rsGroup,
        sku: { name: sku },
        ipConfigurations: [
          {
            name: 'IpConfig',
            publicIPAddress: sku !== 'Developer' ? publicIPAddress : undefined,
            subnet: { id: subnetId },
            privateIPAllocationMethod: nw.IPAllocationMethod.Dynamic,
          },
        ],

        networkAcls: network?.ipRules
          ? { ipRules: pulumi.output(network.ipRules).apply((ips) => ips.map((ip) => ({ addressPrefix: ip }))) }
          : undefined,
      },
      {
        ...opts,
        parent: this,
      },
    );

    this.id = bs.id;
    this.resourceName = bs.name;

    this.registerOutputs({
      id: this.id,
      resourceName: this.resourceName,
    });
  }
}
