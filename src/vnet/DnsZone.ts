import * as dns from '@pulumi/azure-native/dns';
import * as pulumi from '@pulumi/pulumi';

import * as types from '../types';
import { DnsRecordTypes, WithResourceGroupInputs } from '../types';

import { BaseComponent } from '../base';
import { getComponentResourceType } from '../base/helpers';
import { getDnsRecordName } from './helpers';

type DnsZoneRecordArgs = Omit<
  dns.RecordSetArgs,
  'zoneName' | 'relativeRecordSetName' | 'resourceGroupName' | 'ttl' | 'recordType'
> & {
  name: string;
  recordType: DnsRecordTypes;
};

type DnsZoneProps = { name: string; records?: DnsZoneRecordArgs[] };

export interface DnsZoneArgs extends WithResourceGroupInputs, DnsZoneProps {
  /**
   * Sub-zones delegated from this zone. Each child `name` is a label under the root zone: `{ name: 'sub' }`
   * under `example.com` creates the Azure zone `sub.example.com` and an NS record `sub` in the root zone.
   *
   * Upgrade note: before this fix a child resource pointed at the root Azure zone, so replacing it would delete
   * the root zone. Stacks deployed with `children` on an older version must remove each old child zone from
   * state (`pulumi state delete <child-zone-urn>`) before upgrading.
   *
   * Upgrade note: a zone record's relative name is now its `name` as given (`www`, `*`); older versions prefixed
   * it with the zone name (`example.com-www`, `sub-*`). Root and child zone records created by an older version
   * are replaced on upgrade.
   */
  children?: DnsZoneProps[];
}

export class DnsZone extends BaseComponent<DnsZoneArgs> {
  public readonly id: pulumi.Output<string>;
  public readonly resourceName: pulumi.Output<string>;
  private _rsName: string;

  constructor(name: string, args: DnsZoneArgs, opts?: pulumi.ComponentResourceOptions) {
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

    this.registerOutputs();
  }

  public getOutputs(): types.ResourceOutputs {
    return {
      id: this.id,
      resourceName: this.resourceName,
      resourceGroupName: pulumi.output(this.args.rsGroup.resourceGroupName),
    };
  }

  public addARecords(
    zone: dns.Zone,
    aRecords: Array<{
      name: string;
      ipv4Address: pulumi.Input<pulumi.Input<string>[]>;
    }>,
  ) {
    return aRecords.map((aRecord) =>
      this.addRecordSet(zone, aRecord.name, {
        recordType: 'A',
        aRecords: pulumi.output(aRecord.ipv4Address).apply((ips) => ips.map((i) => ({ ipv4Address: i }))),
      }),
    );
  }

  /**
   * Adds a record set `name` to `zone`. `zoneLabel` only goes into the Pulumi resource name, so the same record
   * name in two zones of this component gets two distinct resources.
   */
  public addRecordSet(
    zone: dns.Zone,
    name: string,
    props: Omit<dns.RecordSetArgs, 'zoneName' | 'relativeRecordSetName' | 'resourceGroupName' | 'ttl'>,
    zoneLabel?: string,
  ) {
    const group = this.getRsGroupInfo();
    return new dns.RecordSet(
      `${this._rsName}${zoneLabel ? `-${zoneLabel}` : ''}-${getDnsRecordName(name)}-${props.recordType}`,
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

  private createZone({ name, records }: DnsZoneProps, parent?: dns.Zone) {
    const group = this.getRsGroupInfo();

    const zone = new dns.Zone(
      name,
      {
        resourceGroupName: group.resourceGroupName,
        location: group.location,
        zoneName: parent ? `${name}.${this.name}` : this.name,
      },
      parent ? { ...this.childOpts, dependsOn: parent, parent: this } : { ...this.opts, parent: this },
    );

    if (records) {
      records.map((record) => {
        this.addRecordSet(zone, record.name, record, name);
      });
    }

    if (parent) {
      zone.nameServers.apply((ns) => {
        this.addRecordSet(parent, name, {
          recordType: 'NS',
          nsRecords: ns.map((s) => ({ nsdname: s })),
        });
      });
    }
    return zone;
  }
}
