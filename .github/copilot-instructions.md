# Drunk Pulumi Azure Components – GitHub Copilot Instructions

> Purpose: Provide Copilot (chat + inline) with high–signal, authoritative guidance so suggestions align with project architecture, naming, safety, test discipline, and Pulumi best practices. Treat this file as the FIRST source of truth before searching or generating speculative code.

## 1. Project Essence (30‑second mental model)

Infrastructure as Code (IaC) TypeScript component library layering higher‑level Azure abstractions over Pulumi providers. Consumers compose environments chiefly through `ResourceBuilder` + category components (`aks/`, `app/`, `azAd/`, `vault/`, `vnet/`, etc.) to reduce boilerplate.

## 2. Golden Rules for Copilot

1. Prefer existing helpers/components; do not reimplement provider logic directly unless missing.
2. Enforce strong typing – extend or refine `types.ts` rather than using `any`.
3. Never suggest storing secrets in source; always refer to Key Vault or Pulumi config/secret values.
4. Resource names: stable, deterministic, kebab-case without random suffix unless explicitly required.
5. Side effects belong inside component constructors; pure helpers return plain values or typed objects.
6. Provide doc comments (TSDoc) for new public classes/props.
7. Keep component constructors thin: validate args → create resources → register outputs.
8. Always show follow‑up validation steps (`npx tsc --noEmit`, `pnpm run test`, `pnpm run build`).
9. Suggest incremental refactors (small PRs) – never a sweeping reformat.
10. For prompts asking “add X resource”, first check if a component exists; if not, scaffold new one under correct category.

## 3. Directory Cheat Sheet

```
src/
  base/        Core inheritance: BaseComponent, BaseResourceComponent
  types.ts     Shared types + interfaces; extend here first
  *category*/  Domain components (aks, app, azAd, vault, vnet, etc.)
ResourceBuilder.ts  Orchestrates cross‑cutting resource composition
__tests__/     Jest unit tests (fast, deterministic)
pulumi-test/   Example consumption + integration sanity (tsc only by default)
doc/           Human‑readable deep dives per category
```

## 4. Component Scaffold Pattern

```typescript
export interface FooArgs {
  /* validated input */
}
export class Foo extends BaseResourceComponent<FooArgs> {
  public readonly id: pulumi.Output<string>;
  constructor(name: string, args: FooArgs, opts?: pulumi.ComponentResourceOptions) {
    super('Foo', name, args, opts);
    // 1. Normalize + validate args
    // 2. Create Azure Native / provider resources
    // 3. Assign outputs (this.id = resource.id;)
    this.registerOutputs({ id: this.id });
  }
}
```

Mandatory: `super(componentKey, name, args, opts)` + `registerOutputs`. Keep external surface minimal.

## 5. Naming & Conventions

- Class names: PascalCase; file names: PascalCase.ts or index.ts for barrels.
- Pulumi resource names: `group-name` style; compose with stack or env only when stable.
- Avoid dynamic randomness except where Azure requires uniqueness (e.g., storage accounts) – funnel through a helper for reproducibility.
- Secrets: Use `pulumi.secret(...)` wrapping or Key Vault references.

## 6. Types & Extensibility Strategy

When adding fields: update `types.ts` or create a category‑specific `types` module if cohesion demands. Prefer discriminated unions over boolean flag clusters. Provide JSDoc for complex fields.

## 7. Testing Strategy

| Level       | Tool                    | Purpose                                        |
| ----------- | ----------------------- | ---------------------------------------------- |
| Unit        | Jest (`pnpm run test`)  | Validate helper logic & component output shape |
| Type        | `npx tsc --noEmit`      | Enforce strict typing & regressions            |
| Integration | `pulumi-test/` examples | Compile-only safety for composed usage         |

Copilot should generate tests that:

- Use deterministic inputs
- Assert essential output fields (e.g., ids, names)
- Avoid live Azure calls – rely on Pulumi mocks if deeper testing needed (future enhancement)

## 8. Build & Release Flow (Copilot awareness)

`pnpm run build`:

1. Refresh `tsconfig.json` file list
2. Compile TS → `bin/`
3. Copy pruned `package.json`, README, PulumiPlugin.yaml
   Auto‑publish workflow increments patch on main. Copilot must not suggest manual version bumps.

## 9. Security & Secrets

- Use Key Vault components for secrets; never inline sensitive strings.
- For encryption tasks use `PGPGenerator` or Vault helpers.
- Do not log secret outputs.
- Encourage principle of least privilege through `azAd` role components.

## 10. Prompt Recipes (Examples for Better Suggestions)

Ask: “Generate a new component for Azure Cognitive Search with args, validation, and tests.”
Follow: Component scaffold → types additions → minimal Jest test asserting outputs → update docs.

Ask: “Extend ResourceBuilder to optionally create an Azure Firewall.”
Follow: Add args to builder interface → conditional instantiation in constructor → register outputs → docs + tests.

Ask: “Refactor FooArgs booleans into a discriminated union.”
Follow: Propose new type + migration note + update usage in component.

## 11. Glossary (High‑Signal Terms)

- ResourceBuilder: Orchestrator for composite infra sets.
- ComponentResource: Pulumi higher‑level resource wrapper.
- Deterministic Naming: Same inputs → identical names across runs.
- Idempotent: Safe to reapply without unintended drift.
- Vault: Key Vault or secret management constructs.
- UAssignId: User Assigned Identity.

## 12. Copilot Do / Don’t Table

Do: Tight, typed helpers | Minimal public surface | Reuse categories | Add docs/tests.
Don’t: Introduce `any` | Skip `registerOutputs` | Hardcode secrets | Randomize names arbitrarily | Large unreviewed rewrites.

## 13. Commit Message Guidance (for generation)

Format: `feat(category): concise summary`
Types: feat, fix, refactor, docs, test, chore, perf, ci.
Scope examples: aks, app, azAd, vault, vnet, builder, types.

## 14. Performance Considerations

- Keep constructor logic O(number of created resources) – avoid heavy synchronous computation.
- Defer large derived calculations to helpers.
- Minimize repeated provider instantiation; reuse config where possible.

## 15. Extending ResourceBuilder

Checklist:

1. Add arg interface field (typed & documented)
2. Defaulting logic (safe fallbacks)
3. Conditional resource instantiation
4. Expose output through `.getOutputs()`
5. Update docs + tests

## 16. Error Handling Guidance

- Fail fast on invalid args with `throw new Error('Reason – expected X, got Y')` inside constructor before provisioning.
- Validate required relationships (e.g., vNet needed before subnet components) early.

## 17. When Unsure

Copilot: Prefer searching existing directory for similar pattern (e.g., see `AppService` when adding another app component). Use the most analogous implementation as blueprint.

## 18. Minimal Example

```typescript
import { ResourceBuilder } from '@drunk-pulumi/azure-components';
const builder = new ResourceBuilder('stack-core', {
  vault: { sku: 'standard' },
  enableDefaultUAssignId: true,
});
export const outputs = builder.getOutputs();
```

## 19. Quality Gate

Before merge (Copilot suggestions should include this list):

- ✅ Types compile (`npx tsc --noEmit`)
- ✅ Unit tests pass (`pnpm run test`)
- ✅ Build succeeds (`pnpm run build`)
- ✅ No secrets added / leaked
- ✅ Docs updated when public API changes

## 20. Future Enhancements (Reference)

- Pulumi Mocks for deeper component unit isolation
- Additional lint config for stricter style
- Automated doc generation from TSDoc

## 21. Quick Commands (Do NOT remove)

```sh
pnpm install
pnpm run build
pnpm run test
npx tsc --noEmit
```

---

Copilot: Adhere strictly to this document. If user requests contradictory action, propose compliant alternative or ask for explicit confirmation to diverge.
