#!/usr/bin/env node
/**
 * Gate-A checklist: verify a regenerated `database.generated.ts` against the
 * pre-implementation architecture gate's schema truth (2026-10-06).
 *
 * Usage:
 *   node scripts/ci/verify-regenerated-types.mjs [path-to-types-file]
 *   (default: src/dal/types/database.generated.ts)
 *
 * Hard gate (exit 1 if any item is missing):
 *   - all 79 migration-chain tables            (replay catalog)
 *   - all 21 migration-chain views             (replay catalog)
 *   - all 131 application functions            (catalog minus pg_trgm internals)
 *   - all 16 enums, with every catalog label present in the enum union
 *   - the 8 column-drift columns on their 5 tables (gate §5.3)
 * This subsumes the gate §5.3 diff checklist (the regenerated file must at
 * least surface the 11 missing tables / 14 missing views / 90 missing
 * application functions / 9 drift columns — and a correct regeneration
 * surfaces the whole chain, so the whole chain is required).
 *
 * Two counts in gate §5.3 are corrected here (verified 2026-10-09 against the
 * replay catalog, the stale tracked types, and the gate's own approx artifact;
 * all three cross-foot):
 *   - Functions: the gate says "88 application (+31 trgm artifacts)". The
 *     stale types already carry 2 of the 31 pg_trgm functions (show_limit,
 *     show_trgm), so the real delta is 90 application + 29 trgm (the 119
 *     total is unchanged; 131 application − 41 application already typed).
 *   - Enums: the gate says "9 missing". All 16 enums are already present in
 *     the stale types with current labels (user_role carries all 22). The
 *     gate's 9 are exactly the multi-line-formatted enums — a parser artifact
 *     of its delta tooling, not a real delta.
 * Gate §5.3's other rows are confirmed correct: 11 tables, 14 views,
 * 9 columns across 5 drifted tables, 0 removals.
 *
 * Informational only (never fails the run): pg_trgm artifacts present (the
 * CLI may legitimately omit extension-owned functions; the stale file itself
 * carries 2 of 31), objects in the candidate that the migration chain does
 * not define (expected when regenerating from a live schema — staging and
 * production carry legacy-only objects), and extra enum labels.
 *
 * The candidate's SHA-256 is printed so the regeneration chore PR can record
 * old/new hashes as the gate requires (the old committed hash starts
 * 0f80b6f5…). Regenerate from STAGING only — see docs/database/database-operations.md §2.
 *
 * Schema truth: artifacts/database/gate-2026-10-06-migration-replay-catalog.json
 * (120 migrations replayed on PostgreSQL 17.10, per-migration SHA-256 inside).
 *
 * Deliberately NOT wired into CI: the tracked types file is stale until the
 * regeneration chore PR lands, so a CI gate would fail on main.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const catalogPath = resolve(root, 'artifacts/database/gate-2026-10-06-migration-replay-catalog.json');

// The 31 pg_trgm extension-owned functions found by the migration replay.
// Extension internals, not application surface: excluded from the hard gate
// (see header). The stale tracked types already carry show_limit/show_trgm.
const TRGM_FUNCTIONS = new Set([
  'gin_extract_query_trgm', 'gin_extract_value_trgm', 'gin_trgm_consistent', 'gin_trgm_triconsistent',
  'gtrgm_compress', 'gtrgm_consistent', 'gtrgm_decompress', 'gtrgm_distance', 'gtrgm_in',
  'gtrgm_options', 'gtrgm_out', 'gtrgm_penalty', 'gtrgm_picksplit', 'gtrgm_same', 'gtrgm_union',
  'set_limit', 'show_limit', 'show_trgm', 'similarity', 'similarity_dist', 'similarity_op',
  'strict_word_similarity', 'strict_word_similarity_commutator_op',
  'strict_word_similarity_dist_commutator_op', 'strict_word_similarity_dist_op',
  'strict_word_similarity_op', 'word_similarity', 'word_similarity_commutator_op',
  'word_similarity_dist_commutator_op', 'word_similarity_dist_op', 'word_similarity_op',
]);

// Column-level drift on shared tables (gate §5.3; re-verified 2026-10-09:
// all 8 are absent from the stale tracked types).
const COLUMN_DRIFT = {
  business_invitations: ['phone', 'role_assignment_authorized'],
  invoices: ['pos_shift_id', 'payload_hash', 'submitted_by'],
  pos_cash_movements: ['command_key'],
  pos_shifts: ['terminal_id', 'open_command_key'],
  webhooks: ['consecutive_failures'],
};

function fail(code, message) {
  console.error(`verify-regenerated-types: ${message}`);
  process.exit(code);
}

/** The `public` schema block of a generated Database type. */
function publicBlock(text) {
  const start = text.indexOf('\n  public: {');
  if (start === -1) fail(2, 'no `public` schema block found — not a Supabase generated types file?');
  const rest = text.slice(start);
  const next = rest.slice(1).search(/\n  [A-Za-z0-9_]+: \{/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

/** One section (`Tables`/`Views`/`Functions`/`Enums`/`CompositeTypes`) of the public block. */
function section(pub, name) {
  const marker = `    ${name}: {`;
  const i = pub.indexOf(marker);
  if (i === -1) return '';
  const sub = pub.slice(i + marker.length);
  const m = sub.search(/\n    (Tables|Views|Functions|Enums|CompositeTypes): \{/);
  return m === -1 ? sub : sub.slice(0, m);
}

/** Entry keys of an object-valued section (tables, functions): `      name: {`. */
function objectKeys(sec) {
  return new Set([...sec.matchAll(/^ {6}([A-Za-z0-9_]+): \{/gm)].map((m) => m[1]));
}

/** Entry keys of a colon-valued section (views, enums): `      name: …`. */
function colonKeys(sec) {
  return new Set([...sec.matchAll(/^ {6}([A-Za-z0-9_]+):/gm)].map((m) => m[1]));
}

/** All `"label"` literals of one enum's union, single- or multi-line. */
function enumLabels(enumSec, name) {
  const labels = new Set();
  const collect = (s) => { for (const q of s.matchAll(/"([^"]+)"/g)) labels.add(q[1]); };
  let inBlock = false;
  for (const line of enumSec.split('\n')) {
    const m = line.match(/^ {6}([A-Za-z0-9_]+):(.*)$/);
    if (m) {
      if (inBlock) break; // next enum starts
      if (m[1] === name) { inBlock = true; collect(m[2]); }
      continue;
    }
    if (inBlock) {
      if (/^ {4}\},?$/.test(line)) break; // section closes
      collect(line);
    }
  }
  return labels;
}

/** Column names declared anywhere in one table's block (Row/Insert/Update). */
function tableColumns(pub, table) {
  const marker = `      ${table}: {`;
  const i = pub.indexOf(marker);
  if (i === -1) return null;
  const sub = pub.slice(i);
  const m = sub.slice(1).search(/\n {6}[A-Za-z0-9_]+: \{/);
  const block = m === -1 ? sub : sub.slice(0, m + 1);
  return new Set([...block.matchAll(/^ {10}([A-Za-z0-9_]+)\??:/gm)].map((x) => x[1]));
}

const candidateArg = process.argv[2] ?? 'src/dal/types/database.generated.ts';
const candidatePath = resolve(root, candidateArg);
let text;
try {
  text = readFileSync(candidatePath, 'utf8');
} catch {
  fail(2, `cannot read ${candidatePath}`);
}
if (!text.includes('export type Database')) fail(2, `${candidateArg} does not look like a generated types file`);

let catalog;
try {
  catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
} catch {
  fail(2, `cannot read schema truth ${catalogPath}`);
}

const pub = publicBlock(text);
const tables = objectKeys(section(pub, 'Tables'));
const views = colonKeys(section(pub, 'Views'));
const functions = objectKeys(section(pub, 'Functions'));
const enumSec = section(pub, 'Enums');
const enums = colonKeys(enumSec);

const catTables = [...catalog.tables].sort();
const catViews = [...catalog.views].sort();
const catFnNames = [...new Set(catalog.functions.map((f) => f.name))];
const appFunctions = catFnNames.filter((n) => !TRGM_FUNCTIONS.has(n)).sort();
const trgmFunctions = catFnNames.filter((n) => TRGM_FUNCTIONS.has(n)).sort();
const catEnums = new Map(catalog.enums.map((e) => [e.name, e.labels.replace(/^\{/, '').replace(/\}$/, '').split(',')]));

const missing = [];
for (const t of catTables) if (!tables.has(t)) missing.push(`table ${t}`);
for (const v of catViews) if (!views.has(v)) missing.push(`view ${v}`);
for (const f of appFunctions) if (!functions.has(f)) missing.push(`function ${f}`);
for (const [name, labels] of catEnums) {
  if (!enums.has(name)) { missing.push(`enum ${name}`); continue; }
  const have = enumLabels(enumSec, name);
  for (const l of labels) if (!have.has(l)) missing.push(`enum ${name} label "${l}"`);
}
let driftPresent = 0;
let driftTotal = 0;
for (const [table, cols] of Object.entries(COLUMN_DRIFT)) {
  const have = tableColumns(pub, table);
  if (!have) { missing.push(`table ${table} (needed for the column-drift check)`); continue; }
  for (const c of cols) {
    driftTotal += 1;
    if (have.has(c)) driftPresent += 1;
    else missing.push(`column ${table}.${c}`);
  }
}

// Informational extras (never gating): a live-schema regeneration legitimately
// carries legacy objects the migration chain does not define.
const catTableSet = new Set(catTables);
const catViewSet = new Set(catViews);
const catFnSet = new Set(catFnNames);
const extraTables = [...tables].filter((t) => !catTableSet.has(t)).sort();
const extraViews = [...views].filter((v) => !catViewSet.has(v)).sort();
const extraFunctions = [...functions].filter((f) => !catFnSet.has(f)).sort();
const extraLabels = [];
for (const [name, labels] of catEnums) {
  if (!enums.has(name)) continue;
  const have = enumLabels(enumSec, name);
  for (const l of have) if (!labels.includes(l)) extraLabels.push(`${name}."${l}"`);
}
const trgmPresent = trgmFunctions.filter((f) => functions.has(f)).length;

console.log('Gate-A regenerated-types checklist');
console.log(`  candidate:    ${candidateArg}`);
console.log(`  sha256:       ${createHash('sha256').update(text).digest('hex')}`);
console.log(`  schema truth: artifacts/database/gate-2026-10-06-migration-replay-catalog.json (${catalog.migrationCount} migrations)`);
console.log('');
console.log(`  tables    ${catTables.length - missing.filter((m) => m.startsWith('table ')).length}/${catTables.length} required present`);
console.log(`  views     ${catViews.length - missing.filter((m) => m.startsWith('view ')).length}/${catViews.length} required present`);
console.log(`  functions ${appFunctions.length - missing.filter((m) => m.startsWith('function ')).length}/${appFunctions.length} application present (pg_trgm artifacts: ${trgmPresent}/${trgmFunctions.length} present — informational)`);
console.log(`  enums     ${catEnums.size - missing.filter((m) => m.startsWith('enum ')).length}/${catEnums.size} present with all catalog labels`);
console.log(`  columns   ${driftPresent}/${driftTotal} drift columns present on their 5 tables`);
console.log('');
console.log(`  extras (informational): ${extraTables.length} tables, ${extraViews.length} views, ${extraFunctions.length} functions not in the migration chain; extra enum labels: ${extraLabels.length}${extraLabels.length ? ` (${extraLabels.join(', ')})` : ''}`);
console.log('');

if (missing.length) {
  console.log(`  MISSING (${missing.length}):`);
  for (const m of missing) console.log(`    - ${m}`);
  console.log('');
  console.log('  FAIL — the regenerated types do not surface the migration chain (gate B-1 not cleared).');
  process.exit(1);
}
console.log('  PASS — the regenerated types surface the full migration chain (tables, views, application functions, enums, drift columns).');
process.exit(0);
