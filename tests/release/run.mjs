import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertLocalOnly } from './safety.mjs';
import { evidenceExit, suites } from './gate.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
try { assertLocalOnly(process.env, process.argv.slice(2)); }
catch { console.error('BLOCKED: R13 accepts only local disposable runs; external configuration refused.'); process.exit(2); }
process.chdir(root);
mkdirSync('.cache/r13', { recursive: true });
const directory = mkdtempSync(resolve('.cache/r13/ledgr-r13-'));
// Child receives no ambient application credentials or remote URLs.
const env = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
  LEDGR_TEST_ENV: 'local', R13_EVIDENCE_DIR: directory, NO_COLOR: '1' };
const child = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'tests/release/vitest.config.ts'],
  { env, encoding: 'utf8', timeout: 900000 /* R09.4 browser runtime: binary extract + PWA build inside the suite */, maxBuffer: 8 * 1024 * 1024 });
// Raw framework/application output is intentionally not retained or uploaded.
const outcomes = readdirSync(directory).filter(f => f.endsWith('.json')).flatMap(f => JSON.parse(readFileSync(join(directory, f), 'utf8')));
for (const [source, artifact] of Object.entries(suites)) {
  if (!readdirSync(directory).includes(artifact)) outcomes.push({
    id: `HARNESS.MISSING.${source}`, status: 'BLOCKED', expected: 'Suite produces its full evidence artifact', actual: 'Suite missing or failed during import/setup.',
    environment: 'local', source: `tests/release/${source}`, remediation: 'R13', customerDataTouched: false, productionVerificationRequired: false,
  });
}
// Existing standalone scripts are discovered but never run their unsafe fixed-path bootstraps.
for (const source of readdirSync('tests/database').filter(n=>n.endsWith('.test.js')).sort()) outcomes.push({
  id:`LEGACY.${source}`,status:'BLOCKED',expected:'Original standalone suite executes portably without broad grants or shared cleanup',
  actual:'Not executed: fixed/shared bootstrap or alternate legacy replay contract not yet ported; selected scenarios reused in new suites.',
  environment:'local',source:`tests/database/${source}`,remediation:'R13',customerDataTouched:false,productionVerificationRequired:false,
});
if (child.status !== 0 && !outcomes.some(r => r.status === 'FAIL')) outcomes.push({
  id: 'HARNESS.EXECUTION', status: 'BLOCKED', expected: 'All release suites execute',
  actual: 'Vitest did not complete successfully; no raw output retained. Check local tooling/configuration.',
  environment: 'local', source: 'tests/release/vitest.config.ts', remediation: 'R13',
  customerDataTouched: false, productionVerificationRequired: false,
});
if (!outcomes.length) outcomes.push({ id: 'HARNESS.EMPTY', status: 'BLOCKED', environment: 'local',
  expected: 'Nonempty evidence', actual: 'No suites produced evidence', source: 'tests/release/run.mjs', remediation: 'R13', customerDataTouched: false });
for (const r of outcomes) {
  r.layer ??= 'not executed';
  r.customerDataCouldBeAffectedIfDeployed ??= r.remediation !== 'R13';
  r.productionVerificationRequired ??= true;
}
const counts = Object.fromEntries(['PASS','FAIL','BLOCKED','NOT APPLICABLE'].map(s => [s, outcomes.filter(r => r.status === s).length]));
const hashes = directory => readdirSync(directory).filter(f=>/\.(sql|ts|mjs|json)$/.test(f)).sort().map(name=>({name,sha256:createHash('sha256').update(readFileSync(join(directory,name))).digest('hex')}));
const evidence = { environment: 'local', productionVerified: false,
  node: process.version, databaseProfile: 'migration-only public grants; synthetic Auth/Storage; disabled pg_cron/pg_net',
  migrations: hashes('supabase/migrations'), harness: hashes('tests/release'),
  tooling: Object.fromEntries(['vitest','pg','embedded-postgres'].map(n=>[n,JSON.parse(readFileSync(`node_modules/${n}/package.json`,'utf8')).version])),
  commit: spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).stdout.trim(),
  counts, outcomes: outcomes.sort((a,b) => a.id.localeCompare(b.id)) };
writeFileSync(join(directory, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
for (const r of evidence.outcomes) console.log(`${r.status} ${r.id} [${r.remediation}]`);
console.log(JSON.stringify(counts));
console.log(`Sanitized local evidence: ${directory}/evidence.json`);
// Strict evidence gate: BLOCKED never becomes PASS. No expected-failure suppression.
process.exit(evidenceExit(outcomes));
