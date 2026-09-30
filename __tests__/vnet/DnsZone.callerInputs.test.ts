import { Captured, restoreStack, withStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1821 row 6: a DnsZone child becomes its own Azure zone (`<child>.<root>`), and its NS
 * delegation record in the root zone uses the child label. Every expected value below is a
 * literal from the spec (DRK-1821 / DRK-1855 §6-§7).
 */

const ZONE = 'azure-native:dns:Zone';
const RECORD_SET = 'azure-native:dns:RecordSet';

/**
 * The child's NS record is created inside `zone.nameServers.apply(...)`, which resolves some
 * ticks after the zone itself is registered. Poll the captured resources, bounded, until it lands.
 */
async function waitFor(done: () => boolean, maxTicks = 200) {
  for (let tick = 0; tick < maxTicks && !done(); tick++) await new Promise((resolve) => setImmediate(resolve));
}

async function deployRootWithChild(): Promise<Captured[]> {
  const { DnsZone, captured } = withStack(
    'dev',
    () => {
      const mod: typeof import('../../src/vnet/DnsZone') = require('../../src/vnet/DnsZone');
      return { DnsZone: mod.DnsZone };
    },
    ({ type, name }) =>
      type === ZONE ? { nameServers: [`ns1-${name}.azure-dns.com`, `ns2-${name}.azure-dns.com`] } : {},
  );

  const dnsZone = new DnsZone('example.com', {
    rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
    name: 'example.com',
    children: [{ name: 'sub' }],
  });
  await new Promise((resolve) => dnsZone.id.apply(resolve));
  await waitFor(() => captured.some((c) => c.type === RECORD_SET && c.inputs.recordType === 'NS'));

  return captured;
}

describe('DnsZone — children are delegated sub-zones (DRK-1821)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  // Deployed once: both scenarios read the same deployment, and a second one in this file would
  // either duplicate URNs or swap the mock monitor under the first component's pending outputs.
  let captured: Captured[];
  beforeAll(async () => {
    captured = await deployRootWithChild();
  }, 30000);
  afterAll(() => restoreStack(ORIGINAL_STACK));

  test("S6 — root 'example.com' with child 'sub': root zone is example.com, child zone is sub.example.com (R4)", async () => {
    const zones = Object.fromEntries(captured.filter((c) => c.type === ZONE).map((c) => [c.name, c.inputs.zoneName]));
    expect(zones).toEqual({ 'example.com': 'example.com', sub: 'sub.example.com' });
  });

  test("S7 — one NS record set in the root zone, relative name 'sub', nsRecords from the child's name servers (R5)", async () => {
    const nsRecordSets = captured.filter((c) => c.type === RECORD_SET && c.inputs.recordType === 'NS');
    expect(nsRecordSets).toHaveLength(1);
    expect(nsRecordSets[0].inputs.zoneName).toBe('example.com');
    expect(nsRecordSets[0].inputs.relativeRecordSetName).toBe('sub');
    expect(nsRecordSets[0].inputs.nsRecords).toEqual([
      { nsdname: 'ns1-sub.azure-dns.com' },
      { nsdname: 'ns2-sub.azure-dns.com' },
    ]);
  });
});
