import { withStack } from './pulumiMocks';

/**
 * Shared harness for the Flexible Server components (MySql, Postgres).
 *
 * `isPrd` is read once at module load, so every call reloads the component under an explicit
 * stack name through `withStack`. The default args are a General Purpose server — not Burstable —
 * because Burstable skips the high-availability block entirely and would hide the HA defaults.
 */

export type ServerKind = 'MySql' | 'Postgres';

export const components: Record<ServerKind, { modulePath: string; serverType: string }> = {
  MySql: { modulePath: '../../src/database/MySql', serverType: 'azure-native:dbformysql:Server' },
  Postgres: { modulePath: '../../src/database/Postgres', serverType: 'azure-native:dbforpostgresql:Server' },
};

export const generalPurposeArgs = {
  rsGroup: { resourceGroupName: 'rg', location: 'eastus' },
  administratorLogin: 'admin',
  version: '16',
  sku: { name: 'Standard_D2ds_v4', tier: 'GeneralPurpose' },
  enableAzureADAdmin: false,
  // Supplying this avoids the component creating its own UserAssignedIdentity child resource.
  defaultUAssignedId: { id: 'uid_id', clientId: 'c', objectId: 'o', resourceName: 'uid', resourceGroupName: 'rg' },
};

/** Creates the component under `stackName` with `props` over the General Purpose args; returns the captured Server inputs. */
export async function serverInputs(kind: ServerKind, stackName: string, props: object = {}) {
  const { modulePath, serverType } = components[kind];
  const { pulumi, Component, captured } = withStack(stackName, (p) => ({
    pulumi: p,
    // modulePath is relative to a test file one level under __tests__/, as is this file.
    Component: require(modulePath)[kind],
  }));

  const db = new Component(`arch-${kind.toLowerCase()}`, { ...generalPurposeArgs, ...props } as any);
  await pulumi.output(db.id).promise();
  // Let the component's own registerOutputs() and fire-and-forget children settle before the next
  // `withStack` swaps the mock monitor out from under them.
  await new Promise((resolve) => setTimeout(resolve, 50));
  return captured.find((c) => c.type === serverType)!.inputs;
}
