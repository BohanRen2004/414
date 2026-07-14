import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function tsFiles(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? tsFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('rule-core boundary', () => {
  it('contains no Cocos imports', () => {
    const root = 'client/assets/scripts/core';
    for (const file of tsFiles(root)) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/from\s+['"]cc['"]/);
    }
  });
});
