# Drunk Pulumi Azure Components

A modular, reusable TypeScript library of Pulumi components for rapidly building and managing Azure infrastructure. This project provides high-level abstractions for common Azure resources, enabling you to compose complex cloud environments with minimal boilerplate.

**CRITICAL: Always reference these instructions first and fallback to search or bash commands only when you encounter unexpected information that does not match the info here.**

## Working Effectively

### Initial Setup
**Install dependencies and build the library:**
- Install pnpm globally: `npm install -g pnpm`
- Install dependencies: `pnpm install` -- takes 2+ minutes. **NEVER CANCEL.** Set timeout to 180+ seconds.
- Build the library: `pnpm run build` -- takes under 2 minutes. **NEVER CANCEL.** Set timeout to 180+ seconds.

### Development Commands
- **Build**: `pnpm run build` -- Compiles TypeScript, updates tsconfig.json, copies files to bin/
- **Fast Build**: `pnpm run fastBuild` -- TypeScript compilation only, faster for development
- **Test**: `pnpm run test` -- Runs Jest test suite, takes 30+ seconds. **NEVER CANCEL.** Set timeout to 60+ seconds.
- **TypeScript Check**: `npx tsc --noEmit` -- Validates TypeScript without generating output, very fast
- **Update Dependencies**: `pnpm run update` -- Updates all package dependencies

### Code Quality
- **TypeScript Validation**: Always run `npx tsc --noEmit` before committing changes
- **ESLint**: The project has ESLint configured but requires additional TypeScript parser setup to work properly. Use TypeScript compiler for code validation instead.
- **Testing**: Always run `pnpm run test` after making changes to ensure no regressions

## Project Structure

### Source Code Organization
```
src/
  aks/           # Azure Kubernetes Service components
  app/           # App-related Azure resources (App Service, IoT Hub, etc.)
  azAd/          # Azure Active Directory (roles, identities, etc.)
  base/          # Base classes and helpers for components
  common/        # Common utilities and resource helpers
  database/      # Database resources (SQL, MySQL, Postgres, Redis)
  helpers/       # Utility functions and configuration helpers
  logs/          # Logging and monitoring components
  services/      # Azure services (Automation, Search, Service Bus)
  storage/       # Storage account components
  vault/         # Key Vault and encryption helpers
  vm/            # Virtual machine and disk encryption components
  vnet/          # Networking (VNet, Firewall, CDN, etc.)
  types.ts       # Shared TypeScript types
  ResourceBuilder.ts # Main builder for composing resources
  index.ts       # Main library entry point
```

### Key Entry Points
- **ResourceBuilder**: Main component for composing Azure resources (resource groups, roles, vault, logs, etc.)
- **Component Categories**: Each directory under `src/` represents a category of Azure services with related components

### Important Files
- **package.json**: Defines scripts, dependencies, and project metadata
- **tsconfig.json**: TypeScript configuration (dynamically updated by build process)
- **jest.config.js**: Jest testing configuration
- **PulumiPlugin.yaml**: Pulumi plugin metadata
- **.eslintrc.json**: ESLint configuration (needs TypeScript parser setup for full functionality)

## Testing and Examples

### Running Tests
- **Unit Tests**: `pnpm run test` in the root directory
- **Example Validation**: Use the `pulumi-test/` directory for testing component usage

### Pulumi Test Directory
Navigate to `pulumi-test/` for working examples:
- **Install dependencies**: `npm install` (takes 1+ minute)
- **Validate TypeScript**: `npx tsc --noEmit` to ensure examples compile
- **Example files**: `index.ts` and `samples/` directory contain usage examples
- **Pulumi commands**: Scripts in package.json for stack management (requires Azure credentials)

### Manual Validation
After making changes to components:
1. **Build the library**: `pnpm run build`
2. **Run tests**: `pnpm run test`
3. **Validate examples**: Navigate to `pulumi-test/` and run `npx tsc --noEmit`
4. **Check specific components**: Create test files in `pulumi-test/samples/` to validate new functionality

## Component Usage Patterns

### Common Component Types
- **Resource Groups**: Base organizational unit for Azure resources
- **Key Vaults**: Secure storage for secrets, keys, and certificates
- **Networking**: Virtual networks, subnets, firewalls, and peering
- **Identity**: Azure AD roles, user-assigned identities, and role assignments
- **Compute**: Virtual machines, AKS clusters, and associated resources
- **Storage**: Storage accounts and related services
- **Databases**: SQL, MySQL, PostgreSQL, and Redis instances

### Typical Usage Flow
```typescript
import { ResourceBuilder } from '@drunk-pulumi/azure-components';

const builder = new ResourceBuilder('stack-name', {
  groupRoles: { createWithName: 'my-rg-roles' },
  vault: { sku: 'standard' },
  logs: { /* logs config */ },
  enableDefaultUAssignId: true,
});

export const outputs = builder.getOutputs();
```

## Build System Details

### Build Process
The `pnpm run build` command performs these steps:
1. **Update tsconfig.json**: Automatically adds all TypeScript files to the files array
2. **Compile TypeScript**: Generates JavaScript and declaration files in `bin/` directory
3. **Copy package files**: Copies package.json (without devDependencies), README.md, and PulumiPlugin.yaml to `bin/`

### Output Directory
- **bin/**: Contains compiled JavaScript, TypeScript declarations, and package files
- **Ignore bin/**: The `bin/` directory is git-ignored as it contains build artifacts

### Dependencies
- **Runtime**: Pulumi Azure providers, lodash, netmask, openpgp
- **Development**: TypeScript, Jest, ts-jest, cross-env, cpy-cli
- **Package Manager**: pnpm (preferred) or npm

## Validation Scenarios

### Code Changes Validation
1. **Component Development**: After modifying any component, always build and test
2. **Type Safety**: Run `npx tsc --noEmit` to catch TypeScript errors
3. **Regression Testing**: Run `pnpm run test` to ensure existing functionality works
4. **Example Integration**: Test changes using examples in `pulumi-test/` directory

### CI/CD Considerations
- **GitHub Workflow**: Located at `.github/workflows/build-publish-drunk.yml`
- **Build Requirements**: Node.js 20, pnpm 8, proper npm authentication for publishing
- **Versioning**: Automatic patch version increment on main branch pushes

## Common Tasks Reference

### Repository Root Files
```
.devcontainer/     # VS Code development container setup
.github/           # GitHub workflows and configuration
.tasks/            # Build helper scripts
__tests__/         # Jest test files
pulumi-test/       # Example Pulumi stacks and usage samples
src/               # Main source code
.eslintrc.json     # ESLint configuration
.gitignore         # Git ignore patterns
jest.config.js     # Jest configuration
package.json       # Package configuration and scripts
pnpm-lock.yaml     # pnpm lockfile
PulumiPlugin.yaml  # Pulumi plugin metadata
README.md          # Project documentation
tsconfig.json      # TypeScript configuration
```

### Package.json Scripts
```json
{
  "build": "pnpm run update-tsconfig && pnpm run fastBuild && npm run copy-pkg",
  "fastBuild": "cross-env NODE_ENV=production && NODE_OPTIONS=\"--max-old-space-size=8192\" npx tsc",
  "test": "jest",
  "update": "npx npm-check-updates -u && pnpm install"
}
```

### Dependencies Overview
- **@drunk-pulumi/azure-providers**: Core Azure provider abstractions
- **@pulumi/azure-native**: Official Azure Native Pulumi provider
- **@pulumi/azuread**: Azure Active Directory provider
- **@pulumi/pulumi**: Core Pulumi SDK
- **lodash**: Utility functions
- **netmask**: Network address manipulation
- **openpgp**: PGP encryption functionality

## Troubleshooting

### Common Issues
- **Build Errors**: Ensure all dependencies are installed with `pnpm install`
- **TypeScript Errors**: Use `npx tsc --noEmit` to check for compilation issues
- **Test Failures**: Run tests individually to isolate issues
- **ESLint Issues**: ESLint configuration needs TypeScript parser setup for full functionality

### Performance Notes
- **Build Time**: Under 2 minutes for full build
- **Install Time**: Approximately 2 minutes for dependency installation
- **Test Time**: Approximately 11 seconds for full test suite
- **Memory Usage**: Build process uses up to 8GB memory allocation for large projects

### Environment Requirements
- **Node.js**: Version 16+ (tested with Node.js 20)
- **Package Manager**: pnpm (preferred) or npm
- **Pulumi CLI**: Required for running examples (already available in this environment)
- **TypeScript**: Managed through project dependencies

**Remember: Always validate changes with build, test, and TypeScript compilation before committing.**