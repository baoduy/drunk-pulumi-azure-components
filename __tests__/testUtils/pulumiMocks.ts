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

/**
 * The Pulumi mock monitor every harness here installs: records each new resource into `sink()`, echoes its
 * inputs back as state (plus `extraState`), and answers invokes (`extraCall` first, then the defaults).
 */
export function mockMonitor(
  sink: () => Captured[],
  extraState?: (args: { type: string; name: string; inputs: any }) => object,
  extraCall?: (args: { token: string; inputs: any }) => object | undefined,
) {
  return {
    newResource: (args: any) => {
      sink().push({ type: args.type, name: args.name, inputs: args.inputs });
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
  };
}

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
  pulumi.runtime.setMocks(mockMonitor(() => captured, extraState, extraCall));

  const result = load(pulumi);
  return Object.assign(result as object, { captured }) as T & { captured: Captured[] };
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

/**
 * AzKubernetes test harness for files that load the component once (no `withStack`): stubs `fetch` for the
 * file and installs the mock monitor on `pulumi`. Call it before importing AzKubernetes. `extraState` adds
 * cluster state some feature flags read (e.g. `addonProfiles`, `oidcIssuerProfile`).
 */
export function useAksMocks(pulumi: typeof import('@pulumi/pulumi'), sink: () => Captured[], extraState: object = {}) {
  let restoreFetch: () => void;
  beforeAll(() => {
    restoreFetch = mockAksFetch();
  });
  afterAll(() => restoreFetch());
  pulumi.runtime.setMocks(mockMonitor(sink, () => extraState));
}

/**
 * Returns `createCluster(props)`: deploys `AzKubernetes` with `{ ...baseArgs, ...props }`, drains its outputs and
 * returns the captured ManagedCluster.
 */
export function aksClusterFactory(
  pulumi: typeof import('@pulumi/pulumi'),
  AzKubernetes: new (name: string, args: any) => any,
  baseArgs: object,
  sink: () => Captured[],
) {
  return async (props: any): Promise<Captured> => {
    const aks = new AzKubernetes('cluster1', { ...baseArgs, ...props });
    await pulumi.output(aks.id).promise();
    // Drains the always-created kubeletIdentity/systemIdentityId outputs so their pending
    // getExtraAksOutputs() fetch chain resolves inside the test instead of after teardown.
    if (aks.kubeletIdentity) await pulumi.output(aks.kubeletIdentity).promise();
    if (aks.systemIdentityId) await pulumi.output(aks.systemIdentityId).promise();
    return sink().find((c) => c.type === 'azure-native:containerservice:ManagedCluster')!;
  };
}
