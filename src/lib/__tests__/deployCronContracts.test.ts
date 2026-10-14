import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * 2026-10-14 staging MIXED-VERSION — contracts for the fix.
 *
 * The staging deploy of bac5694 migrated the database and deployed the edge
 * functions, then skipped the frontend because the un-instrumented pg_cron
 * step failed on `retry-failed-webhooks-daily` — a placeholder job from
 * 20260820000000 that scripts/cron-jobs.sql never scheduled. It had failed
 * that way on every staging deploy since 2026-10-09. The jobs cron-jobs.sql
 * did reschedule stayed inactive, because cron.schedule() never resets
 * `active`. tests/database/cron_jobs_apply.test.js proves the behaviour on
 * Postgres; these are the static/script-level guarantees CI checks on every
 * pull request.
 */
const read = (p: string) => readFileSync(p, 'utf8');
const REPO_ROOT = resolve('.');
const wf = read('.github/workflows/deploy.yml');
const cronSql = read('scripts/cron-jobs.sql');
const applyScript = read('scripts/ci/apply-cron-jobs.sh');

const uncommented = (sql: string) =>
  sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n');

/** Job names scheduled by scripts/cron-jobs.sql (same rule as apply-cron-jobs.sh). */
const cronSqlJobs = [...uncommented(cronSql).matchAll(/cron\.schedule\(\s*'([^']+)'/g)].map((m) => m[1]);

/**
 * Replays every cron.schedule / cron.unschedule in the migrations, in order,
 * and returns the jobs whose final command still holds a deploy-time
 * placeholder — i.e. the jobs the deploy must reschedule.
 */
function placeholderJobsLeftByMigrations(): Map<string, string> {
  const jobs = new Map<string, { command: string; file: string }>();
  const files = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort();
  // Between the schedule literal and the dollar-quoted command: whitespace and
  // whole `-- ...` comment lines (each consumed through its newline, so the
  // repetition is unambiguous — no catastrophic backtracking).
  const schedule = /cron\.schedule\(\s*'([^']+)'\s*,\s*'[^']*'\s*,(?:\s|--[^\n]*\n)*\$(\w*)\$([\s\S]*?)\$\2\$/g;
  const unschedule = /cron\.unschedule\(\s*'([^']+)'\s*\)/g;
  for (const file of files) {
    const sql = read(join('supabase/migrations', file));
    const events = [
      ...[...sql.matchAll(schedule)].map((m) => ({ at: m.index ?? 0, name: m[1], command: m[3] as string | null })),
      ...[...sql.matchAll(unschedule)].map((m) => ({ at: m.index ?? 0, name: m[1], command: null as string | null })),
    ].sort((a, b) => a.at - b.at);
    for (const ev of events) {
      if (ev.command === null) jobs.delete(ev.name);
      else jobs.set(ev.name, { command: ev.command, file });
    }
  }
  const left = new Map<string, string>();
  for (const [name, { command, file }] of jobs) {
    if (/<PROJECT_REF>|<CRON_SECRET>/.test(command)) left.set(name, file);
  }
  return left;
}

/** Text of one job in deploy.yml. */
function job(env: 'staging' | 'production'): string {
  const start = wf.indexOf(`\n  deploy-${env}:\n`);
  expect(start, `job deploy-${env} not found`).toBeGreaterThan(0);
  const next = wf.indexOf('\n  deploy-', start + 1);
  return wf.slice(start, next === -1 ? undefined : next);
}

/** Text of the step with the given id, from its "- name:" line to the next step. */
function step(env: 'staging' | 'production', id: string): string {
  const j = job(env);
  const at = j.indexOf(`\n        id: ${id}\n`);
  expect(at, `step id "${id}" not found in deploy-${env}`).toBeGreaterThan(0);
  const begin = j.lastIndexOf('\n      - ', at);
  const end = j.indexOf('\n      - ', at + 1);
  return j.slice(begin, end === -1 ? undefined : end);
}

/** The literal `run: |` block of a step, dedented. */
function runBlock(stepText: string): string {
  const lines = stepText.split('\n');
  const from = lines.findIndex((l) => /^ {8}run: \|\s*$/.test(l));
  expect(from, 'step has no "run: |" block').toBeGreaterThan(-1);
  const body: string[] = [];
  for (const l of lines.slice(from + 1)) {
    if (l.trim() !== '' && !l.startsWith(' '.repeat(10))) break;
    body.push(l.slice(10));
  }
  return body.join('\n');
}

const ifOf = (stepText: string) => {
  const m = /\n {8}if: (?:>-\n((?: {10}[^\n]*\n)+)|([^\n]*))/.exec(stepText);
  return (m?.[1] ?? m?.[2] ?? '').replace(/\s+/g, ' ').trim();
};

// ── scripts/cron-jobs.sql ───────────────────────────────────────────────────
describe('scripts/cron-jobs.sql covers every placeholder job the migrations leave behind', () => {
  it('reschedules each HTTP job whose migration command still holds <PROJECT_REF>/<CRON_SECRET>', () => {
    const left = placeholderJobsLeftByMigrations();
    // The 2026-10-14 incident: 20260820000000's job was missing here.
    expect([...left.keys()]).toContain('retry-failed-webhooks-daily');
    for (const [name, file] of left) {
      expect(cronSqlJobs, `${name} (from ${file}) holds a placeholder that nothing substitutes — add a cron.schedule() for it to scripts/cron-jobs.sql, or every deploy fails`).toContain(name);
    }
  });

  it('does not take back the in-database expiry sweep (20261017000000 §5)', () => {
    expect(placeholderJobsLeftByMigrations().has('expire-subscriptions-daily')).toBe(false);
    expect(cronSqlJobs).not.toContain('expire-subscriptions-daily');
  });

  it('re-enables exactly the jobs it schedules (cron.schedule() never resets `active`)', () => {
    const body = uncommented(cronSql);
    const reenable = body.slice(body.indexOf('cron.alter_job('));
    expect(reenable).toMatch(/cron\.alter_job\(jobid, null, null, null, null, true\)/);
    expect(reenable).toMatch(/username = current_user/);
    const listed = [...(/jobname in \(([^)]*)\)/.exec(reenable)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(new Set(listed)).toEqual(new Set(cronSqlJobs));
    expect(body.lastIndexOf('cron.schedule(')).toBeLessThan(body.indexOf('cron.alter_job('));
  });
});

// ── scripts/ci/apply-cron-jobs.sh ───────────────────────────────────────────
describe('apply-cron-jobs.sh verification', () => {
  const placeholderCheck = applyScript.slice(
    applyScript.indexOf("cat > \"${placeholder_file}\" <<'SQL'"),
    applyScript.indexOf('\nSQL\n', applyScript.indexOf("cat > \"${placeholder_file}\" <<'SQL'")),
  );

  it('fails on a placeholder in ANY job — an inactive placeholder job is one cron-jobs.sql forgot, not one to ignore', () => {
    expect(placeholderCheck).toContain("command like '%<PROJECT_REF>%'");
    expect(placeholderCheck).toContain("command like '%<CRON_SECRET>%'");
    expect(placeholderCheck).not.toMatch(/\bactive\b\s*(is|=)/);
  });

  it('also fails when a job cron-jobs.sql schedules is missing or inactive', () => {
    expect(applyScript).toMatch(/where j\.jobid is null\s+or j\.active is not true/);
    expect(applyScript).toMatch(/exit "\$\{failed\}"/);
  });
});

// ── deploy.yml ──────────────────────────────────────────────────────────────
describe('deploy.yml: post-migration maintenance cannot strand the frontend', () => {
  for (const env of ['staging', 'production'] as const) {
    it(`${env}: the frontend is gated on build + migrate + verified target + edge functions only`, () => {
      const gate = ifOf(step(env, 'frontend'));
      for (const cond of [
        'always()',
        '!cancelled()',
        "steps.build.outcome == 'success'",
        "steps.migrate.outcome == 'success'",
        "steps.verify_migration.outcome == 'success'",
        "steps.edge.outcome == 'success'",
      ]) {
        expect(gate, `frontend gate lacks ${cond}`).toContain(cond);
      }
      expect(gate).not.toContain('steps.cron');
      expect(gate).not.toMatch(/\|\|/);
    });

    it(`${env}: every step the gate names exists, before the frontend`, () => {
      const j = job(env);
      const frontendAt = j.indexOf('\n        id: frontend\n');
      for (const id of ['build', 'migrate', 'verify_migration', 'edge', 'cron']) {
        const at = j.indexOf(`\n        id: ${id}\n`);
        expect(at, `step id ${id} missing in deploy-${env}`).toBeGreaterThan(0);
        expect(at).toBeLessThan(frontendAt);
      }
      expect(step(env, 'cron')).toContain('bash scripts/ci/apply-cron-jobs.sh');
    });

    it(`${env}: the version check runs whenever the frontend deployed, and the manifest records cronJobs`, () => {
      expect(ifOf(step(env, 'frontend_verify'))).toBe("${{ always() && !cancelled() && steps.frontend.outcome == 'success' }}");
      expect(job(env)).toContain('OUT_CRON: ${{ steps.cron.outcome }}');
    });
  }

  it('staging and production run the identical version check', () => {
    expect(runBlock(step('production', 'frontend_verify'))).toBe(runBlock(step('staging', 'frontend_verify')));
  });
});

// ── scripts/ci/release-manifest.mjs ─────────────────────────────────────────
type RunResult = { code: number | null; out: string };
function collect(child: ChildProcess): Promise<RunResult> {
  return new Promise((resolve) => {
    let out = '';
    child.stdout?.on('data', (d) => (out += d));
    child.stderr?.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });
}
const childEnv = (env: Record<string, string>) => ({ PATH: process.env.PATH ?? '', ...env });
/** Runs a repo script with node (no shell involved). */
const runNodeScript = (repoPath: string, env: Record<string, string>, cwd: string) =>
  collect(spawn(process.execPath, [join(REPO_ROOT, repoPath)], { cwd, env: childEnv(env) }));
/** Runs a bash script given as text (the run: block taken from deploy.yml). */
const runBashScript = (script: string, env: Record<string, string>) =>
  collect(spawn('bash', ['-c', script], { env: childEnv(env) }));

describe('release manifest', () => {
  const manifest = async (stages: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'ledgr-manifest-'));
    try {
      const res = await runNodeScript('scripts/ci/release-manifest.mjs', {
        ENV_LABEL: 'staging', GITHUB_SHA: 'bac5694', MIGRATION_TARGET: '20261018000000', MIGRATION_REMOTE_HEAD: '20261018000000', ...stages,
      }, dir);
      return { ...res, json: JSON.parse(read(join(dir, 'artifacts/release/release-manifest.json'))) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  const backendShipped = { OUT_MIGRATE: 'success', OUT_VERIFY: 'success', OUT_EDGE: 'success' };

  it('2026-10-14 shape (cron failed → frontend skipped): MIXED-VERSION that names the failed stage', async () => {
    const m = await manifest({ ...backendShipped, OUT_CRON: 'failure', OUT_FRONTEND: 'skipped', OUT_FRONTEND_VERIFY: 'skipped' });
    expect(m.code).toBe(1);
    expect(m.json).toMatchObject({ mixedVersion: true, failedStages: ['cronJobs'] });
    expect(m.json.stages.cronJobs).toBe('failure');
    expect(m.out).toContain('The frontend deploy was SKIPPED because an earlier step failed (failed stage: cronJobs)');
  });

  it('with the new gate (cron failed, frontend shipped): RELEASED, with the failure surfaced', async () => {
    const m = await manifest({ ...backendShipped, OUT_CRON: 'failure', OUT_FRONTEND: 'success', OUT_FRONTEND_VERIFY: 'success' });
    expect(m.code).toBe(0);
    expect(m.json).toMatchObject({ verdict: 'RELEASED', mixedVersion: false, failedStages: ['cronJobs'] });
    expect(m.out).toContain('::warning title=Released with failed stage(s) (staging)::');
    expect(m.out).toContain('| cronJobs | failure |');
  });

  it('a clean release has no failed stages and no warning', async () => {
    const m = await manifest({ ...backendShipped, OUT_CRON: 'success', OUT_FRONTEND: 'success', OUT_FRONTEND_VERIFY: 'success' });
    expect(m.code).toBe(0);
    expect(m.json).toMatchObject({ verdict: 'RELEASED', mixedVersion: false, failedStages: [] });
    expect(m.out).not.toContain('::warning');
  });
});

// ── the version check itself (the run: block from deploy.yml) ───────────────
describe('frontend version check tolerates a lagging production alias', () => {
  const SHA = 'bac56946509dad1cc02ff4525518b1ab1defbf0b';
  const TARGET = '20261018000000';
  const OLD = JSON.stringify({ commit: '5845842aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', migrationTarget: TARGET });
  const NEW = JSON.stringify({ commit: SHA, migrationTarget: TARGET });
  // `sleep 10` between attempts is stubbed out so the test runs in seconds.
  const block = () => `sleep() { :; }\n${runBlock(step('staging', 'frontend_verify'))}`;

  let server: Server;
  let base = '';
  let script: Array<[number, string]> = [];
  let hits = 0;
  beforeAll(async () => {
    server = createServer((_req, res) => {
      const [status, body] = script[Math.min(hits, script.length - 1)];
      hits += 1;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const check = (responses: Array<[number, string]>, url = base) => {
    script = responses;
    hits = 0;
    return runBashScript(block(), { FRONTEND_URL: url, GITHUB_SHA: SHA, MIGRATION_TARGET: TARGET, GITHUB_RUN_ID: '1' });
  };

  it('waits while the alias still serves the previous build, then passes', async () => {
    const r = await check([[200, OLD], [200, OLD], [200, NEW]]);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('Attempt 1/18');
    expect(r.out).toContain('Attempt 2/18');
    expect(r.out).toContain(`Frontend ${SHA} live`);
    expect(hits).toBe(3);
  }, 60_000);

  it('fails, naming both commits, when the alias never moves', async () => {
    const r = await check([[200, OLD]]);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`::error::Deployed frontend reports commit=5845842aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa migrationTarget=${TARGET}; expected ${SHA}`);
    expect(hits).toBe(18);
  }, 60_000);

  it('keeps the old behaviour for a protected URL (unreadable at once → warning, not a failure)', async () => {
    const r = await check([[401, 'Authentication Required']]);
    expect(r.code).toBe(0);
    expect(r.out).toContain('not readable (deployment protection?)');
    expect(hits).toBe(1);
  }, 60_000);

  it('passes immediately when the new build is already live', async () => {
    const r = await check([[200, NEW]]);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain('Attempt');
    expect(hits).toBe(1);
  }, 60_000);
});
