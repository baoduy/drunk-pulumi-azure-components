import * as pulumi from '@pulumi/pulumi';
import * as privateDns from '@pulumi/azure-native/privatedns';
import { BaseArgs, BaseResourceComponent } from '../base';
import { WithResourceGroupInputs } from '../types';
import * as helpers from './helpers';

export interface PrivateDnsZoneArgs extends BaseArgs, WithResourceGroupInputs {
  aRecords?: Array<{
    name: string;
    ipv4Address: pulumi.Input<pulumi.Input<string>[]>;
  }>;
  /** Link the private DNS zone to these Vnet also */
  vnetLinks: Array<pulumi.Input<{ vnetId: string }>>;
}

export class PrivateDnsZone extends BaseResourceComponent<PrivateDnsZoneArgs> {
  private _rsName: string;

  public readonly id: pulumi.Output<string>;
  public readonly location: pulumi.Output<string | undefined>;
  public readonly resourceGroupName: pulumi.Output<string>;

  constructor(
    name: string,
    args: PrivateDnsZoneArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('PrivateDnsZone', name, args, opts);
    this._rsName = name.replace(/\./g, '-');
    const group = this.getRsGroupInfo();

    const zone = new privateDns.PrivateZone(
      this._rsName,
      {
        resourceGroupName: group.resourceGroupName,
        location: group.location,
        privateZoneName: name,
      },
      { ...opts, parent: this }
    );

    this.createARecord(zone);
    this.createVnetLinks(zone);

    this.id = zone.id;
    this.location = zone.location;
    this.resourceGroupName = pulumi.output(group.resourceGroupName);

    this.registerOutputs({
      id: this.id,
      location: this.location,
      resourceGroupName: this.resourceGroupName,
    });
  }

  private getRecordName(recordName: string) {
    return recordName === '*'
      ? `all-aRecord`
      : recordName === '@'
      ? `root-aRecord`
      : `${recordName}-aRecord`;
  }

  private createARecord(zone: privateDns.PrivateZone) {
    const { aRecords } = this.args;
    if (!aRecords) return;

    const group = this.getRsGroupInfo();
    aRecords.map((aRecord) => {
      const recordName = this.getRecordName(aRecord.name);

      return new privateDns.PrivateRecordSet(
        `${this._rsName}-${recordName}`,
        {
          ...group,
          privateZoneName: zone.name,
          relativeRecordSetName: recordName,
          recordType: 'A',
          aRecords: pulumi
            .output(aRecord.ipv4Address)
            .apply((ips) => ips.map((i) => ({ ipv4Address: i }))),
          ttl: 3600,
        },
        { dependsOn: zone, parent: this }
      );
    });
  }

  private createVnetLinks(zone: privateDns.PrivateZone) {
    const group = this.getRsGroupInfo();
    pulumi.output(this.args.vnetLinks).apply((vids) =>
      vids.map((v) => {
        const vnetName = helpers.getRsNameFromId(v.vnetId);
        return new privateDns.VirtualNetworkLink(
          `${this._rsName}-${vnetName}`,
          {
            ...group,
            privateZoneName: zone.name,
            registrationEnabled: false,
            virtualNetwork: { id: v.vnetId },
          },
          { dependsOn: zone, parent: this }
        );
      })
    );
  }

  protected getRsGroupInfo() {
    const group = this.args.rsGroup;
    return {
      resourceGroupName: group.resourceGroupName,
      location: 'global',
    };
  }
}
