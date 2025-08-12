#!/usr/bin/env ts-node

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

interface FileDocumentation {
  filePath: string;
  relativePath: string;
  fileName: string;
  purpose: string;
  classes: Array<{ name: string; purpose: string }>;
  functions: Array<{ name: string; purpose: string }>;
  interfaces: Array<{ name: string; purpose: string }>;
  enums: Array<{ name: string; purpose: string }>;
  types: Array<{ name: string; purpose: string }>;
  imports: string[];
  exports: string[];
}

class DocumentationGenerator {
  private srcPath: string;
  private docPath: string;
  
  constructor(srcPath: string, docPath: string) {
    this.srcPath = srcPath;
    this.docPath = docPath;
  }

  public async generateDocumentation(): Promise<void> {
    console.log('Starting documentation generation...');
    
    // Create doc directory if it doesn't exist
    if (!fs.existsSync(this.docPath)) {
      fs.mkdirSync(this.docPath, { recursive: true });
    }

    // Find all TypeScript files in src directory
    const tsFiles = this.findTypeScriptFiles(this.srcPath);
    console.log(`Found ${tsFiles.length} TypeScript files to document`);

    const allDocs: FileDocumentation[] = [];

    // Generate documentation for each file
    for (const filePath of tsFiles) {
      const doc = this.analyzeFile(filePath);
      allDocs.push(doc);
      await this.generateMarkdownFile(doc);
    }

    // Generate index file
    await this.generateIndexFile(allDocs);
    
    console.log('Documentation generation completed!');
  }

  private findTypeScriptFiles(dir: string): string[] {
    const files: string[] = [];
    
    const walk = (currentDir: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          files.push(fullPath);
        }
      }
    };
    
    walk(dir);
    return files;
  }

  private analyzeFile(filePath: string): FileDocumentation {
    const sourceCode = fs.readFileSync(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceCode,
      ts.ScriptTarget.Latest,
      true
    );

    const relativePath = path.relative(this.srcPath, filePath);
    const fileName = path.basename(filePath);

    const doc: FileDocumentation = {
      filePath,
      relativePath,
      fileName,
      purpose: this.extractFilePurpose(sourceFile, sourceCode),
      classes: [],
      functions: [],
      interfaces: [],
      enums: [],
      types: [],
      imports: [],
      exports: []
    };

    this.visitNode(sourceFile, doc);
    
    return doc;
  }

  private extractFilePurpose(sourceFile: ts.SourceFile, sourceCode: string): string {
    // Look for file-level JSDoc comments
    const lines = sourceCode.split('\n');
    let purpose = '';
    
    // Check for leading comments
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const line = lines[i].trim();
      if (line.startsWith('/**') || line.startsWith('/*') || line.startsWith('*')) {
        const comment = line.replace(/^\/?\*+\/?/g, '').trim();
        if (comment && !comment.startsWith('@')) {
          purpose = comment;
          break;
        }
      }
    }

    // Fallback: infer purpose from file name and exports
    if (!purpose) {
      const fileName = path.basename(sourceFile.fileName, '.ts');
      if (fileName === 'index') {
        purpose = 'Main module entry point that exports components and utilities.';
      } else {
        purpose = `Provides ${fileName.replace(/([A-Z])/g, ' $1').toLowerCase().trim()} functionality and related utilities.`;
      }
    }

    return purpose;
  }

  private visitNode(node: ts.Node, doc: FileDocumentation): void {
    switch (node.kind) {
      case ts.SyntaxKind.ImportDeclaration:
        this.extractImport(node as ts.ImportDeclaration, doc);
        break;
      case ts.SyntaxKind.ExportDeclaration:
      case ts.SyntaxKind.ExportAssignment:
        this.extractExport(node, doc);
        break;
      case ts.SyntaxKind.ClassDeclaration:
        this.extractClass(node as ts.ClassDeclaration, doc);
        break;
      case ts.SyntaxKind.FunctionDeclaration:
        this.extractFunction(node as ts.FunctionDeclaration, doc);
        break;
      case ts.SyntaxKind.InterfaceDeclaration:
        this.extractInterface(node as ts.InterfaceDeclaration, doc);
        break;
      case ts.SyntaxKind.EnumDeclaration:
        this.extractEnum(node as ts.EnumDeclaration, doc);
        break;
      case ts.SyntaxKind.TypeAliasDeclaration:
        this.extractType(node as ts.TypeAliasDeclaration, doc);
        break;
      case ts.SyntaxKind.VariableStatement:
        this.extractVariableExports(node as ts.VariableStatement, doc);
        break;
    }

    ts.forEachChild(node, child => this.visitNode(child, doc));
  }

  private extractImport(node: ts.ImportDeclaration, doc: FileDocumentation): void {
    const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral).text;
    doc.imports.push(moduleSpecifier);
  }

  private extractExport(node: ts.Node, doc: FileDocumentation): void {
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral).text;
      doc.exports.push(`Re-exports from ${moduleSpecifier}`);
    } else if (ts.isExportAssignment(node)) {
      doc.exports.push('Default export');
    }
  }

  private extractClass(node: ts.ClassDeclaration, doc: FileDocumentation): void {
    if (node.name) {
      const className = node.name.text;
      const purpose = this.getJSDocComment(node) || `${className} class implementation.`;
      doc.classes.push({ name: className, purpose });
      
      if (this.hasExportModifier(node)) {
        doc.exports.push(className);
      }
    }
  }

  private extractFunction(node: ts.FunctionDeclaration, doc: FileDocumentation): void {
    if (node.name) {
      const functionName = node.name.text;
      const purpose = this.getJSDocComment(node) || `${functionName} function implementation.`;
      doc.functions.push({ name: functionName, purpose });
      
      if (this.hasExportModifier(node)) {
        doc.exports.push(functionName);
      }
    }
  }

  private extractInterface(node: ts.InterfaceDeclaration, doc: FileDocumentation): void {
    const interfaceName = node.name.text;
    const purpose = this.getJSDocComment(node) || `${interfaceName} interface definition.`;
    doc.interfaces.push({ name: interfaceName, purpose });
    
    if (this.hasExportModifier(node)) {
      doc.exports.push(interfaceName);
    }
  }

  private extractEnum(node: ts.EnumDeclaration, doc: FileDocumentation): void {
    const enumName = node.name.text;
    const purpose = this.getJSDocComment(node) || `${enumName} enumeration.`;
    doc.enums.push({ name: enumName, purpose });
    
    if (this.hasExportModifier(node)) {
      doc.exports.push(enumName);
    }
  }

  private extractType(node: ts.TypeAliasDeclaration, doc: FileDocumentation): void {
    const typeName = node.name.text;
    const purpose = this.getJSDocComment(node) || `${typeName} type definition.`;
    doc.types.push({ name: typeName, purpose });
    
    if (this.hasExportModifier(node)) {
      doc.exports.push(typeName);
    }
  }

  private extractVariableExports(node: ts.VariableStatement, doc: FileDocumentation): void {
    if (this.hasExportModifier(node)) {
      node.declarationList.declarations.forEach(decl => {
        if (ts.isIdentifier(decl.name)) {
          doc.exports.push(decl.name.text);
        }
      });
    }
  }

  private hasExportModifier(node: ts.Node): boolean {
    const modifiers = (node as any).modifiers;
    return modifiers?.some((mod: ts.Modifier) => mod.kind === ts.SyntaxKind.ExportKeyword) || false;
  }

  private getJSDocComment(node: ts.Node): string {
    const jsDocTags = (node as any).jsDoc;
    if (jsDocTags && jsDocTags.length > 0) {
      const comment = jsDocTags[0].comment;
      if (typeof comment === 'string') {
        return comment;
      }
    }
    return '';
  }

  private async generateMarkdownFile(doc: FileDocumentation): Promise<void> {
    const markdown = this.generateMarkdownContent(doc);
    
    // Create directory structure in doc folder
    const docFilePath = path.join(this.docPath, doc.relativePath.replace('.ts', '.md'));
    const docDir = path.dirname(docFilePath);
    
    if (!fs.existsSync(docDir)) {
      fs.mkdirSync(docDir, { recursive: true });
    }
    
    fs.writeFileSync(docFilePath, markdown);
  }

  private generateMarkdownContent(doc: FileDocumentation): string {
    const sections: string[] = [];
    
    // Header
    sections.push(`# ${doc.fileName}`);
    sections.push('');
    sections.push(`**File Path:** \`${doc.relativePath}\``);
    sections.push('');
    
    // Purpose
    sections.push('## Purpose');
    sections.push('');
    sections.push(doc.purpose);
    sections.push('');
    
    // Dependencies
    if (doc.imports.length > 0) {
      sections.push('## Dependencies');
      sections.push('');
      doc.imports.forEach(imp => {
        sections.push(`- \`${imp}\``);
      });
      sections.push('');
    }
    
    // Classes
    if (doc.classes.length > 0) {
      sections.push('## Classes');
      sections.push('');
      doc.classes.forEach(cls => {
        sections.push(`### ${cls.name}`);
        sections.push('');
        sections.push(cls.purpose);
        sections.push('');
      });
    }
    
    // Interfaces
    if (doc.interfaces.length > 0) {
      sections.push('## Interfaces');
      sections.push('');
      doc.interfaces.forEach(iface => {
        sections.push(`### ${iface.name}`);
        sections.push('');
        sections.push(iface.purpose);
        sections.push('');
      });
    }
    
    // Enums
    if (doc.enums.length > 0) {
      sections.push('## Enums');
      sections.push('');
      doc.enums.forEach(enm => {
        sections.push(`### ${enm.name}`);
        sections.push('');
        sections.push(enm.purpose);
        sections.push('');
      });
    }
    
    // Types
    if (doc.types.length > 0) {
      sections.push('## Types');
      sections.push('');
      doc.types.forEach(type => {
        sections.push(`### ${type.name}`);
        sections.push('');
        sections.push(type.purpose);
        sections.push('');
      });
    }
    
    // Functions
    if (doc.functions.length > 0) {
      sections.push('## Functions');
      sections.push('');
      doc.functions.forEach(fn => {
        sections.push(`### ${fn.name}`);
        sections.push('');
        sections.push(fn.purpose);
        sections.push('');
      });
    }
    
    // Exports
    if (doc.exports.length > 0) {
      sections.push('## Exports');
      sections.push('');
      doc.exports.forEach(exp => {
        sections.push(`- \`${exp}\``);
      });
      sections.push('');
    }
    
    return sections.join('\n');
  }

  private async generateIndexFile(allDocs: FileDocumentation[]): Promise<void> {
    const sections: string[] = [];
    
    sections.push('# Documentation Index');
    sections.push('');
    sections.push('This directory contains auto-generated documentation for all source files in the `src/` directory.');
    sections.push('');
    sections.push('## File Structure');
    sections.push('');
    
    // Group files by directory
    const filesByDir = new Map<string, FileDocumentation[]>();
    
    allDocs.forEach(doc => {
      const dir = path.dirname(doc.relativePath);
      if (!filesByDir.has(dir)) {
        filesByDir.set(dir, []);
      }
      filesByDir.get(dir)!.push(doc);
    });
    
    // Sort directories
    const sortedDirs = Array.from(filesByDir.keys()).sort();
    
    sortedDirs.forEach(dir => {
      const files = filesByDir.get(dir)!;
      
      if (dir === '.') {
        sections.push('### Root Files');
      } else {
        sections.push(`### ${dir}/`);
      }
      sections.push('');
      
      files.sort((a, b) => a.fileName.localeCompare(b.fileName)).forEach(file => {
        const docPath = file.relativePath.replace('.ts', '.md');
        sections.push(`- [${file.fileName}](./${docPath}) - ${file.purpose}`);
      });
      sections.push('');
    });
    
    // Statistics
    sections.push('## Statistics');
    sections.push('');
    sections.push(`- **Total Files:** ${allDocs.length}`);
    sections.push(`- **Total Classes:** ${allDocs.reduce((sum, doc) => sum + doc.classes.length, 0)}`);
    sections.push(`- **Total Functions:** ${allDocs.reduce((sum, doc) => sum + doc.functions.length, 0)}`);
    sections.push(`- **Total Interfaces:** ${allDocs.reduce((sum, doc) => sum + doc.interfaces.length, 0)}`);
    sections.push(`- **Total Enums:** ${allDocs.reduce((sum, doc) => sum + doc.enums.length, 0)}`);
    sections.push(`- **Total Types:** ${allDocs.reduce((sum, doc) => sum + doc.types.length, 0)}`);
    sections.push('');
    
    const indexPath = path.join(this.docPath, 'index.md');
    fs.writeFileSync(indexPath, sections.join('\n'));
  }
}

// Main execution
async function main() {
  const srcPath = path.join(__dirname, '..', 'src');
  const docPath = path.join(__dirname, '..', 'doc');
  
  const generator = new DocumentationGenerator(srcPath, docPath);
  await generator.generateDocumentation();
}

if (require.main === module) {
  main().catch(console.error);
}