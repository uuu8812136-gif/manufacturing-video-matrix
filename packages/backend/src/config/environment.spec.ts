import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findWorkspaceRoot, rootEnvFile } from './environment';

describe('environment path resolution', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('uses the workspace root from a filtered package cwd', () => {
    const root = mkdtempSync(join(tmpdir(), 'mvms-env-'));
    dirs.push(root);
    writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n");
    mkdirSync(join(root, 'packages', 'backend'), { recursive: true });

    expect(findWorkspaceRoot(join(root, 'packages', 'backend'))).toBe(root);
    expect(rootEnvFile(join(root, 'packages', 'backend'))).toBe(join(root, '.env'));
  });
});
