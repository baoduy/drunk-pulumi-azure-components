# Documentation

This directory contains auto-generated documentation for all source files in the `src/` directory of the drunk-pulumi-azure-components project.

## Overview

The documentation is automatically generated using TypeScript AST parsing to extract:
- File purpose and description
- Classes, interfaces, enums, and type definitions
- Function declarations
- Import dependencies
- Export information

## Structure

- **[index.md](./index.md)** - Main documentation index with navigation links to all files
- Each TypeScript file in `src/` has a corresponding Markdown file in this directory
- Directory structure mirrors the `src/` folder structure

## Regenerating Documentation

To regenerate the documentation after code changes:

```bash
npm run docs
```

This will:
1. Parse all TypeScript files in the `src/` directory
2. Extract documentation information using TypeScript compiler API
3. Generate Markdown files with consistent formatting
4. Update the main index file with navigation links

## Documentation Format

Each generated Markdown file includes:

- **File Path**: Relative path from `src/` directory
- **Purpose**: Description of the file's role and functionality
- **Dependencies**: List of imported modules
- **Classes**: Class definitions with descriptions
- **Interfaces**: Interface definitions with descriptions
- **Enums**: Enumeration definitions with descriptions
- **Types**: Type alias definitions with descriptions
- **Functions**: Function declarations with descriptions
- **Exports**: List of exported symbols

## Statistics

The current codebase contains:
- **89** TypeScript files
- **51** Classes
- **35** Functions
- **50** Interfaces
- **4** Enums
- **69** Type definitions

## Navigation

Use the [index.md](./index.md) file to navigate through the documentation. Files are organized by their directory structure for easy browsing.