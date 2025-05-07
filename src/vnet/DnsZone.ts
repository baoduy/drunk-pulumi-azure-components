import * as dns from '@pulumi/azure-native/dns';
import * as pulumi from '@pulumi/pulumi';
import { getComponentResourceType } from '../base/helpers';
import { WithResourceGroupInputs } from '../types';
import * as helpers from './helpers';

type DnsZoneRecordArgs = Omit<dns.RecordSetArgs, 'zoneName' | 'relativeRecordSetName' | 'resourceGroupName' | 'ttl'> & {
  name: string;
};
type DnsZoneProps = { name: string; records?: DnsZoneRecordArgs[] };

export interface DnsZoneArgs extends WithResourceGroupInputs, DnsZoneProps {
  children?: DnsZoneProps[];
}

export class DnsZone extends pulumi.ComponentResource<DnsZoneArgs> {
  private _rsName: string;

  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;

  constructor(private name: string, private args: DnsZoneArgs, private opts?: pulumi.ComponentResourceOptions) {
    super(getComponentResourceType('DnsZone'), name, args, opts);
    this._rsName = name.replace(/\./g, '-');

    const { rsGroup, children, ...props } = args;
    const zone = this.createZone(props);
    if (children) {
      children.map((child) => {
        this.createZone(child, zone);
      });
    }

    this.id = zone.id;
    this.resourceName = zone.name;

    this.registerOutputs({
      id: this.id,
      resourceName: this.resourceName,
    });
  }

  private createZone({ name, records }: DnsZoneProps, parent?: dns.Zone) {
    const group = this.getRsGroupInfo();

    const zone = new dns.Zone(
      name,
      {
        resourceGroupName: group.resourceGroupName,
        location: group.location,
        zoneName: this.name,
      },
      { ...this.opts, dependsOn: parent ? parent : this.opts?.dependsOn, parent: this },
    );

    if (records) {
      records.map((record) => {
        this.addRecordSet(zone, `${name}-${record.name}`, record);
      });
    }

    if (parent) {
      zone.nameServers.apply((ns) => {
        this.addRecordSet(parent, `${this.name}-${name}-ns`, {
          recordType: 'NS',
          nsRecords: ns.map((s) => ({ nsdname: s })),
        });
      });
    }
    return zone;
  }

  public addRecordSet(
    zone: dns.Zone,
    name: string,
    props: Omit<dns.RecordSetArgs, 'zoneName' | 'relativeRecordSetName' | 'resourceGroupName' | 'ttl'>,
  ) {
    const group = this.getRsGroupInfo();
    return new dns.RecordSet(
      `${this._rsName}-${name}`,
      {
        ...props,
        ...group,
        zoneName: zone.name,
        relativeRecordSetName: name,
        ttl: 3600,
      },
      { dependsOn: zone, parent: this },
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
