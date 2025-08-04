# Drunk Pulumi Azure Components

A modular, reusable TypeScript library of Pulumi components for rapidly building and managing Azure infrastructure. This project provides high-level abstractions for common Azure resources, enabling you to compose complex cloud environments with minimal boilerplate.

## Features
- **Composable Components:** Build infrastructure using reusable building blocks (e.g., Resource Groups, Key Vaults, VMs, Networking, Storage, Databases, etc.).
- **Opinionated Defaults:** Sensible defaults for security, tagging, and resource configuration.
- **Extensible:** Easily extend or customize components for your organization's needs.
- **Pulumi Native:** Leverages Pulumi's TypeScript SDK for full infrastructure-as-code power.
- **Azure Best Practices:** Implements patterns for identity, encryption, logging, and networking.

## Project Structure
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
```

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v16+ recommended)
- [Pulumi CLI](https://www.pulumi.com/docs/get-started/install/)
- Azure account with sufficient permissions
- [pnpm](https://pnpm.io/) (or npm/yarn)

### Installation
Clone the repository and install dependencies:
```bash
git clone <repo-url>
cd drunk-pulumi-azure-components
pnpm install
```

### Usage
You can use the components in your own Pulumi project or in the provided `pulumi-test/` directory for examples.

#### Example: Creating a Resource Group with Key Vault and Logging
```typescript
import { ResourceBuilder } from '../src/ResourceBuilder';

const builder = new ResourceBuilder('my-stack', {
  groupRoles: { createWithName: 'my-rg-roles' },
  vault: { /* vault config */ },
  logs: { /* logs config */ },
  enableDefaultUAssignId: true,
});

export const outputs = builder.getOutputs();
```

See `pulumi-test/samples/` for more usage examples.

### Project Scripts
- `pnpm build` – Compile TypeScript sources
- `pnpm lint` – Run ESLint
- `pnpm test` – Run tests (if available)

### Directory Reference
- **src/**: All core component code
- **pulumi-test/**: Example Pulumi stacks and sample usage
- **.devcontainer/**: Development container setup for VS Code

## Component Overview
- **ResourceBuilder**: Main entry point for composing resources (resource group, roles, vault, logs, disk encryption, etc.)
- **azAd/**: Azure AD roles, group roles, user-assigned identities
- **vault/**: Key Vaults, encryption keys, secrets
- **vm/**: Virtual machines, disk encryption sets
- **vnet/**: Virtual networks, firewalls, peering, endpoints
- **logs/**: Log analytics and monitoring
- **database/**: SQL, MySQL, Postgres, Redis
- **storage/**: Storage accounts
- **app/**: App Service, IoT Hub, Logic Apps, SignalR
- **services/**: Automation, Search, Service Bus

## Contributing
1. Fork the repository
2. Create a new branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run tests and linting
5. Submit a pull request

## License
MIT License

## Support & Contact
For questions, issues, or feature requests, please open an issue on GitHub or contact the maintainer.
