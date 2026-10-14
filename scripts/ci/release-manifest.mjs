// IC 2026-09-25 P9 — write the release manifest (step summary + JSON file)
// after every production/staging deploy, success OR failure, and raise a
// loud MIXED-VERSION error when the backend moved but the live frontend was
// not updated to (and confirmed at) the matching version.
//
// `cronJobs` is reported for visibility but does not affect the verdict: it is
// independent maintenance that neither gates the frontend nor changes which
// versions are live.
//
// Env: ENV_LABEL, GITHUB_SHA, GITHUB_REF_NAME, GITHUB_RUN_ID, MIGRATION_TARGET,
//      MIGRATION_REMOTE_HEAD, OUT_MIGRATE, OUT_VERIFY, OUT_EDGE, OUT_CRON,
//      OUT_FRONTEND, OUT_FRONTEND_VERIFY, FRONTEND_URL, GITHUB_STEP_SUMMARY.
// Contains no secrets (only commit ids, versions, step outcomes, public URL).
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';

const e = process.env;
const outcome = (v) => v || 'not-run';
const manifest = {
  environment: e.ENV_LABEL || 'unknown',
  commit: e.GITHUB_SHA || 'unknown',
  ref: e.GITHUB_REF_NAME || 'unknown',
  runId: e.GITHUB_RUN_ID || 'unknown',
  migrationTarget: e.MIGRATION_TARGET || 'unknown',
  migrationRemoteHead: e.MIGRATION_REMOTE_HEAD || 'unknown',
  frontendUrl: e.FRONTEND_URL || null,
  stages: {
    migrate: outcome(e.OUT_MIGRATE),
    verifyMigrationTarget: outcome(e.OUT_VERIFY),
    edgeFunctions: outcome(e.OUT_EDGE),
    cronJobs: outcome(e.OUT_CRON),
    frontend: outcome(e.OUT_FRONTEND),
    frontendVersionCheck: outcome(e.OUT_FRONTEND_VERIFY),
  },
  recordedAt: new Date().toISOString(),
};
const { stages } = manifest;
const backendMoved = stages.migrate === 'success' || stages.edgeFunctions === 'success';
const frontendDeployed = stages.frontend === 'success';
// The version check runs whenever the deploy succeeded. Only its success
// confirms that the live URL serves this release.
const frontendLive = frontendDeployed && stages.frontendVersionCheck === 'success';
manifest.mixedVersion = backendMoved && !frontendLive;
manifest.verdict = frontendLive && stages.migrate === 'success' && stages.verifyMigrationTarget === 'success'
  ? 'RELEASED'
  : !manifest.mixedVersion ? 'FAILED'
  : frontendDeployed ? 'MIXED-VERSION — FRONTEND NOT VERIFIED'
  : 'MIXED-VERSION — FRONTEND NOT UPDATED';

mkdirSync('artifacts/release', { recursive: true });
writeFileSync('artifacts/release/release-manifest.json', JSON.stringify(manifest, null, 2));

const rows = Object.entries(manifest.stages).map(([k, v]) => `| ${k} | ${v} |`).join('\n');
const md = `## Release manifest — ${manifest.environment}: **${manifest.verdict}**

| field | value |
|---|---|
| commit | \`${manifest.commit}\` |
| ref | ${manifest.ref} |
| migration target (this commit) | ${manifest.migrationTarget} |
| migration head (remote, after push) | ${manifest.migrationRemoteHead} |
| frontend URL | ${manifest.frontendUrl ?? 'n/a'} |

| stage | outcome |
|---|---|
${rows}
`;
if (e.GITHUB_STEP_SUMMARY) appendFileSync(e.GITHUB_STEP_SUMMARY, md + '\n');
console.log(md);
if (manifest.mixedVersion) {
  // Name the stage that actually needs fixing. "frontend: skipped" means an
  // earlier step failed, not that the Vercel deploy is broken.
  const failed = Object.entries(stages).filter(([, v]) => v === 'failure').map(([k]) => k);
  const why = frontendDeployed
    ? `the live URL was not confirmed serving the newly deployed frontend (frontendVersionCheck=${stages.frontendVersionCheck}). Treat users as possibly still on the PREVIOUS frontend`
    : stages.frontend === 'failure'
      ? 'the frontend deploy failed. Users are still on the PREVIOUS frontend'
      : `the frontend deploy did not run (frontend=${stages.frontend}) because an earlier step failed. Users are still on the PREVIOUS frontend`;
  const failedNote = failed.length ? ` Failed stage(s): ${failed.join(', ')}.` : ' See the first failed step of this job.';
  console.log(`::error title=MIXED-VERSION STATE (${manifest.environment})::Backend is at migration ${manifest.migrationRemoteHead} / commit ${manifest.commit}, but ${why}.${failedNote} Fix that and re-run this workflow; do NOT roll back migrations.`);
  process.exitCode = 1;
}
