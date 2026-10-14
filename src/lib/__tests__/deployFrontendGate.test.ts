import { afterAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * Regression cover for the 2026-10-14 staging release (run 38534898033),
 * "MIXED-VERSION — FRONTEND NOT UPDATED":
 *
 *   migrate ✓ → verify target ✓ → Edge Functions ✓ → pg_cron reschedule ✗
 *   → Vercel deploy SKIPPED → users left on the previous frontend.
 *
 * The reschedule check failed on 'retry-failed-webhooks-daily', a job that
 * migration 20261017000000 had deliberately deactivated because it still holds
 * a <PROJECT_REF> placeholder. The Vercel step ran under the implicit
 * success() gate, so an independent maintenance step stranded the frontend
 * behind a migrated database. Same failure on 2026-10-09 (run 37896234303).
 */

const ROOT = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const wf = read('.github/workflows/deploy.yml');

const ENVS = ['staging', 'production'] as const;
type Env = (typeof ENVS)[number];

const job = (env: Env) => {
  const staging = wf.indexOf('\n  deploy-staging:');
  const production = wf.indexOf('\n  deploy-production:');
  expect(staging).toBeGreaterThan(0);
  expect(production).toBeGreaterThan(staging);
  return env === 'staging' ? wf.slice(staging, production) : wf.slice(production);
};

/** The text of one step: from its `- name:` line up to the next step. */
const step = (jobText: string, name: string) => {
  const start = jobText.indexOf(`      - name: ${name}\n`);
  if (start < 0) throw new Error(`step not found: ${name}`);
  const next = jobText.slice(start + 1).search(/\n {6}- /);
  return next < 0 ? jobText.slice(start) : jobText.slice(start, start + 1 + next);
};

describe('deploy.yml: the frontend is gated on compatibility, not on maintenance', () => {
  for (const env of ENVS) {
    it(`${env}: Vercel deploys once build, migration, target check and Edge Functions succeeded, whatever pg_cron/Railway did`, () => {
      const j = job(env);
      const deploy = step(j, `Deploy frontend to Vercel (${env})`);
      expect(deploy).toMatch(/if: >-\s+\$\{\{ !cancelled\(\) &&/);
      for (const id of ['build', 'migrate', 'verify_migration', 'edge']) {
        expect(j).toContain(`        id: ${id}\n`);
        expect(deploy).toContain(`steps.${id}.outcome == 'success'`);
      }
      // A maintenance failure must not be able to skip the deploy again.
      expect(deploy).not.toMatch(/steps\.cron|RAILWAY/);
      // Ordering is unchanged: maintenance steps still run before the deploy.
      expect(j.indexOf(`Reschedule pg_cron jobs with real URLs (${env})`)).toBeLessThan(j.indexOf(`Deploy frontend to Vercel (${env})`));
    });

    it(`${env}: the version check follows the deploy and polls the canonical URL`, () => {
      const check = step(job(env), `Verify deployed frontend version (${env})`);
      expect(check).toContain("if: ${{ !cancelled() && steps.frontend.outcome == 'success' }}");
      expect(check).toContain('run: bash scripts/ci/verify-frontend-version.sh');
      expect(check).toContain(`FRONTEND_CANONICAL_URL: \${{ vars.${env === 'staging' ? 'STAGING_URL' : 'PRODUCTION_URL'} }}`);
    });

    it(`${env}: the pg_cron step is identified and reported in the release manifest`, () => {
      const j = job(env);
      expect(step(j, `Reschedule pg_cron jobs with real URLs (${env})`)).toContain('        id: cron\n');
      expect(step(j, `Release manifest (${env})`)).toContain('OUT_CRON: ${{ steps.cron.outcome }}');
    });
  }
});

// ── Script behaviour, executed for real against a fake `curl` on PATH ───────

const scratch = mkdtempSync(join(tmpdir(), 'deploy-gate-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let shimCount = 0;

/** A directory holding an executable `curl` with the given body, first on PATH. */
const fakeCurl = (script: string) => {
  const dir = join(scratch, `shim-${shimCount++}`);
  spawnSync('mkdir', ['-p', dir]);
  writeFileSync(join(dir, 'curl'), `#!/usr/bin/env bash\n${script}\n`);
  chmodSync(join(dir, 'curl'), 0o755);
  return dir;
};

const runScript = (script: string, shimDir: string, env: Record<string, string>) => {
  const res = spawnSync('bash', [join(ROOT, script)], {
    encoding: 'utf8',
    env: {
      PATH: `${shimDir}:${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
      HOME: process.env.HOME ?? scratch,
      ...env,
    },
  });
  return { status: res.status, out: `${res.stdout}${res.stderr}` };
};

const posix = process.platform !== 'win32';

describe.skipIf(!posix)('apply-cron-jobs.sh: only ACTIVE placeholder jobs block a deploy', () => {
  // Management API stand-in: the apply query succeeds; the verify query
  // (the one reading cron.job) returns $VERIFY_BODY.
  const shim = fakeCurl(`
payload=""
while (($#)); do case "$1" in -d) payload="$2"; shift 2;; *) shift;; esac; done
if [[ "$payload" == *"from cron.job"* ]]; then printf '%s\\n200' "$VERIFY_BODY"; else printf '[]\\n201'; fi`);
  const run = (verifyBody: string) => runScript('scripts/ci/apply-cron-jobs.sh', shim, {
    VERIFY_BODY: verifyBody,
    SUPABASE_ACCESS_TOKEN: 'token',
    SUPABASE_PROJECT_REF: 'bkxzgkurcqvccsdjmqzg',
    CRON_SECRET: 'cron-secret',
    SUPABASE_ENV_LABEL: 'staging',
  });
  const parked = { jobname: 'retry-failed-webhooks-daily', schedule: '0 6 * * *', active: false };
  const live = { jobname: 'send-renewal-reminders-daily', schedule: '0 8 * * *', active: true };

  it('passes, with a warning, on the exact response staging returned on 2026-10-14', () => {
    const r = run(JSON.stringify([parked]));
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/::warning::pg_cron job 'retry-failed-webhooks-daily' .*INACTIVE/);
    expect(r.out).not.toContain('::error::');
  });

  it('still fails when an active job holds a placeholder (the silent no-op it exists to catch)', () => {
    const r = run(JSON.stringify([live]));
    expect(r.status).toBe(1);
    expect(r.out).toContain('::error::  send-renewal-reminders-daily (0 8 * * *)');
  });

  it('fails on an active job even when parked ones are listed alongside it', () => {
    const r = run(JSON.stringify([parked, live]));
    expect(r.status).toBe(1);
    expect(r.out).toContain('::warning::');
    expect(r.out).toContain('send-renewal-reminders-daily');
  });

  it('treats a row without an explicit active=false as active', () => {
    expect(run(JSON.stringify([{ jobname: 'mystery-job', schedule: '* * * * *' }])).status).toBe(1);
  });

  it('falls back to the conservative rule when the response cannot be parsed', () => {
    expect(run('jobname | schedule | active').status).toBe(1);
  });

  it('passes on an empty result set', () => {
    const r = run('[]');
    expect(r.status).toBe(0);
    expect(r.out).toContain('Verified: no active pg_cron job on staging');
  });
});

describe.skipIf(!posix)('verify-frontend-version.sh: waits out alias propagation', () => {
  const NEW = JSON.stringify({ commit: 'bac5694', migrationTarget: '20261018000000' });
  const OLD = JSON.stringify({ commit: '5845842', migrationTarget: '20261018000000' });
  // Serves the Nth line of $RESPONSES_FILE on the Nth call (the last repeats);
  // the line FAIL simulates a transport error. Requested URLs go to $URL_LOG.
  const shim = fakeCurl(`
url=""; for a in "$@"; do [[ "$a" == http* ]] && url="$a"; done
echo "$url" >> "$URL_LOG"
n=$(wc -l < "$URL_LOG")
line=$(sed -n "\${n}p" "$RESPONSES_FILE"); [[ -n "$line" ]] || line=$(tail -n 1 "$RESPONSES_FILE")
[[ "$line" == FAIL ]] && exit 22
printf '%s' "$line"`);
  let runs = 0;
  const run = (responses: string[], env: Record<string, string>) => {
    const id = runs++;
    const responsesFile = join(scratch, `responses-${id}`);
    const urlLog = join(scratch, `urls-${id}`);
    writeFileSync(responsesFile, `${responses.join('\n')}\n`);
    writeFileSync(urlLog, '');
    const r = runScript('scripts/ci/verify-frontend-version.sh', shim, {
      RESPONSES_FILE: responsesFile,
      URL_LOG: urlLog,
      GITHUB_SHA: 'bac5694',
      MIGRATION_TARGET: '20261018000000',
      GITHUB_RUN_ID: '42',
      VERSION_CHECK_ATTEMPTS: '4',
      VERSION_CHECK_INTERVAL_SECONDS: '0',
      ...env,
    });
    return { ...r, urls: readFileSync(urlLog, 'utf8').trim().split('\n').filter(Boolean) };
  };
  const canonical = { FRONTEND_CANONICAL_URL: 'https://ledgr-react-prod.vercel.app/' };

  it('accepts the release once the alias stops serving the previous one (the 2026-10-09 race)', () => {
    const r = run([OLD, OLD, NEW], canonical);
    expect(r.status).toBe(0);
    expect(r.urls).toHaveLength(3);
    expect(r.out).toContain('Frontend bac5694 live');
  });

  it('fails when the previous release is still being served on the last read', () => {
    const r = run([OLD], canonical);
    expect(r.status).toBe(1);
    expect(r.urls).toHaveLength(4);
    expect(r.out).toContain('::error::Deployed frontend reports commit=5845842');
  });

  it('fails when the commit matches but the migration target does not', () => {
    expect(run([JSON.stringify({ commit: 'bac5694', migrationTarget: '20261016000000' })], canonical).status).toBe(1);
  });

  it('keeps polling through a transient error once a version has been read', () => {
    expect(run([OLD, 'FAIL', NEW], canonical).status).toBe(0);
  });

  it('only warns when version.json is not readable at all (deployment protection, #188)', () => {
    const r = run(['<html>Authentication required</html>'], canonical);
    expect(r.status).toBe(0);
    expect(r.out).toContain('::warning::');
    expect(r.urls).toHaveLength(1);
  });

  it('prefers the canonical environment URL, without its trailing slash, and busts caches', () => {
    const r = run([NEW], { ...canonical, FRONTEND_URL: 'https://ledgr-react-prod-abc123-gremu.vercel.app' });
    expect(r.urls[0]).toBe('https://ledgr-react-prod.vercel.app/version.json?release_check=42-1');
  });

  it('falls back to the alias captured from the Vercel CLI when no canonical URL is configured', () => {
    const r = run([NEW], { FRONTEND_URL: 'https://ledgr-react.vercel.app' });
    expect(r.status).toBe(0);
    expect(r.urls[0]).toMatch(/^https:\/\/ledgr-react\.vercel\.app\/version\.json\?/);
  });

  it('skips with a warning when there is no URL at all', () => {
    const r = run([NEW], {});
    expect(r.status).toBe(0);
    expect(r.urls).toHaveLength(0);
    expect(r.out).toContain('::warning::No deployment URL captured');
  });
});

describe('release-manifest.mjs: names the stage that actually failed', () => {
  const manifest = (stages: Record<string, string>) => {
    const cwd = mkdtempSync(join(scratch, 'manifest-'));
    const res = spawnSync(process.execPath, [join(ROOT, 'scripts/ci/release-manifest.mjs')], {
      cwd,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        ENV_LABEL: 'staging',
        GITHUB_SHA: 'bac56946509dad1cc02ff4525518b1ab1defbf0b',
        MIGRATION_TARGET: '20261018000000',
        MIGRATION_REMOTE_HEAD: '20261018000000',
        ...stages,
      },
    });
    const json = JSON.parse(readFileSync(join(cwd, 'artifacts/release/release-manifest.json'), 'utf8'));
    return { status: res.status, out: res.stdout, json };
  };
  const backendShipped = { OUT_MIGRATE: 'success', OUT_VERIFY: 'success', OUT_EDGE: 'success' };

  it('reports the 2026-10-14 run as mixed-version and points at cronJobs, not at the frontend deploy', () => {
    const r = manifest({ ...backendShipped, OUT_CRON: 'failure', OUT_FRONTEND: 'skipped', OUT_FRONTEND_VERIFY: 'skipped' });
    expect(r.status).toBe(1);
    expect(r.json).toMatchObject({ mixedVersion: true, verdict: 'MIXED-VERSION — FRONTEND NOT UPDATED' });
    expect(r.json.stages.cronJobs).toBe('failure');
    expect(r.out).toContain('Failed stage(s): cronJobs.');
    expect(r.out).toContain('because an earlier step failed');
  });

  it('does not claim RELEASED when the live URL never confirmed the new frontend', () => {
    const r = manifest({ ...backendShipped, OUT_CRON: 'success', OUT_FRONTEND: 'success', OUT_FRONTEND_VERIFY: 'failure' });
    expect(r.status).toBe(1);
    expect(r.json).toMatchObject({ mixedVersion: true, verdict: 'MIXED-VERSION — FRONTEND NOT VERIFIED' });
  });

  it('keeps the verdict independent of the cron outcome once the frontend is confirmed live', () => {
    const r = manifest({ ...backendShipped, OUT_CRON: 'failure', OUT_FRONTEND: 'success', OUT_FRONTEND_VERIFY: 'success' });
    expect(r.status).toBe(0);
    expect(r.json).toMatchObject({ mixedVersion: false, verdict: 'RELEASED' });
  });
});
