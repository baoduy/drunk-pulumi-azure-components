# Drunk Pulumi Azure Components - GitHub Copilot Skills

Welcome to the Skills collection for Drunk Pulumi Azure Components! These skills are designed to help developers effectively use GitHub Copilot when working with this library.

## What are Skills?

Skills are specialized guides that work with GitHub Copilot to provide context-aware assistance for specific tasks. Each skill focuses on a particular aspect of working with Drunk Pulumi Azure Components.

## Available Skills

### 1. [Component Development](./component-development.md)
**Purpose:** Guide for creating new Azure infrastructure components

**Use this skill when:**
- Creating a new Azure resource component
- Adding functionality to existing components
- Converting raw Pulumi resources into reusable components
- Following component development best practices

**Key Topics:**
- Component interface design
- Class implementation patterns
- Type definitions
- Testing your components
- Category-specific patterns

---

### 2. [ResourceBuilder Usage](./resource-builder.md)
**Purpose:** Master the ResourceBuilder orchestrator for composing complex infrastructure

**Use this skill when:**
- Setting up new Azure environments
- Composing multiple related resources
- Need integrated Key Vault, logging, and identity management
- Extending ResourceBuilder with new capabilities

**Key Topics:**
- Basic and advanced configuration
- Accessing builder outputs
- Common usage patterns
- Extending the builder
- Integration strategies

---

### 3. [Testing & Validation](./testing-validation.md)
**Purpose:** Comprehensive testing strategies for quality assurance

**Use this skill when:**
- Writing tests for new components
- Validating component changes
- Debugging test failures
- Setting up test infrastructure

**Key Topics:**
- Type checking with TypeScript
- Unit testing with Jest
- Build validation
- Integration testing
- Test-driven development

---

### 4. [Security Best Practices](./security-practices.md)
**Purpose:** Implement secure Azure infrastructure deployments

**Use this skill when:**
- Designing security-focused infrastructure
- Implementing access controls
- Managing secrets and credentials
- Configuring network security
- Ensuring compliance

**Key Topics:**
- Secret management
- Identity & access management
- Network security
- Data encryption
- Logging & monitoring
- Compliance & governance

---

### 5. [Troubleshooting & Debugging](./troubleshooting.md)
**Purpose:** Diagnose and resolve common issues

**Use this skill when:**
- Experiencing deployment failures
- Encountering type errors
- Dealing with Azure provider errors
- Debugging network or permission issues
- Build or test failures

**Key Topics:**
- Diagnostic approach
- Common issues & solutions
- Debugging techniques
- Prevention strategies
- Quick troubleshooting checklist

---

### 6. [Migration & Refactoring](./migration-refactoring.md)
**Purpose:** Migrate from other IaC tools and refactor existing code

**Use this skill when:**
- Migrating from Terraform/ARM/Bicep
- Moving from raw Pulumi to Drunk Components
- Refactoring existing implementations
- Upgrading component versions
- Restructuring infrastructure code

**Key Topics:**
- Migration strategies
- Terraform to Pulumi migration
- Raw Pulumi to components
- Refactoring patterns
- Component upgrade guide

---

## How to Use These Skills

### With GitHub Copilot Chat

Reference a skill in your conversation:

```
@workspace Using the Component Development skill, help me create a new Azure Cognitive Search component
```

```
@workspace Following the Security Best Practices skill, how should I configure Key Vault for production?
```

### With GitHub Copilot Inline

Skills inform Copilot's inline suggestions automatically when you're working in relevant files. The more context you provide through comments and names, the better suggestions you'll get.

### As Reference Documentation

These skills also serve as standalone documentation that you can read and reference independently of Copilot.

## Skill Organization

Each skill follows a consistent structure:

1. **Skill Purpose** - What the skill helps you accomplish
2. **When to Use** - Specific scenarios for using the skill
3. **Main Content** - Detailed guidance, patterns, and examples
4. **Checklists** - Quick validation points
5. **Additional Resources** - Links and references

## Prerequisites

Before using these skills, ensure you have:

- Node.js 16+ installed
- Pulumi CLI installed
- Azure account with appropriate permissions
- pnpm package manager
- Basic TypeScript knowledge
- Understanding of Azure services

## Quick Start Example

Here's a complete example using multiple skills:

```typescript
// 1. Using ResourceBuilder (ResourceBuilder Usage skill)
import { ResourceBuilder } from '@drunk-pulumi/azure-components';

const builder = new ResourceBuilder('my-app', {
  // 2. Security best practices (Security Best Practices skill)
  vault: {
    sku: 'premium',
    enableSoftDelete: true,
    enablePurgeProtection: true,
  },
  
  // Identity management
  enableDefaultUAssignId: true,
  
  // Logging for monitoring
  logs: {
    retentionInDays: 90,
  },
});

// 3. Component development (Component Development skill)
import { StorageAccount } from '@drunk-pulumi/azure-components/storage';

const storage = new StorageAccount('storage', {
  group: builder.getResourceGroup()!,
  vaultInfo: builder.getVault(),
  
  // Security configurations
  supportsHttpsTrafficOnly: true,
  minimumTlsVersion: 'TLS1_2',
});

// 4. Testing (Testing & Validation skill)
// Run: npx tsc --noEmit
// Run: pnpm run test
// Run: pnpm run build

// 5. Exports
export const outputs = builder.getOutputs();
export const storageId = storage.id;
```

## Validation Workflow

Recommended workflow when using these skills:

1. **Plan** - Choose the right skill for your task
2. **Implement** - Follow skill guidance and patterns
3. **Validate** - Use Testing & Validation skill
4. **Secure** - Apply Security Best Practices skill
5. **Debug** - Use Troubleshooting skill if issues arise
6. **Refactor** - Apply Migration & Refactoring skill for improvements

## Contributing to Skills

Skills should be updated when:

- New features are added to the library
- New patterns are established
- Common issues are identified
- Best practices evolve

To suggest improvements:

1. Open an issue describing the skill gap or improvement
2. Provide examples of what could be better
3. Submit a PR with updated skill content

## Skill Maintenance

Skills are living documents that evolve with the project. They are:

- ✅ Updated with new features
- ✅ Enhanced based on user feedback
- ✅ Kept in sync with code changes
- ✅ Validated against current library version

## Related Resources

### Project Documentation

- **README.md** - Project overview and getting started
- **COPILOT_GUIDELINES.md** - Supplementary Copilot patterns
- **copilot-instructions.md** - Core Copilot instructions
- **doc/** - Category-specific deep dives

### Pulumi Resources

- [Pulumi Documentation](https://www.pulumi.com/docs/)
- [Pulumi Azure Native Provider](https://www.pulumi.com/registry/packages/azure-native/)
- [Pulumi TypeScript Guide](https://www.pulumi.com/docs/intro/languages/javascript/)

### Azure Resources

- [Azure Documentation](https://docs.microsoft.com/azure/)
- [Azure Architecture Center](https://docs.microsoft.com/azure/architecture/)
- [Azure Security Best Practices](https://docs.microsoft.com/azure/security/)

## Quick Commands Reference

```bash
# Development
pnpm install          # Install dependencies
pnpm run build        # Build project
pnpm run test         # Run tests
npx tsc --noEmit      # Type check

# Validation
pulumi preview        # Preview changes
pulumi up             # Apply changes
pulumi refresh        # Sync state with Azure

# Debugging
pulumi logs --follow  # View logs
pulumi stack export   # Export state
az account show       # Verify Azure auth
```

## Support

If you need help beyond what these skills provide:

1. Check the main project documentation
2. Review existing issues on GitHub
3. Open a new issue with:
   - Skill you were using
   - What you were trying to accomplish
   - Specific question or problem
   - Code examples (without secrets!)

## Feedback

We value your feedback on these skills! Let us know:

- Which skills are most helpful
- What could be improved
- What's missing
- Suggestions for new skills

Open an issue with the `skills` label to share feedback.

---

**Version:** 1.0.0  
**Last Updated:** February 2026  
**Maintained by:** Drunk Pulumi Azure Components Team
