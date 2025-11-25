# Supplementary Copilot Guidelines

This file augments `.github/copilot-instructions.md` providing tighter examples & patterns for inline completions.

## Patterns

### 1. New Component

```ts
interface MyServiceArgs {
  tier: 'basic' | 'standard';
  location?: string;
}
class MyService extends BaseResourceComponent<MyServiceArgs> {
  public readonly id: pulumi.Output<string>;
  constructor(name: string, args: MyServiceArgs, opts?: pulumi.ComponentResourceOptions) {
    super('MyService', name, args, opts);
    if (!args.tier) throw new Error('tier required');
    const svc = new azureNative.some.Service(name, {
      /* map args */
    });
    this.id = svc.id;
    this.registerOutputs({ id: this.id });
  }
}
```

### 2. ResourceBuilder Extension

```ts
// types.ts additions
export interface ResourceBuilderArgs {
  myService?: MyServiceArgs;
}

// ResourceBuilder.ts
if (args.myService) {
  this.myService = new MyService(this.name + '-mysvc', args.myService);
  outputs.myServiceId = this.myService.id;
}
```

### 3. Discriminated Union Replacement

```ts
// BEFORE: flags
interface CacheArgs {
  enableRedis?: boolean;
  enableMem?: boolean;
}
// AFTER: union
interface RedisCacheArgs {
  type: 'redis';
  sku: 'basic' | 'standard';
}
interface MemCacheArgs {
  type: 'mem';
  sizeMb: number;
}
type CacheArgs = RedisCacheArgs | MemCacheArgs;
```

## Category-Specific Patterns

### AKS (`AzKubernetes`)

- Args compose: CommonBaseArgs + encryption/user identity/group roles/disk encrypt mixins.
- Sequence: identity -> cluster -> extra agent pools -> maintenance configs -> permissions -> namespaces -> private DNS.
- Use `zoneHelper.getDefaultZones` to normalize zone arrays.
- Expose dictionary of namespaces via `rsHelpers.dictReduce`.
- Private cluster: derive DNS zone from `privateFQDN` and expose as simple `{ id, resourceName }`.

### Storage (`StorageAccount`)

- Optional CMK encryption via `getEncryptionKey`; fallback infra encryption block.
- Network rules: defaultAction flips to Deny when ipRules or vnetRules present.
- Static website + optional CDN (AzCdn) conditional on `policies.staticWebsite.enabled`.
- Keys exported to Key Vault using `listStorageAccountKeysOutput` + reduction into `VaultSecrets`.
- Sub-resources (containers/queues/shares) created with lowercase names and `deletedWith` parent.

### VNet (`Vnet`)

- Pre-create supporting infra (NSG, RouteTable, Public IPs, NatGateway) before VirtualNetwork.
- Augment subnets array with feature-driven entries (firewall, bastion, gateway) prior to provisioning.
- VirtualNetwork created with empty `subnets` and `ignoreChanges` for post provisioning updates.
- Individual `Subnet` resources configured with conditional attachments (NSG/Route/Nat) and deterministic names.
- Feature components (Firewall/Basion/VpnGateway) consume subnet outputs.
- Private DNS zone links via `VirtualNetworkLink` with registration disabled.

## Naming Helpers

Use existing helpers in `base/helpers` or create a small pure function returning deterministic names; never embed randomness unless required.

## Testing Template

```ts
import { MyService } from '../src/app/MyService';

test('MyService exposes id', () => {
  const svc = new MyService('unit-mysvc', { tier: 'basic' });
  expect(svc.getOutputs()).toHaveProperty('id');
});
```

## Anti-Patterns

- Repeating type definitions already present in `types.ts`
- Omitting `registerOutputs`
- Returning raw provider resources from component public API
- Using `any` or broad `Record<string, unknown>` instead of explicit interfaces

## Quick Checklist (Inline Prompt)

1. Args interface defined & documented
2. Validation early & explicit error messages
3. Provider resource creation isolated
4. Outputs assigned (id/name) and registered
5. Test added or updated
6. Types compile (`npx tsc --noEmit`)
7. Build passes (`pnpm run build`)

## Reference Commands

```sh
npx tsc --noEmit
pnpm run test
pnpm run build
```

---

When in doubt, open analogous component and mirror style.
