// IC 2026-09-25 P9 — single source of truth for "which database migration
// does this commit expect?". Used by vite.config.ts (emitted into
// /version.json) and by .github/workflows/deploy.yml (verified against the
// remote migration history BEFORE the frontend goes live).
//
//   node scripts/ci/migration-target.mjs          → prints e.g. 20261011000004
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Highest migration version (the 14-digit prefix) in supabase/migrations. */
export function latestMigrationVersion(dir = join(root, 'supabase', 'migrations')) {
  let files = [];
  try { files = readdirSync(dir); } catch { return 'unknown'; }
  const versions = files
    .map((f) => /^(\d{14})_.*\.sql$/.exec(f)?.[1])
    .filter(Boolean)
    .sort();
  return versions.at(-1) ?? 'unknown';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.stdout.write(latestMigrationVersion() + '\n');
}
