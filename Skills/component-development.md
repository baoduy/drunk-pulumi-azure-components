# Component Development Skill

This skill helps you develop new Azure components for the Drunk Pulumi Azure Components library.

## Skill Purpose

Guide developers through creating high-quality, reusable Azure infrastructure components that follow project conventions and best practices.

## When to Use This Skill

- Creating a new Azure resource component
- Adding a new category of infrastructure resources
- Extending existing components with new functionality
- Converting raw Pulumi Azure Native resources into reusable components

## Prerequisites

Before creating a new component, ensure you:

1. Understand the Azure resource you're wrapping
2. Know the category (aks, app, azAd, vault, vnet, database, etc.)
3. Have identified required and optional configuration parameters
4. Reviewed similar existing components for patterns

## Component Development Process

### Step 1: Define the Component Interface

Create a strongly-typed interface for your component arguments:

```typescript
import * as types from '../types';
import { CommonBaseArgs } from '../base/BaseResourceComponent';

/**
 * Arguments for creating an Azure [ResourceName]
 */
export interface [ResourceName]Args extends CommonBaseArgs {
  /**
   * The pricing tier for the resource
   * @default 'Standard'
   */
  tier?: 'Basic' | 'Standard' | 'Premium';
  
  /**
   * Enable advanced features
   * @default false
   */
  enableAdvancedFeatures?: boolean;
  
  // Add other resource-specific properties
  // Always use TSDoc comments for documentation
}
```

**Best Practices:**
- Extend `CommonBaseArgs` or `BaseArgs` to inherit standard properties
- Use union types for enumerated values instead of strings
- Provide sensible defaults with `@default` JSDoc tags
- Document each property with clear descriptions
- Use optional properties (`?`) for non-required fields

### Step 2: Implement the Component Class

```typescript
import * as pulumi from '@pulumi/pulumi';
import * as azureNative from '@pulumi/azure-native';
import { BaseResourceComponent } from '../base/BaseResourceComponent';

/**
 * Component for managing Azure [ResourceName]
 * 
 * This component wraps the Azure [ResourceName] resource and provides
 * integration with Key Vault, managed identities, and resource groups.
 */
export class [ResourceName] extends BaseResourceComponent<[ResourceName]Args> {
  // Public outputs
  public readonly id: pulumi.Output<string>;
  public readonly name: pulumi.Output<string>;
  public readonly endpoint?: pulumi.Output<string>;
  
  // Private resources (not exposed)
  private readonly resource: azureNative.[service].[ResourceType];
  
  constructor(
    name: string,
    args: [ResourceName]Args,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('[ResourceName]', name, args, opts);
    
    // Step 1: Validate arguments
    this.validateArgs(args);
    
    // Step 2: Build resource name (deterministic, no random suffixes)
    const resourceName = this.buildResourceName(name, args);
    
    // Step 3: Create the Azure Native resource
    this.resource = new azureNative.[service].[ResourceType](
      resourceName,
      {
        resourceGroupName: args.group.resourceGroupName,
        location: args.group.location,
        // Map arguments to Azure resource properties
        sku: {
          name: args.tier || 'Standard',
        },
        // ... other properties
      },
      { parent: this, ...opts }
    );
    
    // Step 4: Assign public outputs
    this.id = this.resource.id;
    this.name = this.resource.name;
    
    // Step 5: Optional - Store secrets in Key Vault
    if (args.vaultInfo) {
      this.storeSecretsInVault(args);
    }
    
    // Step 6: Optional - Assign managed identity permissions
    if (args.groupRoles) {
      this.assignRoles(args);
    }
    
    // Step 7: Register outputs (MANDATORY)
    this.registerOutputs({
      id: this.id,
      name: this.name,
      endpoint: this.endpoint,
    });
  }
  
  private validateArgs(args: [ResourceName]Args): void {
    if (!args.group) {
      throw new Error('[ResourceName] requires a resource group');
    }
    // Add other validation logic
  }
  
  private buildResourceName(name: string, args: [ResourceName]Args): string {
    // Create deterministic names
    // Use existing helpers from base/helpers or common/helpers
    return name; // Simplified
  }
  
  private storeSecretsInVault(args: [ResourceName]Args): void {
    // Store sensitive outputs in Key Vault
    // Use VaultSecrets helper
  }
  
  private assignRoles(args: [ResourceName]Args): void {
    // Assign managed identity roles using RoleAssignment
  }
}
```

**Key Patterns:**
1. Always call `super()` with component type, name, args, and opts
2. Validate arguments early - fail fast with clear error messages
3. Create Azure resources with `{ parent: this }` to establish hierarchy
4. Keep constructor logic focused - delegate to private methods
5. Only expose necessary outputs as public properties
6. Always call `registerOutputs()` at the end

### Step 3: Add Type Definitions (if needed)

If your component introduces new shared types, add them to `types.ts`:

```typescript
// In src/types.ts
export interface With[Feature]Args {
  [feature]?: {
    enabled: boolean;
    configuration?: Record<string, unknown>;
  };
}
```

### Step 4: Create Index Barrel Export

Update or create `index.ts` in your category folder:

```typescript
export * from './[ResourceName]';
export * from './types'; // if category-specific types exist
```

### Step 5: Add Component to Main Index

Update `src/index.ts` to export your new component:

```typescript
export * from './[category]/[ResourceName]';
```

## Testing Your Component

### Unit Test Structure

Create a test file in `__tests__/[category]/[ResourceName].test.ts`:

```typescript
import { [ResourceName] } from '../../src/[category]/[ResourceName]';

describe('[ResourceName]', () => {
  test('creates component with required args', () => {
    const component = new [ResourceName]('test-resource', {
      group: {
        resourceGroupName: 'test-rg',
        location: 'eastus',
      },
      tier: 'Standard',
    });
    
    expect(component).toBeDefined();
    expect(component.id).toBeDefined();
    expect(component.name).toBeDefined();
  });
  
  test('validates required arguments', () => {
    expect(() => {
      new [ResourceName]('test-resource', {} as any);
    }).toThrow();
  });
  
  test('uses default values', () => {
    const component = new [ResourceName]('test-resource', {
      group: {
        resourceGroupName: 'test-rg',
        location: 'eastus',
      },
    });
    
    // Verify defaults are applied
    expect(component).toBeDefined();
  });
});
```

### Validation Commands

```bash
# Type check
npx tsc --noEmit

# Run tests
pnpm run test

# Build
pnpm run build
```

## Common Patterns by Category

### AKS Components
- Compose CommonBaseArgs with encryption/identity mixins
- Sequence: identity → cluster → agent pools → configs → permissions
- Use zone helpers for availability zones
- Private clusters need DNS zone derivation

### Storage Components
- Support CMK encryption via getEncryptionKey
- Network rules: flip to Deny when rules present
- Export keys to Key Vault using listStorageAccountKeysOutput
- Sub-resources get lowercase names and deletedWith parent

### VNet Components
- Pre-create supporting resources (NSG, Route, NAT)
- Build subnet array with feature-driven entries
- Create VirtualNetwork with empty subnets + ignoreChanges
- Individual Subnet resources with conditional attachments
- Feature components consume subnet outputs

### Database Components
- Always support managed identity authentication
- Firewall rules for known IPs/VNets
- Admin credentials stored in Key Vault automatically
- Enable auditing and threat detection by default

## Naming Conventions

1. **Class Names**: PascalCase (e.g., `StorageAccount`, `AzKubernetes`)
2. **File Names**: PascalCase.ts matching class name
3. **Resource Names**: kebab-case, deterministic
4. **Variables**: camelCase
5. **Constants**: UPPER_SNAKE_CASE or camelCase for configs

## Documentation Standards

### TSDoc Comments

```typescript
/**
 * Brief description of the class/method
 * 
 * Detailed explanation of functionality, behavior, and usage.
 * Include examples if the API is complex.
 * 
 * @param name - Description of parameter
 * @returns Description of return value
 * @throws Error conditions
 * 
 * @example
 * ```typescript
 * const resource = new MyResource('my-resource', {
 *   tier: 'Standard',
 * });
 * ```
 */
```

## Anti-Patterns to Avoid

❌ **Don't:**
- Use `any` type - always define proper interfaces
- Skip `registerOutputs()` call
- Add randomness to resource names arbitrarily
- Expose internal Azure Native resources directly
- Hardcode secrets or sensitive values
- Create heavyweight constructors with complex logic
- Duplicate type definitions from `types.ts`
- Forget to set `{ parent: this }` on child resources

✅ **Do:**
- Use strong typing throughout
- Keep constructors thin and focused
- Delegate complexity to private methods
- Follow existing component patterns
- Document all public APIs
- Validate arguments early
- Use deterministic naming
- Leverage Key Vault for secrets

## Integration with ResourceBuilder

If your component should be available through ResourceBuilder:

1. Add args to `ResourceBuilder.ts` interface
2. Add conditional instantiation in constructor
3. Expose outputs via `getOutputs()`
4. Update builder documentation
5. Add tests for builder integration

```typescript
// In ResourceBuilder.ts
export interface ResourceBuilderArgs {
  [yourResource]?: [ResourceName]Args;
}

// In constructor
if (args.[yourResource]) {
  this.[yourResource] = new [ResourceName](
    `${this.name}-[resource]`,
    args.[yourResource],
    { parent: this }
  );
  outputs.[yourResource]Id = this.[yourResource].id;
}
```

## Checklist Before PR

- [ ] Interface defined with TSDoc comments
- [ ] Class extends BaseResourceComponent or BaseComponent
- [ ] Arguments validated in constructor
- [ ] Azure resources created with parent relationship
- [ ] Public outputs defined and assigned
- [ ] `registerOutputs()` called
- [ ] Unit tests added
- [ ] Type checks pass (`npx tsc --noEmit`)
- [ ] Tests pass (`pnpm run test`)
- [ ] Build succeeds (`pnpm run build`)
- [ ] Documentation updated if needed
- [ ] No secrets in code

## Additional Resources

- Review existing components in the same category
- Check `base/BaseResourceComponent.ts` for inherited functionality
- Consult `types.ts` for reusable interfaces
- See `pulumi-test/` for usage examples
- Read `.github/copilot-instructions.md` for detailed patterns

## Questions?

When uncertain about implementation:
1. Find the most similar existing component
2. Follow its structure and patterns
3. Adapt to your specific Azure resource needs
4. Maintain consistency with project style
