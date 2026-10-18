// Regression coverage for deterministic PostgreSQL migration failures in the
// deploy wrapper. The fake CLI never reaches a network or a real Supabase DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const script = join(root, 'scripts/ci/supabase-link-and-push.sh');

test('42P07 duplicate relation is reported and not retried', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'supabase-migration-error-'));
  try {
    const bin = join(cwd, 'bin');
    mkdirSync(bin);
    const calls = join(cwd, 'calls');
    const sleeps = join(cwd, 'sleeps');
    writeFileSync(sleeps, '');
    writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash
printf '{"status":"ACTIVE_HEALTHY"}'
`, { mode: 0o755 });
    writeFileSync(join(bin, 'sleep'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$SLEEPS"
`, { mode: 0o755 });
    writeFileSync(join(bin, 'supabase'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CALLS"
if [[ "$1" == "db" && "$2" == "push" ]]; then
  echo 'Applying migration 20261028000000_construction_projects.sql...'
  echo 'ERROR: relation "projects" already exists (SQLSTATE 42P07)'
  exit 1
fi
exit 0
`, { mode: 0o755 });

    const password = 'not-a-real-production-password';
    const result = spawnSync('bash', [script], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        SUPABASE_ACCESS_TOKEN: 'fake-token',
        SUPABASE_PROJECT_REF: 'fake-ref',
        SUPABASE_DB_PASSWORD: password,
        SUPABASE_ENV_LABEL: 'production',
        CALLS: calls,
        SLEEPS: sleeps,
      },
    });

    assert.notEqual(result.status, 0, 'migration collision must fail the deploy');
    assert.match(result.stdout, /SQLSTATE 42P07/);
    assert.match(result.stdout, /20261028000000_construction_projects\.sql/);
    assert.match(result.stdout, /public\.construction_projects/);
    assert.match(result.stdout, /not retrying/i);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(password));
    assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n'), [
      'link --project-ref fake-ref --password not-a-real-production-password',
      'db push --password not-a-real-production-password --include-all',
    ]);
    assert.equal(readFileSync(sleeps, 'utf8').trim(), '');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
