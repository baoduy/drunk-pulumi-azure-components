import * as pulumi from '@pulumi/pulumi';

/**
 * Captures the real parent chain of every Pulumi resource created during a test.
 *
 * Neither `pulumi.runtime.setMocks`'s `newResource` callback nor a component's public outputs
 * expose `opts.parent` — a child resource that a component doesn't stash on `this` (e.g.
 * `VaultSecret`'s internal `VaultSecretResource`) is otherwise unreachable from a test. The only
 * place the resolved parent is threaded through is pulumi's internal
 * `registerResource(res, parent, ...)`, so this monkey-patches it.
 *
 * Patches the object `require` returns, not a `ts import * as` copy — pulumi's own `resource.ts`
 * calls `resource_1.registerResource(...)` against that exact cached module object, so mutating
 * its property is what actually intercepts the real call.
 */
export type RegisteredResource = {
  res: pulumi.Resource;
  parent?: pulumi.Resource;
  type: string;
  name: string;
  props: pulumi.Inputs;
  opts: pulumi.ResourceOptions;
};

export function captureResourceParents() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const runtimeResource = require('@pulumi/pulumi/runtime/resource');
  const original = runtimeResource.registerResource;
  const captured: RegisteredResource[] = [];

  runtimeResource.registerResource = function (
    res: pulumi.Resource,
    parent: pulumi.Resource | undefined,
    t: string,
    name: string,
    ...rest: [boolean, boolean, unknown, pulumi.Inputs, pulumi.ResourceOptions, ...unknown[]]
  ) {
    captured.push({ res, parent, type: t, name, props: rest[3], opts: rest[4] });
    return original.call(this, res, parent, t, name, ...rest);
  };

  return {
    captured,
    restore: () => {
      runtimeResource.registerResource = original;
    },
  };
}
