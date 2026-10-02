import { withStack, restoreStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1922 — `prdGuard.warnPrdMissing` (acceptance tests, DRK-1986).
 *
 * Owner answer on DRK-1922: every capability is optional; "if deploying to PRD and not provided these
 * protection then just write out the warning message but not blocking the resources to be created."
 * In a prd stack the helper writes exactly one `pulumi.log.warn` naming the component type, the resource
 * name, the capability and the input to set; it never throws. Outside prd it writes nothing.
 *
 * `isPrd` is read once at module load, so every case reloads the helper under an explicit stack name
 * through `withStack`, and spies on the `pulumi.log.warn` of the same fresh `@pulumi/pulumi` copy.
 */

function load(stackName: string) {
  const { pulumi, helpers } = withStack(stackName, (p) => ({ pulumi: p, helpers: require('../../src/helpers') }));
  const warn = jest.spyOn(pulumi.log, 'warn').mockImplementation(() => undefined);
  return { warn, warnPrdMissing: helpers.prdGuard.warnPrdMissing as (...args: string[]) => void };
}

describe('prdGuard.warnPrdMissing — warn in prd, silent elsewhere, never throw', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('in prd it writes one warning naming the type, the resource name, the capability and the input', () => {
    const { warn, warnPrdMissing } = load('prd');

    warnPrdMissing('StorageAccount', 'stg-orders', 'Defender for Storage', 'defender.enabled');

    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('StorageAccount');
    expect(message).toContain('stg-orders');
    expect(message).toContain('Defender for Storage');
    expect(message).toContain('defender.enabled');
  });

  test('in prd it does not throw and returns nothing', () => {
    const { warnPrdMissing } = load('prd');

    let result: unknown = 'not called';
    expect(() => {
      result = warnPrdMissing('Vnet', 'hub', 'VNet flow logs', 'flowLog');
    }).not.toThrow();
    expect(result).toBeUndefined();
  });

  test.each(['dev', 'sandbox'])('in a %s stack it writes no warning', (stackName) => {
    const { warn, warnPrdMissing } = load(stackName);

    warnPrdMissing('AppConfig', 'appcfg', 'App Configuration replicas', 'replicaLocations');

    expect(warn).not.toHaveBeenCalled();
  });
});
