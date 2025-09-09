import * as nw from '@pulumi/azure-native/network';
import * as pulumi from '@pulumi/pulumi';
import * as types from '../types';

import { BaseComponent } from '../base/BaseComponent';
import { IpAddresses } from './IpAddresses';
import { getComponentResourceType } from '../base/helpers';

export interface BasionArgs
  extends types.WithResourceGroupInputs,
    Partial<
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
      >
    > {
  sku: nw.BastionHostSkuName;
  publicIPAddress?: types.SubResourceInputs;
  subnetId: pulumi.Input<string>;
  network?: Pick<types.NetworkArgs, 'ipRules'>;
}

export class Basion extends BaseComponent<BasionArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: BasionArgs, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('Basion'), name, args, opts);

    const { rsGroup, sku, network, subnetId, ...props } = args;

    const ipAddress = this.createIpAddress();

    const bs = new nw.BastionHost(
      name,
      {
        ...props,
        ...rsGroup,
        sku: { name: sku },
        ipConfigurations: [
          {
            name: 'IpConfig',
            publicIPAddress: sku !== 'Developer' ? ipAddress : undefined,
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

    this.registerOutputs();
  }

  public getOutputs() {
    return {
      id: this.id,
      resourceName: this.resourceName,
    };
  }

  private createIpAddress() {
    const { rsGroup, publicIPAddress } = this.args;
    if (publicIPAddress) return publicIPAddress;
    const n = `${this.name}-bastion-ip`;

    return new IpAddresses(
      `${this.name}-ip`,
      {
        rsGroup,
        sku: { name: 'Standard' },
        ipAddresses: [{ name: n }],
      },
      { parent: this },
    ).getOutputs()[n];
  }
}
