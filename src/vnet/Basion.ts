import * as nw from '@pulumi/azure-native/network';
import * as pulumi from '@pulumi/pulumi';
import { BaseResourceComponent, CommonBaseArgs } from '../base';
import * as types from '../types';
import * as vault from '../vault';
import { PrivateEndpoint } from '../vnet/PrivateEndpoint';
import { IpAddresses } from './IpAddresses';

export interface BasionArgs
  extends CommonBaseArgs,
    types.WithUserAssignedIdentity,
    types.WithEncryptionEnabler,
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
  network: Pick<types.NetworkArgs, 'ipRules'> & { subnetId: pulumi.Input<string> };
}

export class Basion extends BaseResourceComponent<BasionArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, args: BasionArgs, opts?: pulumi.ComponentResourceOptions) {
    super('Basion', name, args, opts);

    const { rsGroup, sku, network, ...props } = args;
    const ips = new IpAddresses(
      name,
      { rsGroup, sku: { name: 'Basic', tier: 'Regional' }, ipAddresses: [{ name: 'basion-ip' }] },
      { dependsOn: opts?.dependsOn, parent: this },
    );
    const ip = ips.ipAddresses['basion-ip'];

    const bs = new nw.BastionHost(
      name,
      {
        ...props,
        ...rsGroup,
        sku: { name: sku },
        ipConfigurations: [
          {
            name: 'IpConfig',
            publicIPAddress: { id: ip.id },
            subnet: { id: network.subnetId },
            privateIPAllocationMethod: nw.IPAllocationMethod.Dynamic,
          },
        ],
        networkAcls: network.ipRules
          ? { ipRules: pulumi.output(network.ipRules).apply((ips) => ips.map((ip) => ({ addressPrefix: ip }))) }
          : undefined,
      },
      {
        ...opts,
        dependsOn: ips,
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
