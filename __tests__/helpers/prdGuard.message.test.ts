import { withStack, restoreStack } from '../testUtils/pulumiMocks';

// DRK-1922 Build addition: pins the exact prd advisory text the ATs only check by fragment.
describe('prdGuard.warnPrdMissing — message text', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('in prd the warning names the type, the resource, the capability and the input to set', () => {
    const { pulumi, helpers } = withStack('prd', (p) => ({ pulumi: p, helpers: require('../../src/helpers') }));
    const warn = jest.spyOn(pulumi.log, 'warn').mockImplementation(() => undefined);

    helpers.prdGuard.warnPrdMissing('StorageAccount', 'stg-orders', 'Defender for Storage', 'defender.enabled');

    expect(warn).toHaveBeenCalledWith(
      "StorageAccount 'stg-orders' has no Defender for Storage in prd. Set `defender.enabled` to turn it on.",
    );
  });
});
