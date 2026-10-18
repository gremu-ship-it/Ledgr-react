import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const script = join(root, 'scripts/ci/remote-schema-forensics.sh');
const workflow = readFileSync(join(root, '.github/workflows/migration-forensics.yml'), 'utf8');
const workflowRun = workflow.split('        run: |\n')[1].split('\n').map((line) => line.replace(/^ {10}/, '')).join('\n');
const names = ['projects', 'construction_projects', 'project_status_log', 'project_status_log_project'];
const catalog = names.map((name) => ({ name, qualified_name: null, relkind: null, owner: null, same_named_type: null }));
catalog[2] = {
  name: 'project_status_log', qualified_name: 'public.project_status_log', relkind: 'r', owner: 'legacy_owner',
  columns: [{ name: 'id', type: 'uuid', not_null: true, default: 'gen_random_uuid()' }],
  constraints: [{ name: 'legacy_fk', columns: ['project_id'], references: 'public.projects', on_delete: 'a' }],
  indexes: [{ name: 'project_status_log_project', definition: 'CREATE INDEX project_status_log_project ON public.project_status_log USING btree (project_id, changed_at)' }],
  triggers: [{ name: 'legacy_trigger', definition: 'legacy trigger definition' }],
  dependents: [{ type: 'n', object: 'dependent legacy view' }],
};

function run({ relations = catalog, history = [{ version: '20261028000000', name: 'phase_a' }],
  head = [{ remote_head: '20261028000000', recorded_versions: 10 }], functions = [],
  args = [], fail = false, env = {}, fromWorkflow = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'migration-forensics-'));
  try {
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const payloads = join(dir, 'payloads');
    const summary = join(dir, 'summary');
    writeFileSync(payloads, '');
    writeFileSync(join(bin, 'curl'), `#!/usr/bin/env bash
out=''; request=''; prev=''
for arg in "$@"; do
  case "$prev" in
    --output) out="$arg" ;;
    --data-binary) request="${'${arg#@}'}" ;;
  esac
  prev="$arg"
done
payload="$(cat "$request")"
printf '%s\\n' "$payload" >> "$PAYLOADS"
[[ "$CURL_FAIL" == 1 ]] && exit 22
case "$payload" in
  *recorded_versions*) response="$HEAD" ;;
  *schema_migrations*) response="$HISTORY" ;;
  *pg_proc*) response="$FUNCTIONS" ;;
  *) response="$RELATIONS_RESPONSE" ;;
esac
printf '%s' "$response" > "$out"
`, { mode: 0o755 });
    const result = spawnSync('bash', fromWorkflow ? ['-c', workflowRun] : [script, ...args], {
      cwd: root, encoding: 'utf8', env: {
        ...process.env, PATH: `${bin}:${process.env.PATH}`, SUPABASE_ACCESS_TOKEN: 'fake-management-token',
        SUPABASE_DB_PASSWORD: 'fake-db-password', SUPABASE_PROJECT_REF: 'hsuhuvuxfuufrlejsatw',
        SUPABASE_ENV_LABEL: 'production', PAYLOADS: payloads, CURL_FAIL: fail ? '1' : '0',
        RELATIONS_RESPONSE: JSON.stringify(relations), HISTORY: JSON.stringify(history),
        HEAD: JSON.stringify(head), FUNCTIONS: JSON.stringify(functions),
        GITHUB_STEP_SUMMARY: summary, GITHUB_SHA: 'synthetic-revision',
        PRODUCTION_PROJECT_REF: 'production-ref', STAGING_PROJECT_REF: 'staging-ref',
        RELATIONS: names.join(' '), VERSIONS: '', ...env,
      },
    });
    return { ...result, payloads: readFileSync(payloads, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),
      summary: existsSync(summary) ? readFileSync(summary, 'utf8') : '' };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('reports owner, defaults, complete index/FK/trigger/dependency evidence without claiming adoption is safe', () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /public\.project_status_log: EXISTS; owner=legacy_owner; relkind=r/);
  assert.match(result.stdout, /gen_random_uuid\(\)/);
  assert.match(result.stdout, /"references": "public\.projects"/);
  assert.match(result.stdout, /CREATE INDEX .*USING btree/);
  assert.match(result.stdout, /legacy trigger definition/);
  assert.match(result.stdout, /dependent legacy view/);
  assert.match(result.stdout, /version 20261028000000: RECORDED/);
  assert.match(result.stdout, /version 20261028000001: NOT RECORDED/);
  assert.match(result.stdout, /Ownership and full schema equivalence still require review/);
  assert.match(result.stdout, /20261028000000_construction_projects\.sql sha256=[a-f0-9]{64}/);
  assert.doesNotMatch(result.stdout, /may adopt|no manual step|reached.*outside/i);
});

test('distinguishes an absent relation from a standalone type occupying its name', () => {
  const relations = structuredClone(catalog);
  relations[0].same_named_type = { kind: 'c', owner: 'type_owner' };
  const result = run({ relations });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /public\.projects: TYPE ONLY/);
  assert.match(result.stdout, /public\.construction_projects: ABSENT/);
});

test('failed history is UNKNOWN, never proof of an unrecorded migration', () => {
  const result = run({ history: { message: 'history schema unavailable' } });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /UNKNOWN: history inspection failed/);
  assert.doesNotMatch(result.stdout, /version \d+: (NOT )?RECORDED/);
  assert.match(result.stdout, /project_status_log: EXISTS/);
});

test('empty/incomplete relation or head responses are UNKNOWN, not a free namespace', () => {
  const result = run({ relations: [], head: [] });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /UNKNOWN: relations inspection failed/);
  assert.match(result.stdout, /UNKNOWN: head inspection failed/);
  assert.doesNotMatch(result.stdout, /: ABSENT/);
});

test('network/HTTP errors retain a failed inspection status and a read-only fallback', () => {
  const result = run({ fail: true });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Inspection incomplete/);
  assert.match(result.stdout, /scripts\/database\/diagnose-project-status-log\.sql/);
  assert.doesNotMatch(result.stdout, /: (ABSENT|NOT RECORDED)/);
});

test('requests are catalog SELECTs with read_only=true and no credentials or application rows', () => {
  const result = run();
  assert.equal(result.payloads.length, 4);
  for (const payload of result.payloads) {
    assert.equal(payload.read_only, true);
    assert.match(payload.query, /^(WITH|SELECT)\b/);
    assert.doesNotMatch(payload.query, /\b(ALTER|INSERT|UPDATE|DELETE|CREATE|DROP|TRUNCATE|GRANT|REVOKE|CALL)\b/i);
    assert.doesNotMatch(payload.query, /fake-management-token|fake-db-password/);
    assert.doesNotMatch(payload.query, /FROM public\.project_status_log/i, 'no customer audit rows fetched');
  }
  assert.match(result.payloads[1].query, /p\.prokind = 'f'/, 'aggregate definitions cannot be passed to pg_get_functiondef');
});

for (const args of [
  ['--relation', 'x; DROP TABLE public.businesses'], ['--relation', 'other_schema.x'],
  ['--version', "20261028000000');DELETE"], ['--relation'], ['--bogus'],
]) {
  test(`invalid arguments are rejected before any API call: ${args[0]} / ${args[1] ?? '(missing)'}`, () => {
    const result = run({ args });
    assert.equal(result.status, 2);
    assert.equal(result.payloads.length, 0);
    assert.match(result.stdout, /UNKNOWN/);
  });
}

test('credentials are not printed, including when catalog metadata contains their text', () => {
  const relations = structuredClone(catalog);
  relations[2].comment = 'fake-management-token fake-db-password';
  const result = run({ relations });
  assert.equal(result.status, 0);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /fake-management-token|fake-db-password/);
  assert.match(result.stdout, /\*\*\*/);
});

test('missing credentials fail visibly without requesting them or touching a project', () => {
  const result = run({ env: { SUPABASE_ACCESS_TOKEN: '', SUPABASE_PROJECT_REF: '' } });
  assert.equal(result.status, 1);
  assert.equal(result.payloads.length, 0);
  assert.match(result.stdout, /SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN are required/);
  assert.match(result.stdout, /SQL editor \(read-only\)/);
});

test('workflow keeps diagnostic failure visible and still writes the summary', () => {
  const result = run({ fromWorkflow: true, fail: true });
  assert.equal(result.status, 1);
  assert.match(result.summary, /UNKNOWN: relations/);
  assert.match(result.summary, /synthetic-revision/);
});

test('a missing staging ref never falls back to production', () => {
  const result = run({ fromWorkflow: true, env: { SUPABASE_ENV_LABEL: 'staging', STAGING_PROJECT_REF: '' } });
  assert.equal(result.status, 1);
  assert.equal(result.payloads.length, 0);
  assert.match(result.summary, /Inspection UNKNOWN/);
});

test('workflow inputs remain data, not shell syntax', () => {
  const result = run({ fromWorkflow: true, env: { RELATIONS: 'x; exit 0', VERSIONS: '$(echo injected)' } });
  assert.equal(result.status, 2);
  assert.equal(result.payloads.length, 0);
  assert.match(result.summary, /Inspection UNKNOWN/);
});
