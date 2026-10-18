// Execute scripts/ci/supabase-link-and-push.sh with a fake `supabase` CLI and a
// fake `curl`, so the collision handling is tested without a project, a
// database, credentials or network.
//
// WHY THIS EXISTS
// ---------------
// On 2026-10-18 the production deploy (Deploy #224, run 39118959766) failed with
//
//   ERROR: relation "projects" already exists (SQLSTATE 42P07)
//
// and then did it twice more, because the script treated an object collision as
// a transport failure and spent its whole retry budget on an error that cannot
// change between attempts. The log named the object but not what the object IS,
// which is the only thing that separates the two possible causes:
//   * this migration's own objects, applied by hand outside `supabase db push`
//     (live objects, no row in supabase_migrations.schema_migrations) — the
//     migration has to converge on them, and
//   * a foreign object that owns the name — an owner decision, never something a
//     deploy may adopt, rename or drop.
// These tests pin the behaviour that came out of that incident: stop on the
// first collision, name the file and object, print the live shape from the
// read-only Management API, keep retrying genuine transport failures, and never
// repair migration history on a collision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(new URL('../../', import.meta.url).pathname);
const pushScript = join(repoRoot, 'scripts/ci/supabase-link-and-push.sh');
const forensicsScript = join(repoRoot, 'scripts/ci/migration-conflict-forensics.sh');

assert.ok(existsSync(pushScript), 'scripts/ci/supabase-link-and-push.sh is missing');
assert.ok(existsSync(forensicsScript), 'scripts/ci/migration-conflict-forensics.sh is missing');

/** The exact production failure text, trimmed to the lines the script reads. */
const COLLISION_OUTPUT = `Connecting to remote database...
Do you want to push these migrations to the remote database?
 • 20261028000000_construction_projects.sql

 [Y/n]
Applying migration 20261028000000_construction_projects.sql...
ERROR: relation "projects" already exists (SQLSTATE 42P07)
At statement: 0
Try rerunning the command with --debug to troubleshoot the error.
`;

const COLUMN_COLLISION_OUTPUT = `Applying migration 20261030000000_construction_project_boq.sql...
ERROR: column "boq_locked_at" of relation "projects" already exists (SQLSTATE 42701)
`;

const TRANSPORT_OUTPUT = `Connecting to remote database...
failed to connect to postgres: failed to receive message (timeout: context deadline exceeded)
`;

/** What the Management API returns for the live `public.projects` on production. */
const SHAPE_RESPONSE = JSON.stringify([{
  qualified_name: 'public.projects',
  relkind: 'r',
  column_count: 13,
  columns: 'id uuid NOT NULL, business_id uuid NOT NULL, name text NOT NULL, status text NOT NULL',
  rls_enabled: true,
  policy_count: 1,
  constraint_count: 7,
  index_count: 3,
  trigger_count: 0,
  approx_rows: 0,
  version_recorded: 0,
  remote_head: '20261027000000',
}]);

const HISTORY_RESPONSE = JSON.stringify([
  { version: '20261027000000', name: 'construction_operating_model_defaults.sql' },
  { version: '20261026000000', name: 'construction_return_command.sql' },
]);

function fakeBin(dir, { pushOutput, pushExit = 1 }) {
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'bin/supabase'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CALLS"
case "$1" in
  link) exit 0 ;;
  db)   printf '%s' "$PUSH_OUTPUT"; exit ${pushExit} ;;
  migration) exit 0 ;;
esac
exit 0
`, { mode: 0o755 });
  // Stands in for the Management API: project status (GET, stdout) and the
  // read-only SQL endpoint (POST, -o file) the forensics script uses.
  writeFileSync(join(dir, 'bin/curl'), `#!/usr/bin/env bash
out=""; prev=""; payload=""
for arg in "$@"; do
  case "$prev" in
    -o) out="$arg" ;;
    -d) payload="$arg" ;;
  esac
  prev="$arg"
done
printf '%s\\n' "$*" >> "$CALLS"
case "$payload" in
  *pg_attribute*)   printf '%s' "$SHAPE_RESPONSE" > "$out"; exit 0 ;;
  *schema_migrations*) printf '%s' "$HISTORY_RESPONSE" > "$out"; exit 0 ;;
esac
printf '%s' '{"status":"ACTIVE_HEALTHY"}'
exit 0
`, { mode: 0o755 });
  writeFileSync(join(dir, 'push-output.txt'), pushOutput);
}

function run(dir, extraEnv = {}) {
  const summary = join(dir, 'step-summary.md');
  const calls = join(dir, 'calls');
  const result = spawnSync('bash', ['--noprofile', '--norc', pushScript], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`,
      SUPABASE_ACCESS_TOKEN: 'sbp_test_token',
      SUPABASE_PROJECT_REF: 'hsuhuvuxfuufrlejsatw',
      SUPABASE_DB_PASSWORD: 'test-password',
      SUPABASE_ENV_LABEL: 'production',
      PUSH_OUTPUT: readFileSync(join(dir, 'push-output.txt'), 'utf8'),
      SHAPE_RESPONSE,
      HISTORY_RESPONSE,
      CALLS: calls,
      GITHUB_STEP_SUMMARY: summary,
      ...extraEnv,
    },
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    calls: existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [],
    summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '',
  };
}

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'migration-collision-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('an object collision stops the first attempt instead of burning the retry budget', () => {
  withTempDir((dir) => {
    fakeBin(dir, { pushOutput: COLLISION_OUTPUT });
    const run1 = run(dir);
    assert.equal(run1.status, 1, 'the push must still fail the job');
    const pushes = run1.calls.filter((line) => line.startsWith('db push'));
    assert.equal(pushes.length, 1, `expected exactly one db push attempt, got ${pushes.length}`);
    assert.ok(
      !run1.calls.some((line) => line.startsWith('migration repair')),
      'a collision must never be answered by rewriting migration history',
    );
  });
});

test('the collision annotation names the file, the object and the fix', () => {
  withTempDir((dir) => {
    fakeBin(dir, { pushOutput: COLLISION_OUTPUT });
    const { stdout } = run(dir);
    assert.match(stdout, /::error::.*20261028000000_construction_projects\.sql/s);
    assert.match(stdout, /relation "projects" already existing \(SQLSTATE 42P07\)/);
    assert.match(stdout, /not recorded in supabase_migrations\.schema_migrations/);
    assert.match(stdout, /Not retrying: every attempt reproduces this identically\./);
    assert.match(stdout, /IF NOT EXISTS/);
    assert.match(stdout, /DEPLOYMENT\.md/);
    // The database password must never reach a log line.
    assert.ok(!stdout.includes('test-password'), 'the database password leaked into the log');
  });
});

test('the collision report shows what the live object actually is', () => {
  withTempDir((dir) => {
    fakeBin(dir, { pushOutput: COLLISION_OUTPUT });
    const { stdout, summary } = run(dir);
    assert.match(stdout, /Live database forensics for the collision on relation "projects"/);
    assert.match(stdout, /Columns \(13\): id uuid NOT NULL, business_id uuid NOT NULL/);
    assert.match(stdout, /RLS enabled: true\s+policies: 1/);
    assert.match(
      stdout,
      /Version 20261028000000 recorded in supabase_migrations\.schema_migrations: false/,
    );
    assert.match(stdout, /Remote migration head: 20261027000000/);
    assert.match(stdout, /VERDICT: the object is live but its migration version is NOT recorded/);
    assert.match(stdout, /supabase migration repair --status applied 20261028000000/);
    assert.match(stdout, /ALTER TABLE public\.projects RENAME TO legacy_projects_pre_construction;/);
    assert.match(stdout, /Most recent recorded versions on this project:/);
    assert.match(summary, /### Migration collision forensics \(hsuhuvuxfuufrlejsatw\)/);
  });
});

test('a column collision is reported with its table and does not retry', () => {
  withTempDir((dir) => {
    fakeBin(dir, { pushOutput: COLUMN_COLLISION_OUTPUT });
    const run1 = run(dir);
    assert.equal(run1.status, 1);
    assert.equal(run1.calls.filter((line) => line.startsWith('db push')).length, 1);
    assert.match(run1.stdout, /column "projects\.boq_locked_at" already existing \(SQLSTATE 42701\)/);
    assert.match(run1.stdout, /20261030000000_construction_project_boq\.sql/);
  });
});

test('a transport failure still gets the full retry budget', () => {
  withTempDir((dir) => {
    fakeBin(dir, { pushOutput: TRANSPORT_OUTPUT });
    const run1 = run(dir, { SUPABASE_PUSH_RETRY_WAIT: '0' });
    assert.equal(run1.status, 1);
    assert.equal(
      run1.calls.filter((line) => line.startsWith('db push')).length,
      3,
      'a pooler timeout must still be retried three times',
    );
    assert.match(run1.stdout, /supabase db push failed after 3 attempts for production/);
    assert.ok(
      !run1.stdout.includes('Live database forensics'),
      'forensics belongs to collisions, not to transport failures',
    );
  });
});

test('forensics is best effort: it never fails the job and never writes', () => {
  withTempDir((dir) => {
    mkdirSync(join(dir, 'bin'), { recursive: true });
    // No curl at all: the report degrades to a note and the exit code stays 0.
    writeFileSync(join(dir, 'bin/curl'), '#!/usr/bin/env bash\nexit 7\n', { mode: 0o755 });
    const result = spawnSync('bash', ['--noprofile', '--norc', forensicsScript,
      'relation', 'projects', '20261028000000_construction_projects.sql', '20261028000000'], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: {
        PATH: `${join(dir, 'bin')}:/usr/bin:/bin`,
        SUPABASE_ACCESS_TOKEN: 'sbp_test_token',
        SUPABASE_PROJECT_REF: 'hsuhuvuxfuufrlejsatw',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Management API refused the read-only shape query|No shape row returned/);
  });
});

test('forensics refuses to interpolate anything but a bare identifier', () => {
  withTempDir((dir) => {
    mkdirSync(join(dir, 'bin'), { recursive: true });
    writeFileSync(join(dir, 'bin/curl'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CALLS"
exit 0
`, { mode: 0o755 });
    for (const hostile of ["projects'; DROP TABLE public.businesses; --", 'public.projects', 'a"b']) {
      const calls = join(dir, `calls-${Buffer.from(hostile).toString('hex').slice(0, 12)}`);
      const result = spawnSync('bash', ['--noprofile', '--norc', forensicsScript,
        'relation', hostile, 'file.sql', '20261028000000'], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          PATH: `${join(dir, 'bin')}:/usr/bin:/bin`,
          SUPABASE_ACCESS_TOKEN: 'sbp_test_token',
          SUPABASE_PROJECT_REF: 'hsuhuvuxfuufrlejsatw',
          CALLS: calls,
        },
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /not a bare SQL identifier/);
      assert.ok(
        !existsSync(calls),
        `a hostile object name reached curl: ${hostile}`,
      );
    }
  });
});

test('forensics is skipped silently without credentials', () => {
  const result = spawnSync('bash', ['--noprofile', '--norc', forensicsScript,
    'relation', 'projects', 'file.sql', '20261028000000'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Collision forensics skipped/);
});
