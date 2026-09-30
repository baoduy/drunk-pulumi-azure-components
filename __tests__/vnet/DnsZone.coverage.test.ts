import { Captured, restoreStack, withStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1852 coverage: DnsZone branches the DRK-1821 acceptance tests do not reach (zone records,
 * addARecords, outputs). Pins today's behaviour.
 */

const ZONE = 'azure-native:dns:Zone';
const RECORD_SET = 'azure-native:dns:RecordSet';

const resolve = <T>(output: { apply: (fn: (v: T) => unknown) => unknown }) =>
  new Promise<T>((done) => output.apply((v) => done(v)));

async function waitFor(done: () => boolean, maxTicks = 200) {
  for (let tick = 0; tick < maxTicks && !done(); tick++) await new Promise((r) => setImmediate(r));
}

describe('DnsZone — untouched branches (DRK-1852 coverage)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  let captured: Captured[];
  let dnsZone: import('../../src/vnet/DnsZone').DnsZone;
  let Zone: typeof import('@pulumi/azure-native/dns').Zone;

  beforeAll(async () => {
    const loaded = withStack(
      'dev',
      () => {
        const mod: typeof import('../../src/vnet/DnsZone') = require('../../src/vnet/DnsZone');
        const dns: typeof import('@pulumi/azure-native/dns') = require('@pulumi/azure-native/dns');
        return { DnsZone: mod.DnsZone, Zone: dns.Zone };
      },
      ({ type, name }) => (type === ZONE ? { nameServers: [`ns1-${name}.azure-dns.com`] } : {}),
    );
    captured = loaded.captured;
    Zone = loaded.Zone;

    dnsZone = new loaded.DnsZone('contoso.com', {
      rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
      name: 'contoso.com',
      records: [{ name: 'www', recordType: 'CNAME', cnameRecord: { cname: 'contoso.azurewebsites.net' } }],
      children: [{ name: 'api', records: [{ name: '*', recordType: 'TXT', txtRecords: [{ value: ['v'] }] }] }],
    });
    await resolve(dnsZone.id);
    await waitFor(() => captured.some((c) => c.type === RECORD_SET && c.inputs.recordType === 'NS'));
  }, 30000);
  afterAll(() => restoreStack(ORIGINAL_STACK));

  const recordSets = () => captured.filter((c) => c.type === RECORD_SET);

  test('zones are global and in the caller resource group', () => {
    const zones = captured.filter((c) => c.type === ZONE);
    expect(zones.map((z) => z.inputs)).toEqual([
      { resourceGroupName: 'rg', location: 'global', zoneName: 'contoso.com', zoneType: 'Public' },
      { resourceGroupName: 'rg', location: 'global', zoneName: 'api.contoso.com', zoneType: 'Public' },
    ]);
  });

  test('root zone records land in the root zone with a 3600 ttl', () => {
    const cname = recordSets().find((c) => c.inputs.recordType === 'CNAME')!;
    expect(cname.name).toBe('contoso-com-contoso.com-www-aRecord-CNAME');
    expect(cname.inputs).toEqual({
      recordType: 'CNAME',
      cnameRecord: { cname: 'contoso.azurewebsites.net' },
      resourceGroupName: 'rg',
      zoneName: 'contoso.com',
      relativeRecordSetName: 'contoso.com-www',
      ttl: 3600,
    });
  });

  // The mocked zone's `name` output is its Pulumi resource name, so the child zone reads as 'api'.
  test('child zone records land in the child zone', () => {
    const txt = recordSets().find((c) => c.inputs.recordType === 'TXT')!;
    expect(txt.inputs.zoneName).toBe('api');
    expect(txt.inputs.relativeRecordSetName).toBe('api-*');
  });

  test('child NS record is named after the child label', () => {
    const ns = recordSets().find((c) => c.inputs.recordType === 'NS')!;
    expect(ns.name).toBe('contoso-com-api-aRecord-NS');
    expect(ns.inputs.nsRecords).toEqual([{ nsdname: 'ns1-api.azure-dns.com' }]);
  });

  test('addARecords: one A record set per entry, ipv4 addresses mapped; * and @ get their own names', async () => {
    const zone = new Zone('extra.com', { resourceGroupName: 'rg', zoneName: 'extra.com' });
    const created = dnsZone.addARecords(zone, [
      { name: '*', ipv4Address: ['10.0.0.1', '10.0.0.2'] },
      { name: '@', ipv4Address: ['10.0.0.3'] },
    ]);
    expect(created).toHaveLength(2);
    await Promise.all(created.map((r) => resolve(r.id)));

    const aRecords = Object.fromEntries(
      recordSets()
        .filter((c) => c.inputs.recordType === 'A')
        .map((c) => [c.name, c.inputs]),
    );
    expect(Object.keys(aRecords).sort()).toEqual(['contoso-com-all-aRecord-A', 'contoso-com-root-aRecord-A']);
    expect(aRecords['contoso-com-all-aRecord-A'].aRecords).toEqual([
      { ipv4Address: '10.0.0.1' },
      { ipv4Address: '10.0.0.2' },
    ]);
    expect(aRecords['contoso-com-all-aRecord-A'].relativeRecordSetName).toBe('*');
    expect(aRecords['contoso-com-all-aRecord-A'].zoneName).toBe('extra.com');
    expect(aRecords['contoso-com-root-aRecord-A'].aRecords).toEqual([{ ipv4Address: '10.0.0.3' }]);
    expect(aRecords['contoso-com-root-aRecord-A'].relativeRecordSetName).toBe('@');
  });

  test('getOutputs: root zone id, name and resource group', async () => {
    const outputs = dnsZone.getOutputs();
    expect(await resolve(outputs.id)).toBe('contoso.com_id');
    expect(await resolve(outputs.resourceName)).toBe('contoso.com');
    expect(await resolve(outputs.resourceGroupName)).toBe('rg');
  });
});
