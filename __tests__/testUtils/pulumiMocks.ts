/**
 * Shared Pulumi test-mock plumbing (test infrastructure only — no production code lives here).
 *
 * `isPrd` (src/helpers/azureEnv.ts) is computed once at module load from the Pulumi stack name,
 * so a scenario that needs a specific prd/non-prd behaviour must reset the module registry and
 * reload the component fresh with that stack name set. `withStack` does exactly that; call it
 * with a loader that `require()`s whatever module you need — the fresh `require` call is what
 * makes the new stack name take effect.
 */

export type Captured = { type: string; name: string; inputs: any };

// Pulumi's wire envelope for a secret-marked value; a plain value would arrive as the bare string.
export const asSecret = (value: unknown) => ({
  '4dabf18193072939515e22adb298388d': '1b47061264138c4ac30d75fd1eb44270',
  value,
});

/**
 * Resets the module registry and points PULUMI_NODEJS_STACK at `stackName`, then runs `load`
 * (which must `require()` the pulumi module and the component(s) under test) and returns
 * whatever it returns, plus the array of resources captured by the mock `newResource` callback.
 * `extraCall` optionally answers a Pulumi invoke by token; return `undefined` to keep the default.
 */
export function withStack<T>(
  stackName: string,
  load: (pulumi: typeof import('@pulumi/pulumi')) => T,
  extraState?: (args: { type: string; name: string; inputs: any }) => object,
  extraCall?: (args: { token: string; inputs: any }) => object | undefined,
): T & { captured: Captured[] } {
  process.env.PULUMI_NODEJS_STACK = stackName;
  jest.resetModules();
  const pulumi: typeof import('@pulumi/pulumi') = require('@pulumi/pulumi');

  const captured: Captured[] = [];
  pulumi.runtime.setMocks({
    newResource: (args: any) => {
      captured.push({ type: args.type, name: args.name, inputs: args.inputs });
      return {
        id: `${args.name}_id`,
        state: {
          ...args.inputs,
          name: args.name,
          // Convenience defaults so components that unconditionally read these fields
          // (e.g. AzKubernetes reading `cluster.identity.principalId`) don't throw.
          identity: { principalId: `${args.name}_principal`, type: 'SystemAssigned' },
          ...extraState?.(args),
        },
      };
    },
    call: (args: any) => {
      // AKS's getExtraAksOutputs() fetches a client token through this Pulumi invoke.
      if (args.token === 'azure-native:authorization:getClientToken') return { token: 'mock-token' };
      // Optional per-test invoke answer (e.g. listStorageAccountKeys); falls through to the default when it returns undefined.
      return extraCall?.(args) ?? args.inputs;
    },
  });

  const result = load(pulumi);
  return Object.assign(result as object, { captured }) as T & { captured: Captured[] };
}

/** Awaits `id`, then drains the event loop so every pending child registration reaches the mocks. */
export async function settle(pulumi: typeof import('@pulumi/pulumi'), id: import('@pulumi/pulumi').Output<string>) {
  await pulumi.output(id).promise();
  for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));
}

/** Inputs of the one captured resource with this type and name; fails the test on zero or several. */
export function registrationOf(captured: Captured[], type: string, name: string) {
  const found = captured.filter((c) => c.type === type && c.name === name);
  expect(found).toHaveLength(1);
  return found[0].inputs;
}

/** Silences `console.log` per test and restores PULUMI_NODEJS_STACK afterwards; call inside `describe`. */
export function quietStackHooks() {
  const originalStack = process.env.PULUMI_NODEJS_STACK;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logSpy.mockRestore();
    restoreStack(originalStack);
  });
}

/** Restore PULUMI_NODEJS_STACK to whatever it was before the test file overrode it. */
export function restoreStack(original: string | undefined) {
  if (original === undefined) delete process.env.PULUMI_NODEJS_STACK;
  else process.env.PULUMI_NODEJS_STACK = original;
}

/**
 * AzKubernetes.getExtraAksOutputs() always makes a real `fetch()` call to the Azure management
 * API (unrelated to this cycle's changes). Stub it so instantiating AzKubernetes in a test
 * doesn't attempt real network I/O. Returns a restore function to run in `afterEach`/`afterAll`.
 */
export function mockAksFetch(): () => void {
  const original = global.fetch;
  global.fetch = (async () => ({
    ok: true,
    json: async () => ({
      properties: {
        identityProfile: {
          kubeletidentity: { resourceId: 'kubelet_id', clientId: 'kubelet_client', objectId: 'kubelet_object' },
        },
      },
    }),
  })) as unknown as typeof fetch;
  return () => {
    global.fetch = original;
  };
}
