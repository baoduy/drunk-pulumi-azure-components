import * as privateDns from '@pulumi/azure-native/privatedns';
import * as pulumi from '@pulumi/pulumi';
import { getComponentResourceType } from '../base/helpers';
import { WithResourceGroupInputs } from '../types';
import * as helpers from './helpers';

export interface PrivateDnsZoneArgs extends WithResourceGroupInputs {
  aRecords?: Array<{
    name: string;
    ipv4Address: pulumi.Input<pulumi.Input<string>[]>;
  }>;
  /** Link the private DNS zone to these Vnet also */
  vnetLinks: Array<pulumi.Input<{ vnetId: string }>>;
}

export class PrivateDnsZone extends pulumi.ComponentResource<PrivateDnsZoneArgs> {
  private _rsName: string;

  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(name: string, private args: PrivateDnsZoneArgs, opts?: pulumi.ComponentResourceOptions) {
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

    this.createARecord(zone);

    this.registerOutputs({
      id: this.id,
      resourceName: this.resourceName,
    });
  }

  private getRecordName(recordName: string) {
    return recordName === '*' ? `all-aRecord` : recordName === '@' ? `root-aRecord` : `${recordName}-aRecord`;
  }

  private createARecord(zone: privateDns.PrivateZone) {
    const { aRecords } = this.args;
    if (!aRecords) return;

    aRecords.map((aRecord) => {
      const recordName = this.getRecordName(aRecord.name);

      return this.addRecordSet(recordName, {
        recordType: 'A',
        aRecords: pulumi.output(aRecord.ipv4Address).apply((ips) => ips.map((i) => ({ ipv4Address: i }))),
      });
    });
  }

  public addRecordSet(
    name: string,
    props: Omit<
      privateDns.PrivateRecordSetArgs,
      'privateZoneName' | 'relativeRecordSetName' | 'resourceGroupName' | 'ttl'
    >,
  ) {
    const group = this.getRsGroupInfo();
    return new privateDns.PrivateRecordSet(
      `${this._rsName}-${name}`,
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
          { dependsOn: zone, parent: this },
        );
      }),
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
