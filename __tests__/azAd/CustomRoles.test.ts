import { withStack, restoreStack } from '../testUtils/pulumiMocks';

/**
 * DRK-1047 / PULUMI-PKG-002 — CustomRoles must call `registerOutputs()` as the last
 * constructor statement regardless of whether the optional just-in-time role gets
 * created, so the Pulumi engine always sees the component as complete.
 */
// Pulumi's own ComponentResource base class also calls `registerOutputs()` itself,
// asynchronously, once `initialize()` resolves — as a safety net for components that never
// call it explicitly. That auto-call is a guarded no-op if the component already registered
// (real engine registration doesn't repeat), but a spy still counts it. So "the constructor
// calls registerOutputs()" must be asserted synchronously, right after `new CustomRoles(...)`
// and before any await — the one call this cycle's fix actually adds is the synchronous one;
// waiting a tick would let the SDK's own delayed auto-call land first and hide a regression.
//
// RoleDefinition registration itself goes through Pulumi's mocked resource-monitor RPC, which
// resolves on a later tick — give it one tick to settle before asserting on `captured` (mirrors
// __tests__/storage/StorageAccount.test.ts).
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe('CustomRoles — registerOutputs (PULUMI-PKG-002)', () => {
  const ORIGINAL_STACK = process.env.PULUMI_NODEJS_STACK;
  afterEach(() => restoreStack(ORIGINAL_STACK));

  test('registers outputs once when no just-in-time role is requested', () => {
    const { pulumi, CustomRoles, captured } = withStack('dev', (p) => {
      const mod: typeof import('../../src/azAd/CustomRoles') = require('../../src/azAd/CustomRoles');
      return { pulumi: p, CustomRoles: mod.CustomRoles };
    });
    const spy = jest.spyOn(pulumi.ComponentResource.prototype, 'registerOutputs');

    const roles = new CustomRoles('roles1', {});

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.instances[0]).toBe(roles);
    expect(spy.mock.calls[0][0]).toEqual({});
    expect(captured).toHaveLength(0);
    expect(roles.getOutputs()).toEqual({});

    spy.mockRestore();
  });

  test('registers outputs once and creates the just-in-time role when requested', async () => {
    const { pulumi, CustomRoles, captured } = withStack('dev', (p) => {
      const mod: typeof import('../../src/azAd/CustomRoles') = require('../../src/azAd/CustomRoles');
      return { pulumi: p, CustomRoles: mod.CustomRoles };
    });
    const spy = jest.spyOn(pulumi.ComponentResource.prototype, 'registerOutputs');

    const roles = new CustomRoles('roles2', { enableJustInTimeRemoteRole: true });
    expect(spy).toHaveBeenCalledTimes(1);

    await settle();
    const roleDefinitions = captured.filter((c) => c.type === 'azure-native:authorization:RoleDefinition');
    expect(roleDefinitions).toHaveLength(1);
    expect(roleDefinitions[0].inputs.roleName).toBe('Just-In-Time-User-Remote-Request-Role');

    spy.mockRestore();
  });
});
