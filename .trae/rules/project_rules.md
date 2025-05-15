# Project Rules for Drunk Pulumi Azure Components

## 1. Code Style & Quality
- Use TypeScript for all source code in `src/`.
- Follow the existing ESLint configuration (`.eslintrc.json`).
- Use consistent naming conventions: camelCase for variables/functions, PascalCase for classes/types.
- Write clear, concise, and self-documenting code. Add comments only where necessary.
- Keep functions and classes focused; prefer composition over inheritance.

## 2. Directory & File Structure
- Place all reusable components and logic in `src/`.
- Organize resources by Azure service (e.g., `src/vm/`, `src/vault/`, `src/aks/`).
- Shared types go in `src/types.ts`.
- Place test/demo stacks in `pulumi-test/`.
- Do not commit secrets or sensitive data. Use environment variables or Pulumi config.

## 3. Component Design
- All major Azure resources should have a corresponding component class.
- Components must accept configuration via strongly-typed interfaces.
- Expose outputs via a `getOutputs()` method where appropriate.
- Use dependency injection for resource relationships (e.g., pass resource group, roles, vault info as props).
- Prefer composition: build higher-level components from lower-level ones.

## 4. Version Control & Branching
- Use feature branches for new features or fixes (`feature/xyz`, `fix/bug-abc`).
- Keep `main` branch stable and deployable.
- Write clear, descriptive commit messages.
- Pull requests must pass CI checks before merging.

## 5. Testing & Validation
- Add tests for new components and features where possible.
- Use the `pulumi-test/` directory for integration and example stacks.
- Run `pnpm lint` and `pnpm build` before submitting changes.

## 6. Documentation
- Update `README.md` and add usage examples for new components.
- Document all public interfaces and configuration options.
- Keep this `project_rules.md` up to date with process changes.

## 7. Security & Compliance
- Never hardcode secrets or credentials.
- Use Pulumi secrets and Azure Key Vault for sensitive values.
- Apply least privilege principle for roles and identities.
- Enable logging and monitoring for all production resources.

## 8. Contribution Guidelines
- Fork the repo and create a feature branch for your changes.
- Ensure your code passes linting and builds successfully.
- Submit a pull request with a clear description of your changes.
- Be responsive to code review feedback.


        