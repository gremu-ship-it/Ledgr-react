// IC 2026-09-25 P9 — write the release manifest (step summary + JSON file)
// after every production/staging deploy, success OR failure, and raise a
// loud MIXED-VERSION error when the backend moved but the live frontend was not confirmed at the matching version.
//
// Env: ENV_LABEL, GITHUB_SHA, GITHUB_REF_NAME, GITHUB_RUN_ID, MIGRATION_TARGET,
//      MIGRATION_REMOTE_HEAD, OUT_MIGRATE, OUT_VERIFY, OUT_EDGE, OUT_FRONTEND,
//      OUT_FRONTEND_VERIFY, FRONTEND_URL, GITHUB_STEP_SUMMARY.
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
    frontend: outcome(e.OUT_FRONTEND),
    frontendVersionCheck: outcome(e.OUT_FRONTEND_VERIFY),
  },
  recordedAt: new Date().toISOString(),
};
const backendMoved = manifest.stages.migrate === 'success' || manifest.stages.edgeFunctions === 'success';
const frontendOk = manifest.stages.frontend === 'success';
const frontendVerified = manifest.stages.frontendVersionCheck === 'success';
manifest.mixedVersion = backendMoved && (!frontendOk || !frontendVerified);
manifest.verdict = frontendOk && frontendVerified
  && manifest.stages.migrate === 'success'
  && manifest.stages.verifyMigrationTarget === 'success'
  && manifest.stages.edgeFunctions === 'success'
  ? 'RELEASED' : manifest.mixedVersion ? 'MIXED-VERSION — FRONTEND NOT UPDATED/VERIFIED' : 'FAILED';

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
  console.log(`::error title=MIXED-VERSION STATE (${manifest.environment})::Backend is at migration ${manifest.migrationRemoteHead} / commit ${manifest.commit}, but the live frontend was not confirmed at that commit and migration target (deploy=${manifest.stages.frontend}, versionCheck=${manifest.stages.frontendVersionCheck}). Treat users as potentially on the PREVIOUS frontend; fix the deploy or version check and re-run this workflow. Do NOT roll back migrations.`);
  process.exitCode = 1;
}
