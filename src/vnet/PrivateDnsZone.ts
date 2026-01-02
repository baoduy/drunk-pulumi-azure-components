import * as privateDns from '@pulumi/azure-native/privatedns';
import * as pulumi from '@pulumi/pulumi';
import { BaseComponent } from '../base';
import { getComponentResourceType } from '../base/helpers';
import { rsHelpers } from '../helpers';
import { DnsRecordTypes, WithResourceGroupInputs } from '../types';
import * as helpers from './helpers';

export type DnsRecordArgs = Omit<
  privateDns.PrivateRecordSetArgs,
  'privateZoneName' | 'relativeRecordSetName' | 'resourceGroupName' | 'ttl' | 'recordType'
> & { recordType: DnsRecordTypes };

export interface PrivateDnsZoneArgs extends WithResourceGroupInputs {
  aRecords?: Array<{
    name: string;
    ipv4Address: pulumi.Input<pulumi.Input<string>[]>;
  }>;
  /** Link the private DNS zone to these Vnet also */
  vnetLinks: Array<pulumi.Input<{ vnetId: pulumi.Input<string> }>>;
}

export class PrivateDnsZone extends BaseComponent<PrivateDnsZoneArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;
  private readonly _rsName: string;

  constructor(name: string, args: PrivateDnsZoneArgs, opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('PrivateDnsZone'), name, args, opts);
    this._rsName = name.replace(/\./g, '-');
    const group = this.getRsGroupInfo();

    const zone = new privateDns.PrivateZone(
      this._rsName,
      {
        resourceGroupName: group.resourceGroupName,
        location: group.location,
        privateZoneName: name,
      },
      { ...opts, parent: this },
    );

    this.createVnetLinks(zone);

    this.id = zone.id;
    this.resourceName = zone.name;

    this.createARecord();

    this.registerOutputs();
  }

  public getOutputs() {
    return {
      id: this.id,
      resourceName: this.resourceName,
    };
  }

  public addARecords(
    aRecords: Array<{
      name: string;
      ipv4Address: pulumi.Input<pulumi.Input<string>[]>;
    }>,
  ) {
    return aRecords.map((aRecord) =>
      this.addRecordSet(aRecord.name, {
        recordType: 'A',
        aRecords: pulumi.output(aRecord.ipv4Address).apply((ips) => ips.map((i) => ({ ipv4Address: i }))),
      }),
    );
  }

  public addRecordSet(name: string, props: DnsRecordArgs) {
    const group = this.getRsGroupInfo();
    return new privateDns.PrivateRecordSet(
      `${this._rsName}-${helpers.getDnsRecordName(name)}-${props.recordType}`,
      {
        ...props,
        ...group,
        privateZoneName: this.resourceName,
        relativeRecordSetName: name,
        ttl: 3600,
      },
      { parent: this },
    );
  }

  protected getRsGroupInfo() {
    const group = this.args.rsGroup;
    return {
      resourceGroupName: group.resourceGroupName,
      location: 'global',
    };
  }

  private createARecord() {
    const { aRecords } = this.args;
    if (!aRecords) return;
    this.addARecords(aRecords);
  }

  private createVnetLinks(zone: privateDns.PrivateZone) {
    const group = this.getRsGroupInfo();
    pulumi.output(this.args.vnetLinks).apply((vids) =>
      vids.map((v) => {
        const vnetName = rsHelpers.getRsNameFromId(v.vnetId);
        return new privateDns.VirtualNetworkLink(
          `${this._rsName}-${vnetName}`.substring(0, 55),
          {
            ...group,
            privateZoneName: zone.name,
            registrationEnabled: false,
            virtualNetwork: { id: v.vnetId },
          },
          { dependsOn: zone, deletedWith: zone, parent: this },
        );
      }),
    );
  }
}
