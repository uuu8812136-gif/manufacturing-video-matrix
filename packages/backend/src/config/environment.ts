import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/**
 * Find the pnpm workspace root so every launch mode reads the same .env file.
 * `pnpm --filter` changes cwd to packages/backend, while Docker starts at /app.
 */
export function findWorkspaceRoot(start = process.cwd()): string {
  let current = resolve(start);
  while (true) {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

export function rootEnvFile(start = process.cwd()): string {
  return join(findWorkspaceRoot(start), '.env');
}

