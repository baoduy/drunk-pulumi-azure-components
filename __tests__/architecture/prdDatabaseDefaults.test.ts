import { withStack, restoreStack } from '../testUtils/pulumiMocks';

/**
 * Architecture tests for the prd / non-prd defaults of the Flexible Server components
 * (MySql, Postgres), produced by the architecture review DRK-1812.
 *
 * `isPrd` is read once at module load, so every case reloads the component under an explicit
 * stack name through `withStack`. The args are a General Purpose server — not Burstable — because
 * Burstable skips the high-availability block entirely and would hide the HA defaults.
 */

type ServerKind = 'MySql' | 'Postgres';

const components: Record<ServerKind, { modulePath: string; serverType: string }> = {
  MySql: { modulePath: '../../src/database/MySql', serverType: 'azure-native:dbformysql:Server' },
  Postgres: { modulePath: '../../src/database/Postgres', serverType: 'azure-native:dbforpostgresql:Server' },
};

const generalPurposeArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
  administratorLogin: 'admin',
  version: '16',
  sku: { name: 'Standard_D2ds_v4', tier: 'GeneralPurpose' },
  enableAzureADAdmin: false,
  // Supplying this avoids the component creating its own UserAssignedIdentity child resource.
  defaultUAssignedId: { id: 'uid_id', clientId: 'c', objectId: 'o', resourceName: 'uid', resourceGroupName: 'rg' },
};

async function serverInputs(kind: ServerKind, stackName: string) {
  const { modulePath, serverType } = components[kind];
  const { pulumi, Component, captured } = withStack(stackName, (p) => ({
    pulumi: p,
    Component: require(modulePath)[kind],
  }));

  const db = new Component(`arch-${kind.toLowerCase()}`, { ...generalPurposeArgs } as any);
  await pulumi.output(db.id).promise();
  // Let the component's own registerOutputs() and fire-and-forget children settle before the next
  // `withStack` swaps the mock monitor out from under them.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return captured.find((c) => c.type === serverType)!.inputs;
}

describe('PULUMI-WAF-001 / PULUMI-WAF-002 — Flexible Server backup defaults follow the environment', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  /**
   * Tier 1 — both components pass today; this pins it. Production gets geo-redundant backup and
   * 30-day retention so a regional outage or a late-noticed corruption is recoverable; every
   * other environment gets local backup and 7 days so dev and sandbox do not pay for either.
   */
  test.each(Object.keys(components) as ServerKind[])(
    '%s: prd gets geo-redundant 30-day backup, dev gets local 7-day backup',
    async (kind) => {
      expect((await serverInputs(kind, 'prd')).backup).toEqual({
        geoRedundantBackup: 'Enabled',
        backupRetentionDays: 30,
      });
      expect((await serverInputs(kind, 'dev')).backup).toEqual({
        geoRedundantBackup: 'Disabled',
        backupRetentionDays: 7,
      });
    },
  );
});

describe('PULUMI-WAF-001 — prd zone-redundant HA puts the standby in a different zone from the primary', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  /**
   * Tier 2 (baseline). `ZoneRedundant` HA exists to survive the loss of one availability zone;
   * with the standby defaulted into the primary's zone, one zone outage takes both down while
   * the stack still pays for a zone-redundant standby.
   *
   * KNOWN_VIOLATIONS is today's offenders (DRK-1812 [A1812-5]) and MUST ONLY SHRINK. Fixing a
   * component deletes its entry; the second test enforces that.
   */
  const KNOWN_VIOLATIONS: ServerKind[] = [];

  const standbySharesPrimaryZone = async (kind: ServerKind) => {
    const inputs = await serverInputs(kind, 'prd');
    return (
      inputs.highAvailability?.mode === 'ZoneRedundant' &&
      inputs.highAvailability?.standbyAvailabilityZone !== undefined &&
      inputs.highAvailability.standbyAvailabilityZone === inputs.availabilityZone
    );
  };

  test('no component outside the allow-list defaults the standby into the primary zone', async () => {
    const offenders: ServerKind[] = [];
    for (const kind of Object.keys(components) as ServerKind[]) {
      if (!KNOWN_VIOLATIONS.includes(kind) && (await standbySharesPrimaryZone(kind))) offenders.push(kind);
    }

    expect(
      offenders.length === 0
        ? []
        : [
            'In prd these components default `highAvailability.standbyAvailabilityZone` to the same zone as ' +
              '`availabilityZone`, so zone-redundant HA cannot survive a zone outage. Default the standby to a ' +
              `different zone (or leave it unset for Azure to place). Offenders: ${offenders.join(', ')}`,
          ],
    ).toEqual([]);
  });

  test('the allow-list only shrinks — every listed component still violates', async () => {
    const fixed: ServerKind[] = [];
    for (const kind of KNOWN_VIOLATIONS) {
      if (!(await standbySharesPrimaryZone(kind))) fixed.push(kind);
    }

    expect(
      fixed.length === 0
        ? []
        : [
            'These components are on KNOWN_VIOLATIONS but no longer put the prd standby in the primary zone. ' +
              `Delete them from the list so the baseline keeps shrinking. Fixed: ${fixed.join(', ')}`,
          ],
    ).toEqual([]);
  });
});
