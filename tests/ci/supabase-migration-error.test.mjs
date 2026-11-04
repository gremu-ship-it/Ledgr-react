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

test('55000 namespace guard is reported and not retried', () => {
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
    // Emit the pre-fix namespace guard exactly as `supabase db push`
    // reported it on staging (project status ACTIVE_HEALTHY).
    writeFileSync(join(bin, 'supabase'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CALLS"
if [[ "$1" == "db" && "$2" == "push" ]]; then
  echo 'Applying migration 20261028000001_construction_projects_namespace.sql...'
  echo 'ERROR: Cannot namespace construction projects: public.projects is not the known Phase A table. Preserve it and reconcile the migration state before retrying. (SQLSTATE 55000)'
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
        SUPABASE_ENV_LABEL: 'staging',
        CALLS: calls,
        SLEEPS: sleeps,
      },
    });

    assert.notEqual(result.status, 0, 'namespace guard must fail the deploy');
    assert.match(result.stdout, /SQLSTATE 55000/);
    assert.match(result.stdout, /namespace guard/);
    assert.match(result.stdout, /diagnose-projects-namespace\.sql/);
    assert.match(result.stdout, /not retrying/i);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(password));
    // Fail fast: exactly one push attempt and no retry sleeps.
    assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n'), [
      'link --project-ref fake-ref --password not-a-real-production-password',
      'db push --password not-a-real-production-password --include-all',
    ]);
    assert.equal(readFileSync(sleeps, 'utf8').trim(), '');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The 2026-10-18 false positive. Production runs 39128722410 and 39131240114
// were annotated
//
//   supabase db push for production hit SQLSTATE 42P07: relation
//   project_status_log already exists while applying
//   20261028000000_construction_projects.sql. This is deterministic; not
//   retrying.
//
// That text was produced by the wrapper. It is not proof of the server's
// SQLSTATE: the phrase
// `relation "project_status_log" already exists` is the NOTICE that
// `CREATE TABLE IF NOT EXISTS public.project_status_log` prints when the
// relation is already live. The SQLSTATE was hardcoded in the annotation and
// the branch
// exited without printing whatever the push had actually failed on. Both cases
// below reproduce that annotation from synthetic outputs with a different
// failure. Without the remote raw log, the actual production failure is unknown.
// ---------------------------------------------------------------------------

/** Run the wrapper against a fake `supabase`/`curl`/`sleep` and return the result. */
function runWrapper(pushOutput, { label = 'production', pushExit = 1, password = 'not-a-real-production-password', forensics = '0', autoRepair = '1' } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'supabase-migration-error-'));
  const bin = join(cwd, 'bin');
  mkdirSync(bin);
  const calls = join(cwd, 'calls');
  const sleeps = join(cwd, 'sleeps');
  writeFileSync(sleeps, '');
  writeFileSync(join(cwd, 'push-output.txt'), pushOutput);
  writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash
printf '{"status":"ACTIVE_HEALTHY"}'
`, { mode: 0o755 });
  writeFileSync(join(bin, 'sleep'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$SLEEPS"
`, { mode: 0o755 });
  writeFileSync(join(bin, 'supabase'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$CALLS"
if [[ "$1" == "db" && "$2" == "push" ]]; then
  cat "$PUSH_OUTPUT"
  exit ${pushExit}
fi
exit 0
`, { mode: 0o755 });
  const summaryPath = join(cwd, 'summary.md');
  writeFileSync(summaryPath, '');
  try {
    const result = spawnSync('bash', [script], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        SUPABASE_ACCESS_TOKEN: 'fake-token',
        SUPABASE_PROJECT_REF: 'hsuhuvuxfuufrlejsatw',
        SUPABASE_DB_PASSWORD: password,
        SUPABASE_ENV_LABEL: label,
        SUPABASE_MIGRATION_FORENSICS: forensics,
        SUPABASE_MIGRATION_AUTO_REPAIR: autoRepair,
        GITHUB_STEP_SUMMARY: summaryPath,
        CALLS: calls,
        SLEEPS: sleeps,
        PUSH_OUTPUT: join(cwd, 'push-output.txt'),
      },
    });
    return {
      ...result,
      password,
      attempts: readFileSync(calls, 'utf8').split('\n').filter((line) => line.startsWith('db push')).length,
      sleeps: readFileSync(sleeps, 'utf8').trim(),
      calls: readFileSync(calls, 'utf8'),
      summary: readFileSync(summaryPath, 'utf8'),
    };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

const SKIP_NOTICE = 'NOTICE: relation "project_status_log" already exists, skipping';

test('a convergent IF NOT EXISTS skip is not reported as a 42P07 collision', () => {
  const result = runWrapper(`Connecting to remote database...
Do you want to push these migrations to the remote database?
 • 20261028000000_construction_projects.sql
 • 20261030000000_construction_project_boq.sql
 • 20261103000000_manufacturing_foundation.sql

 [Y/n]
Applying migration 20261028000000_construction_projects.sql...
${SKIP_NOTICE}
ERROR: column "project_id" does not exist (SQLSTATE 42703)
CREATE INDEX IF NOT EXISTS project_status_log_project ON public.project_status_log(project_id,changed_at)
At statement: 12
Try rerunning the command with --debug to troubleshoot the error.
`);

  assert.notEqual(result.status, 0, 'the real failure must still fail the deploy');
  // The lie this regression pins: a hardcoded SQLSTATE and the noticed object.
  assert.doesNotMatch(result.stdout, /SQLSTATE 42P07/);
  assert.doesNotMatch(result.stdout, /relation project_status_log already exists/);
  // The truth: the server's SQLSTATE, message, statement and position.
  assert.match(result.stdout, /SQLSTATE 42703/);
  assert.match(result.stdout, /column "project_id" does not exist/);
  assert.match(result.stdout, /CREATE INDEX IF NOT EXISTS project_status_log_project ON public\.project_status_log\(project_id,changed_at\)/);
  assert.match(result.stdout, /20261028000000_construction_projects\.sql at statement 12/);
  assert.match(result.stdout, /not retrying/i);
  assert.equal(result.attempts, 1, 'a schema error fails fast: one attempt');
  assert.equal(result.sleeps, '');
  assert.doesNotMatch(result.calls, /migration repair/, 'history must never be repaired on a schema failure');
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(result.password));
});

test('a convergent skip notice plus a transport failure keeps its three retries', () => {
  const result = runWrapper(`Connecting to remote database...
Applying migration 20261028000000_construction_projects.sql...
${SKIP_NOTICE}
failed to connect to postgres: failed to receive message (timeout: context deadline exceeded)
`);

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /SQLSTATE 42P07/, 'a notice is not a collision');
  assert.doesNotMatch(result.stdout, /deterministic/i);
  assert.match(result.stdout, /transient or unclassified failure/);
  assert.match(result.stdout, /context deadline exceeded/, 'the real cause must be printed');
  assert.equal(result.attempts, 3, 'transient transport failures keep the retry budget');
  assert.equal(result.sleeps.split('\n').length, 2);
});

test('a genuine duplicate relation is still reported once, with its own SQLSTATE', () => {
  const result = runWrapper(`Applying migration 20261028000000_construction_projects.sql...
ERROR: relation "projects" already exists (SQLSTATE 42P07)
At statement: 0
`);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /SQLSTATE 42P07/);
  assert.match(result.stdout, /relation "projects" already exists/);
  assert.match(result.stdout, /public\.construction_projects/);
  assert.match(result.stdout, /not retrying/i);
  assert.equal(result.attempts, 1);
  assert.equal(result.sleeps, '');
});

test('a duplicate column is attributed to its relation and never marks history applied', () => {
  const result = runWrapper(`Applying migration 20261030000000_construction_project_boq.sql...
ERROR: column "boq_locked_at" of relation "construction_projects" already exists (SQLSTATE 42701)
At statement: 0
`);

  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /SQLSTATE 42701/);
  assert.match(result.stdout, /20261030000000_construction_project_boq\.sql/);
  assert.match(result.stdout, /column "boq_locked_at" of relation "construction_projects"/);
  assert.doesNotMatch(result.calls, /migration repair/);
  assert.equal(result.attempts, 1);
});

for (const code of ['40001', '40P01', '55P03', '08006']) {
  test(`transient PostgreSQL SQLSTATE ${code} retains its retry budget`, () => {
    const result = runWrapper(`Applying migration 20261028000000_construction_projects.sql...
${SKIP_NOTICE}
ERROR: synthetic transient database condition (SQLSTATE ${code})
`);
    assert.equal(result.attempts, 3);
    assert.equal(result.sleeps.split('\n').length, 2);
    assert.match(result.stdout, new RegExp(`SQLSTATE ${code}`));
    assert.doesNotMatch(result.stdout, /SQLSTATE 42P07/);
    assert.doesNotMatch(result.calls, /migration repair/);
  });
}

test('notice-only successful pushes stay successful', () => {
  const result = runWrapper(`Applying migration 20261028000000_construction_projects.sql...
${SKIP_NOTICE}
Finished supabase db push.
`, { pushExit: 0 });
  assert.equal(result.status, 0);
  assert.equal(result.attempts, 1);
  assert.doesNotMatch(result.stdout, /::error::/);
});

test('a notice before a later genuine collision cannot steal the object name or migration', () => {
  const result = runWrapper(`Applying migration 20261028000000_construction_projects.sql...
${SKIP_NOTICE}
Applying migration 20261030000000_construction_project_boq.sql...
ERROR: relation "project_boq_lines" already exists (SQLSTATE 42P07)
At statement: 1
`);
  assert.equal(result.attempts, 1);
  const heading = result.stdout.split('\n').find((line) => line.startsWith('::error::supabase db push'));
  assert.match(heading, /20261030000000_construction_project_boq\.sql/);
  assert.match(heading, /project_boq_lines/);
  assert.doesNotMatch(heading, /project_status_log/);
});

test('SQL error context with history-repair hints never triggers automatic history repair', () => {
  const result = runWrapper(`Remote migration versions not found in local migrations directory.
supabase migration repair --status reverted 20261028000000
Applying migration 20261028000000_construction_projects.sql...
ERROR: relation "project_status_log" already exists (SQLSTATE 42P07)
At statement: 1
`);
  assert.equal(result.attempts, 1);
  assert.doesNotMatch(result.calls, /migration repair/);
  assert.match(result.summary, /relation "project_status_log" already exists/);
});

test('annotations, streamed output and summary redact literal credentials and escape workflow commands', () => {
  const password = 'fake*password[with]glob?';
  const result = runWrapper(`Applying migration 20261028000000_construction_projects.sql...
\u001b[31mERROR: synthetic failure ${password} fake-token (SQLSTATE 42703)\u001b[0m
At statement: 9
select 'a::uuid';
::warning::synthetic command must not be interpreted
`, { password });
  assert.equal(result.attempts, 1);
  assert.ok(!result.stdout.includes(password));
  assert.ok(!result.summary.includes(password));
  assert.ok(!result.stdout.includes('fake-token'));
  assert.ok(!result.summary.includes('fake-token'));
  assert.match(result.stdout, /SQLSTATE 42703/);
  assert.doesNotMatch(result.stdout, /^::warning::synthetic/m);
  assert.match(result.summary, /At statement: 9/);
});

test('an unavailable inspection never masks the original schema error or implies ownership', () => {
  const result = runWrapper(`Applying migration 20261028000000_construction_projects.sql...
ERROR: relation "project_status_log" already exists (SQLSTATE 42P07)
At statement: 1
`, { forensics: '1' });
  assert.equal(result.status, 1);
  assert.equal(result.attempts, 1);
  assert.match(result.stdout, /SQLSTATE 42P07/);
  assert.match(result.summary, /UNKNOWN: relations inspection failed/);
  assert.doesNotMatch(result.calls, /migration repair/);
});


test('production workflow disables history repair even for a genuine remote-only drift hint', () => {
  const workflow = readFileSync(join(root, '.github/workflows/deploy.yml'), 'utf8');
  const production = workflow.split('  deploy-production:\n')[1].split('    steps:')[0];
  const flag = production.match(/^ +SUPABASE_MIGRATION_AUTO_REPAIR: ['"]?([01])['"]?$/m)?.[1];
  assert.equal(flag, '0');
  const result = runWrapper(`Remote migration versions not found in local migrations directory.
supabase migration repair --status reverted 20261028000000
`, { autoRepair: flag });
  assert.equal(result.status, 1);
  assert.equal(result.attempts, 1);
  assert.equal(result.sleeps, '');
  assert.doesNotMatch(result.calls, /^migration repair/m);
  assert.match(result.stdout, /Auto-repair is disabled/);
  assert.match(result.stdout, /Stop for owner review/);
});
