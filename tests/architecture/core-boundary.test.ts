import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

function tsFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? tsFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

function referencesCocos(source: string): boolean {
  const sourceFile = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found = false;

  function isCocosSpecifier(node: ts.Node | undefined): boolean {
    return node !== undefined && ts.isStringLiteralLike(node) && node.text === 'cc';
  }

  function visit(node: ts.Node): void {
    if (found) return;

    if (
      (ts.isImportDeclaration(node) && isCocosSpecifier(node.moduleSpecifier)) ||
      (ts.isExportDeclaration(node) && isCocosSpecifier(node.moduleSpecifier)) ||
      (ts.isImportEqualsDeclaration(node) &&
        ts.isExternalModuleReference(node.moduleReference) &&
        isCocosSpecifier(node.moduleReference.expression)) ||
      (ts.isCallExpression(node) &&
        isCocosSpecifier(node.arguments[0]) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require')))
    ) {
      found = true;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

describe('Cocos module reference detection', () => {
  it.each([
    ['named import declaration', `import { Component } from 'cc';`],
    ['side-effect import declaration', `import 'cc';`],
    ['re-export declaration', `export { Component } from 'cc';`],
    ['dynamic import call', `const cocos = import('cc');`],
    ['CommonJS require call', `const cocos = require('cc');`],
    ['import-equals declaration', `import cocos = require('cc');`],
  ])('detects a %s', (_description, source) => {
    expect(referencesCocos(source)).toBe(true);
  });

  it.each([
    [`const moduleName = 'cc';`],
    [`// import 'cc';\nexport const engine = 'custom';`],
    [`import { helper } from 'cc-helpers';`],
  ])('does not flag harmless source: %s', (source) => {
    expect(referencesCocos(source)).toBe(false);
  });
});

describe('rule-core boundary', () => {
  it('contains no Cocos imports', () => {
    const root = 'client/assets/scripts/core';
    for (const file of tsFiles(root)) {
      expect(referencesCocos(readFileSync(file, 'utf8')), file).toBe(false);
    }
  });
});
