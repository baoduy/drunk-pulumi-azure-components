import * as fs from 'fs';
import * as path from 'path';

describe('Documentation Generation', () => {
  const docPath = path.join(__dirname, '..', 'doc');
  const srcPath = path.join(__dirname, '..', 'src');

  test('doc directory exists', () => {
    expect(fs.existsSync(docPath)).toBe(true);
  });

  test('index.md file exists', () => {
    const indexPath = path.join(docPath, 'index.md');
    expect(fs.existsSync(indexPath)).toBe(true);
  });

  test('README.md file exists in doc directory', () => {
    const readmePath = path.join(docPath, 'README.md');
    expect(fs.existsSync(readmePath)).toBe(true);
  });

  test('all TypeScript files have corresponding markdown files', () => {
    const findTsFiles = (dir: string): string[] => {
      const files: string[] = [];
      const walk = (currentDir: string) => {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            files.push(path.relative(srcPath, fullPath));
          }
        }
      };
      walk(dir);
      return files;
    };

    const tsFiles = findTsFiles(srcPath);
    
    tsFiles.forEach(tsFile => {
      const mdFile = tsFile.replace('.ts', '.md');
      const mdPath = path.join(docPath, mdFile);
      expect(fs.existsSync(mdPath)).toBe(true);
    });
  });

  test('sample documentation file has correct structure', () => {
    const samplePath = path.join(docPath, 'app', 'AppService.md');
    if (fs.existsSync(samplePath)) {
      const content = fs.readFileSync(samplePath, 'utf-8');
      
      // Check for required sections
      expect(content).toContain('# AppService.ts');
      expect(content).toContain('**File Path:**');
      expect(content).toContain('## Purpose');
      expect(content).toContain('## Dependencies');
      
      // Check that it's not empty
      expect(content.length).toBeGreaterThan(100);
    }
  });

  test('index.md contains navigation links', () => {
    const indexPath = path.join(docPath, 'index.md');
    if (fs.existsSync(indexPath)) {
      const content = fs.readFileSync(indexPath, 'utf-8');
      
      expect(content).toContain('# Documentation Index');
      expect(content).toContain('## File Structure');
      expect(content).toContain('## Statistics');
      expect(content).toContain('- **Total Files:**');
      
      // Should contain some navigation links
      expect(content).toMatch(/\[.*\.ts\]\(.*\.md\)/);
    }
  });
});