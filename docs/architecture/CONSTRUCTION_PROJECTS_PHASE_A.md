# Construction projects — Phase A

## Surfaces and scope

- `/construction/projects` is the first Construction workspace tab. The existing
  `/construction/*` CapabilityGate still requires the effective Enterprise
  construction capability. Navigation, feature flags and capability resolution
  are unchanged. The old Overview and procurement tabs remain available.
- Projects have a paginated, status-filterable register; create/edit forms;
  sequential lifecycle confirmation with optional reason; overview metrics;
  location linking; and project-filtered versions of the existing procurement UI.
- BOQ and Valuations are placeholders only. There is no billing, variation,
  certification, retention release or accounting implementation in this change.
- Optional default-project provisioning is deliberately not enabled. Existing
  registration/settings provisioning remains unchanged, and its Main Store is
  available to link explicitly.

## Authority and persistence

Migration: `20261028000000_construction_projects.sql`.

`projects` and `project_status_log` use member + business-scoped procurement-grant
RLS. As in the procurement module, authenticated users have SELECT privileges,
not direct table writes. All writes go through SECURITY DEFINER RPC commands that
call `_ledgr_construction_actor` with `procurement.master.manage`. The status
command locks the row and writes the audit record atomically. No backward,
skipped or repeated transition is accepted. Sites are inventory locations and may
only link to a project in the same business; changing projects requires unlinking
first. Branch authorization is retained for link/unlink operations.

There is no separate TypeScript server/command layer in the existing procurement
architecture. `ProjectRepository` therefore follows its typed RPC adapter pattern;
SQL commands are the server authority. Browser grant checks only disable controls.

## Additive procurement dimension

Nullable, indexed `project_id` references are on `construction_purchase_orders`,
`construction_material_issues`, `construction_material_returns` and
`inventory_locations`. No backfill or required dimension is introduced.

New `create_project_purchase_order`, `issue_project_materials` and
`return_project_materials` wrappers set a transaction-local project context and
call the **original** procurement commands. An INSERT-only dimension trigger
validates business/grant scope and attaches the tag while all original write-token,
branch, two-person authorization, evidence, stock and append-only guards still
run. The wrapper restores context and rejects replay keys belonging to another
project. No posted register row is updated to attach a tag. A return inherits its
source issue's project even when recorded through the ordinary returns workspace;
a conflicting explicit project is rejected. Original commands and all untagged
records keep their previous behavior.

## Cost summary interpretation

The actual PO schema has no total column. The Phase A summary derives PO value as
`SUM(quantity_ordered * COALESCE(expected_unit_price, 0))` from PO lines. Issues and
returns use their immutable `total_cost_base` values. As specified, `net_cost` is
**PO value minus returned value**, not issued value minus returned value; the
issued total is exposed separately. This is a simple planning/reporting foundation,
not a posted ledger balance. It includes all tagged PO statuses, has no FX
conversion, and counts unpriced lines as zero. The UI discloses these limitations.

`get_project_cost_summary` is SECURITY INVOKER to preserve existing procurement
branch RLS: it must not turn an organization-wide project into a branch-data
exfiltration path. A branch-scoped actor sees only their permitted procurement
values. Projects themselves are organization-scoped, as specified.

The FK delete actions are SET NULL, but there is intentionally no project-delete
command: posted procurement registers remain append-only. Project lifecycle ends
in `closed`, not deletion.

## Verification

- Unit/component suite: list/filter/pagination, form validation and RPC contracts,
  detail metrics, all four lifecycle button mappings, linked/available sites,
  unlink warning, placeholders, editing, creation navigation, and route gating.
- Release suite: real disposable PostgreSQL migration replay, valid creation,
  validation and grants, all 25 status combinations, audit entries, same-business
  site linking, cross-business RLS/command denial, immutable command boundary,
  any-grant read vs master-manage writes, and an Enterprise construction flow
  exercising original procurement commands through the new tagged wrappers,
  idempotency and cost aggregation. No production database is used.
- The complete release evidence gate already has 57 BLOCKED checks on the starting
  commit (platform/provider and legacy harness coverage). Baseline comparison was
  performed from a `git archive HEAD` copy before committing this work. Its blocker
  set matched the Phase A run exactly, with zero FAIL outcomes in both. Do not
  interpret an exit code of 2 from this gate as production verification or a pass.

Final local verification:

| Check | Result |
| --- | --- |
| `npm test` | 128 files, 1,197 tests passed (26 new tests) |
| Project release suite | 35 tests passed |
| `npm run typecheck` / `npm run test:release:types` | Passed |
| `npm run lint` | Passed, four existing unused-disable warnings |
| `npm run build` | Passed with documented CI placeholder Supabase configuration |
| Full isolated `npm run test:release` | 916 PASS, 0 FAIL, 57 baseline-identical BLOCKED; exit 2 |
| Untouched starting-commit release comparison | 881 PASS, 0 FAIL, same 57 BLOCKED; exit 2 |

Run the release harness serially with respect to manual production builds: its
browser probes serve `dist/` and depend on a harness-specific service-worker host.
A concurrent build with a different Supabase host overwrites that shared artifact
and invalidates the runtime cache probes. The final counts above come from an
isolated run, not such a concurrent run. No product behavior or harness assertions
were altered to obtain these results.

## Follow-up: operating-model save and UUID audit resource IDs

`20261029000000_business_operating_models_audit_resource_id.sql` fixes the Settings
save failure `column "resource_id" is of type uuid but expression is of type text`.
The operating-model RPC from `20261027000000` explicitly cast the business ID to
text for both hashing and insertion. Some deployed schemas use a UUID audit
resource column, unlike the reconstructed text-column base schema. The insertion
now supplies the native UUID parameter; PostgreSQL accepts that value for either
column shape. The hash call retains its required text argument. No audit table,
history, hashing format, authorization, provisioning or RPC signature is changed.
This is a forward migration: previously applied migrations are not edited.

The reported SQLSTATE 42804 was reproduced locally with a UUID-shaped audit
column before the fix. The new release tests exercise successful save, audit hash
consistency, no-op save and permission denial with **both text and UUID columns**.
The four new tests and the existing provisioning/project suites pass together
(47 database tests). Apply this forward migration to the affected environment
through the normal migration pipeline before retrying the Settings save; a browser
refresh alone cannot replace the deployed database function.

## Follow-up: the 2026-10-18 production collision and the convergent re-apply

The first production deploy carrying Phase A (Deploy #224, run `39118959766`)
failed on the **first statement** of `20261028000000_construction_projects.sql`,
three attempts in a row:

```
Applying migration 20261028000000_construction_projects.sql...
ERROR: relation "projects" already exists (SQLSTATE 42P07)
At statement: 0
```

Production's `supabase_migrations.schema_migrations` did **not** record version
`20261028000000` — the push listed the file as pending — yet `public.projects`
existed on that project. Objects and history had diverged: the Phase A objects
reached production outside `supabase db push`. A hand application (the Supabase
SQL editor, or `psql`) commits every statement it manages to run and records no
migration version, so the schema moved while the history stayed behind. Retrying
cannot fix that; each attempt reproduces the collision byte for byte, which is
what the three attempts did.

This is the mirror image of the drift case `scripts/ci/supabase-link-and-push.sh`
already handled (history ahead of the checkout → `migration repair --status
reverted`), and the assumption in that header comment — "when the corresponding
file lands in the repo later, its push applies and records it as usual" — only
holds if the earlier application left nothing behind. Here it left everything.

### What changed

* **The Phase A/B/C migrations converge.** `20261028000000`, `20261030000000` and
  `20261031000001` now guard every object they declare: `CREATE TABLE/INDEX IF
  NOT EXISTS`, `DROP POLICY|TRIGGER IF EXISTS` before each `CREATE POLICY|TRIGGER`
  (PostgreSQL offers no `IF NOT EXISTS` for either), `CREATE OR REPLACE FUNCTION`,
  `ADD COLUMN IF NOT EXISTS`. Phase A additionally re-asserts its declared
  `NOT NULL`, `DEFAULT` and `CHECK` contracts additively, so a table that arrived
  by hand with the right columns but none of the guarantees still converges
  instead of failing later inside `create_project`. Nothing is dropped, no row is
  rewritten and no grant is widened: on a clean replay, on staging (where the
  version *is* recorded, so `db push` skips the file) and on a second application,
  the files are no-ops.
* **A foreign `projects` is refused, not adopted.** Phase A starts with a
  read-only guard that compares the live columns and types of `public.projects`
  and `public.project_status_log` against the declared ones. A different table
  owning the name — production is the legacy Ledgr project, which already held
  `api_keys`, `webhooks` and `webhook_deliveries` before this repository declared
  them — raises with every difference, the live column list and the row count,
  having changed nothing. `IF NOT EXISTS` alone would have kept the foreign shape
  and the RPCs, FKs and RLS policy built on it would have failed at runtime.
  Moving such a table aside is an owner decision, not a deploy's.
* **The pipeline stops retrying collisions and shows the live object.**
  `scripts/ci/supabase-link-and-push.sh` classifies the collision SQLSTATEs
  (42P07, 42710, 42701, 42723, 42P06) as deterministic: one attempt, an
  annotation naming the file and object, and a call to
  `scripts/ci/migration-conflict-forensics.sh`, which prints the live shape
  (columns/types, RLS, policies, constraints, indexes, triggers, row estimate)
  plus whether the version is recorded and what the remote head is, through the
  read-only Management API endpoint — no database password, no writes, always
  exit 0 so it can never mask the real failure. Genuine transport failures keep
  their three attempts.
* **The invariant is pinned.** `src/lib/__tests__/migrationInvariants.test.ts`
  rule E fails the fast suite if any migration from `20261028000000` onwards
  declares an object without a guard (or without a paired `DROP ... IF EXISTS`
  where PostgreSQL has no `IF NOT EXISTS`).

### Evidence

`tests/database/construction_projects_convergence.test.js` replays the whole
migration set in a real disposable PostgreSQL 17 in four states — clean,
hand-applied (all objects live, then the pending files re-applied three times),
partial (only Phase A's `CREATE TABLE`/`INDEX` head applied, no RLS, policies,
RPCs, triggers or `project_id` dimensions), and legacy (a foreign `projects` with
`id serial`, a `client` column and two rows). It asserts that the converged
databases are **entry-for-entry identical** to the clean replay across columns,
defaults, nullability, indexes, constraints, policies, RLS flags, triggers,
function signatures *and bodies*, grants and execute privileges; that RLS is on
and browser writes stay revoked after convergence; and that the legacy database
is refused with SQLSTATE 42P07 while its columns, rows and the rest of the schema
are untouched (no `project_status_log`, no `project_id` dimensions, no RPCs).

`tests/ci/migration-collision.test.mjs` executes the real deploy script with a
fake `supabase` and a fake `curl`: one push attempt on a collision (never three),
no `migration repair`, the password never in the log, the forensics report and
verdict present, column collisions reported with their table, and three attempts
preserved for a pooler timeout.

Unchanged by this follow-up: 93 release checks across
`construction-projects`, `construction-procurement`, `construction-returns`,
`construction-branch-scope`, `construction-provisioning` and
`business-operating-model-audit`; 1291 fast unit tests; `typecheck`; `lint` (four
pre-existing unused-disable warnings); and
`tests/database/public_api_table_convergence.test.js` (17 checks), which replays
the same chain over a legacy-shaped database.

Runbook: DEPLOYMENT.md → `relation "..." already exists (SQLSTATE 42P07)`.
