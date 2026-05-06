# Testing & Validation Skill

This skill guides you through testing and validating Drunk Pulumi Azure Components.

## Skill Purpose

Ensure component quality through comprehensive testing strategies including unit tests, type validation, build verification, and integration testing.

## When to Use This Skill

- Writing tests for new components
- Validating component changes
- Debugging test failures
- Setting up test infrastructure
- Ensuring code quality before PR

## Testing Philosophy

The project uses a multi-layered testing approach:

1. **Type Safety** - TypeScript compiler catches type errors
2. **Unit Tests** - Jest validates component behavior
3. **Build Tests** - Compilation ensures distribution readiness
4. **Integration Tests** - Example stacks verify real-world usage

## Testing Layers

### Layer 1: Type Checking (Fastest)

TypeScript provides the first line of defense against errors.

```bash
# Run type checker
npx tsc --noEmit

# This checks:
# - Type correctness
# - Interface compliance
# - Missing properties
# - Invalid assignments
```

**When to use:**
- After any code change
- Before committing
- As part of CI/CD
- Continuously in IDE

**What it catches:**
```typescript
// Type error - missing required property
const component = new MyComponent('test', {
  // Error: Property 'group' is missing
});

// Type error - wrong type
const component = new MyComponent('test', {
  group: 'wrong-type', // Error: Expected ResourceGroupInfo
});

// Type error - invalid enum value
const component = new MyComponent('test', {
  tier: 'invalid', // Error: Type '"invalid"' is not assignable to type '"Basic" | "Standard"'
});
```

### Layer 2: Unit Testing (Fast)

Unit tests validate component behavior in isolation using Jest.

#### Test File Structure

```typescript
// __tests__/[category]/[ComponentName].test.ts
import { [ComponentName] } from '../../src/[category]/[ComponentName]';
import * as pulumi from '@pulumi/pulumi';

// Mock Pulumi runtime for testing
pulumi.runtime.setMocks({
  newResource: (args: pulumi.runtime.MockResourceArgs): { id: string; state: any } => {
    return {
      id: args.name + '_id',
      state: args.inputs,
    };
  },
  call: (args: pulumi.runtime.MockCallArgs) => {
    return args.inputs;
  },
});

describe('[ComponentName]', () => {
  // Test basic instantiation
  test('creates component successfully', () => {
    const component = new [ComponentName]('test-component', {
      group: {
        resourceGroupName: 'test-rg',
        location: 'eastus',
      },
      // Required args
    });
    
    expect(component).toBeDefined();
  });
  
  // Test required outputs
  test('exposes required outputs', () => {
    const component = new [ComponentName]('test-component', {
      group: {
        resourceGroupName: 'test-rg',
        location: 'eastus',
      },
    });
    
    expect(component.id).toBeDefined();
    expect(component.name).toBeDefined();
  });
  
  // Test argument validation
  test('throws error for missing required args', () => {
    expect(() => {
      new [ComponentName]('test-component', {} as any);
    }).toThrow();
  });
  
  // Test default values
  test('applies default values', () => {
    const component = new [ComponentName]('test-component', {
      group: {
        resourceGroupName: 'test-rg',
        location: 'eastus',
      },
    });
    
    // Assert defaults are applied
    expect(component).toBeDefined();
  });
  
  // Test optional features
  test('enables optional feature when configured', () => {
    const component = new [ComponentName]('test-component', {
      group: {
        resourceGroupName: 'test-rg',
        location: 'eastus',
      },
      enableFeature: true,
    });
    
    // Assert feature is enabled
    expect(component.featureOutput).toBeDefined();
  });
});
```

#### Testing Best Practices

✅ **Do:**
- Test component instantiation
- Verify required outputs exist
- Test argument validation
- Check default value application
- Test optional feature enablement
- Use descriptive test names
- Group related tests with `describe` blocks
- Mock external dependencies

❌ **Don't:**
- Make actual Azure API calls
- Test Pulumi internals
- Test Azure Native provider behavior
- Create interdependent tests
- Use hardcoded UUIDs or timestamps
- Skip error case testing

#### Common Test Patterns

**Pattern 1: Testing Outputs**

```typescript
test('provides all expected outputs', () => {
  const component = new StorageAccount('test-storage', {
    group: { resourceGroupName: 'test-rg', location: 'eastus' },
  });
  
  const outputs = component.getOutputs();
  
  expect(outputs).toHaveProperty('id');
  expect(outputs).toHaveProperty('name');
  expect(outputs).toHaveProperty('primaryEndpoints');
});
```

**Pattern 2: Testing Validation**

```typescript
describe('argument validation', () => {
  test('requires resource group', () => {
    expect(() => {
      new MyComponent('test', { group: undefined } as any);
    }).toThrow('resource group');
  });
  
  test('validates tier values', () => {
    expect(() => {
      new MyComponent('test', {
        group: { resourceGroupName: 'test-rg', location: 'eastus' },
        tier: 'invalid' as any,
      });
    }).toThrow();
  });
});
```

**Pattern 3: Testing Conditional Behavior**

```typescript
describe('conditional features', () => {
  test('creates encryption when enabled', () => {
    const component = new MyComponent('test', {
      group: { resourceGroupName: 'test-rg', location: 'eastus' },
      encryption: { enabled: true },
    });
    
    expect(component.encryptionKey).toBeDefined();
  });
  
  test('skips encryption when disabled', () => {
    const component = new MyComponent('test', {
      group: { resourceGroupName: 'test-rg', location: 'eastus' },
    });
    
    expect(component.encryptionKey).toBeUndefined();
  });
});
```

**Pattern 4: Testing ResourceBuilder Integration**

```typescript
describe('ResourceBuilder integration', () => {
  test('works with ResourceBuilder', () => {
    const builder = new ResourceBuilder('test-builder', {
      vault: { sku: 'standard' },
    });
    
    const component = new MyComponent('test', {
      group: builder.getResourceGroup()!,
      vaultInfo: builder.getVault(),
    });
    
    expect(component).toBeDefined();
  });
});
```

### Layer 3: Build Testing (Medium Speed)

Build tests ensure the component compiles and packages correctly.

```bash
# Full build process
pnpm run build

# This executes:
# 1. Update tsconfig.json file list
# 2. Compile TypeScript to JavaScript
# 3. Generate type definitions
# 4. Copy package files to bin/
```

**What it validates:**
- TypeScript compilation succeeds
- No build errors or warnings
- Output files generated correctly
- Package structure is valid

**Common build issues:**
```typescript
// Issue: Circular dependency
// Fix: Restructure imports or use lazy loading

// Issue: Missing type definitions
// Fix: Add proper type exports in index.ts

// Issue: Incorrect paths
// Fix: Use relative paths correctly
```

### Layer 4: Integration Testing (Slow)

Integration tests use real Pulumi stacks to validate component composition.

#### Location
`pulumi-test/` directory contains integration examples

#### Structure
```
pulumi-test/
  samples/
    basic/           # Basic usage examples
    advanced/        # Complex scenarios
    [feature]/       # Feature-specific examples
```

#### Creating Integration Tests

```typescript
// pulumi-test/samples/my-component/index.ts
import * as pulumi from '@pulumi/pulumi';
import { MyComponent } from '@drunk-pulumi/azure-components';

const component = new MyComponent('integration-test', {
  group: {
    resourceGroupName: pulumi.getStack() + '-test-rg',
    location: 'eastus',
  },
  tier: 'Standard',
});

export const componentId = component.id;
export const componentName = component.name;
```

#### Running Integration Tests

Integration tests primarily verify TypeScript compilation:

```bash
# Navigate to test directory
cd pulumi-test/samples/my-component

# Install dependencies
pnpm install

# Verify compilation
npx tsc --noEmit

# Optionally, preview changes (requires Azure auth)
pulumi preview
```

**Note**: Integration tests typically don't deploy to Azure in CI/CD due to cost and complexity. They primarily ensure code compiles and types are correct.

## Running Tests

### Quick Validation (Before Commit)

```bash
# Type check only (fastest)
npx tsc --noEmit

# Run unit tests
pnpm run test

# If both pass, proceed to build
pnpm run build
```

### Full Validation (Before PR)

```bash
# 1. Type checking
npx tsc --noEmit

# 2. Linting (if configured)
pnpm run lint

# 3. Unit tests
pnpm run test

# 4. Build
pnpm run build

# 5. Integration test compilation
cd pulumi-test/samples/[example]
npx tsc --noEmit
```

### Watch Mode (During Development)

```bash
# Watch for changes and re-run tests
pnpm run test -- --watch

# Watch TypeScript compilation
npx tsc --noEmit --watch
```

### Test-Driven Development (TDD)

1. Write failing test
```typescript
test('new feature works', () => {
  const component = new MyComponent('test', {
    newFeature: true,
  });
  
  expect(component.newFeatureOutput).toBeDefined();
});
```

2. Run test (should fail)
```bash
pnpm run test
```

3. Implement feature
```typescript
export class MyComponent extends BaseResourceComponent<MyComponentArgs> {
  public readonly newFeatureOutput?: pulumi.Output<string>;
  
  constructor(name: string, args: MyComponentArgs, opts?: pulumi.ComponentResourceOptions) {
    super('MyComponent', name, args, opts);
    
    if (args.newFeature) {
      // Implement feature
      this.newFeatureOutput = pulumi.output('feature-value');
    }
    
    this.registerOutputs({ newFeatureOutput: this.newFeatureOutput });
  }
}
```

4. Run test again (should pass)
```bash
pnpm run test
```

## Debugging Tests

### Common Test Failures

**Issue**: `Cannot read property 'id' of undefined`

**Solution**: Component wasn't created properly or output wasn't registered

```typescript
// Check component creation
const component = new MyComponent('test', args);
expect(component).toBeDefined();

// Check output registration
expect(component.id).toBeDefined();
```

---

**Issue**: `Timeout exceeded` or tests hang

**Solution**: Pulumi mocks not configured properly

```typescript
// Add at top of test file
pulumi.runtime.setMocks({
  newResource: (args: pulumi.runtime.MockResourceArgs) => ({
    id: args.name + '_id',
    state: args.inputs,
  }),
  call: (args: pulumi.runtime.MockCallArgs) => args.inputs,
});
```

---

**Issue**: Type errors in tests

**Solution**: Update test types to match component interface

```typescript
// Import proper types
import { MyComponentArgs } from '../../src/[category]/MyComponent';

// Use correct types
const args: MyComponentArgs = {
  group: { resourceGroupName: 'test-rg', location: 'eastus' },
};
```

### Debug Tools

**VS Code Debugging**

```json
// .vscode/launch.json
{
  "type": "node",
  "request": "launch",
  "name": "Jest Debug",
  "program": "${workspaceFolder}/node_modules/.bin/jest",
  "args": [
    "--runInBand",
    "--no-cache",
    "${file}"
  ],
  "console": "integratedTerminal",
  "internalConsoleOptions": "neverOpen"
}
```

**Console Logging**

```typescript
test('debug component', () => {
  const component = new MyComponent('test', args);
  
  // Log outputs for debugging
  console.log('Component:', component);
  console.log('ID:', component.id);
  
  expect(component).toBeDefined();
});
```

## Test Coverage

### Measuring Coverage

```bash
# Run tests with coverage
pnpm run test -- --coverage

# View coverage report
open coverage/lcov-report/index.html
```

### Coverage Goals

- **Statements**: > 80%
- **Branches**: > 75%
- **Functions**: > 80%
- **Lines**: > 80%

### What to Test

✅ **High Priority:**
- Public APIs and methods
- Argument validation
- Error conditions
- Default value application
- Conditional logic
- Output generation

⚠️ **Medium Priority:**
- Private helper methods
- Edge cases
- Complex transformations

❌ **Low Priority:**
- Pulumi framework internals
- Azure provider behavior
- Third-party library internals

## Validation Checklist

Before submitting a PR:

- [ ] All type checks pass (`npx tsc --noEmit`)
- [ ] All unit tests pass (`pnpm run test`)
- [ ] New tests added for new functionality
- [ ] Tests cover error cases
- [ ] Build succeeds (`pnpm run build`)
- [ ] Test coverage maintained or improved
- [ ] Integration examples compile (if applicable)
- [ ] No console.log statements left in code
- [ ] Test descriptions are clear and descriptive

## Testing Anti-Patterns

❌ **Don't:**
- Test implementation details
- Create tests with external dependencies
- Use real Azure credentials in tests
- Write tests that depend on execution order
- Hardcode environment-specific values
- Skip testing error paths
- Write tests without assertions
- Use `any` types in test code

✅ **Do:**
- Test public interface behavior
- Mock all external dependencies
- Use deterministic test data
- Write isolated, independent tests
- Use variables for test data
- Test both success and failure paths
- Assert on concrete values
- Use strong typing in tests

## Performance Testing

### Benchmarking Component Creation

```typescript
describe('performance', () => {
  test('creates component quickly', () => {
    const start = Date.now();
    
    const component = new MyComponent('test', args);
    
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(1000); // Should create in < 1 second
  });
});
```

### Resource Count Validation

```typescript
test('does not create excessive resources', () => {
  const component = new MyComponent('test', args);
  
  // Verify reasonable resource count
  const outputs = component.getOutputs();
  const resourceCount = Object.keys(outputs).length;
  
  expect(resourceCount).toBeLessThan(20); // Adjust based on component
});
```

## Continuous Integration

Typical CI pipeline for this project:

```yaml
# .github/workflows/test.yml
steps:
  - name: Install dependencies
    run: pnpm install
    
  - name: Type check
    run: npx tsc --noEmit
    
  - name: Run tests
    run: pnpm run test
    
  - name: Build
    run: pnpm run build
```

## Additional Resources

- Jest documentation: https://jestjs.io/
- Pulumi testing guide: https://www.pulumi.com/docs/guides/testing/
- TypeScript testing best practices
- See existing tests in `__tests__/` for examples

## Quick Command Reference

```bash
# Type checking
npx tsc --noEmit

# Run all tests
pnpm run test

# Run specific test file
pnpm run test [ComponentName].test.ts

# Run tests in watch mode
pnpm run test -- --watch

# Run tests with coverage
pnpm run test -- --coverage

# Build project
pnpm run build

# Clean build
rm -rf bin/ && pnpm run build
```
