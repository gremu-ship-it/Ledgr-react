# Construction returns — Phase 1 implementation plan (staged, planning only)

**Status: plan only. Nothing here is implemented and this document authorises nothing.** Phase 1 may be built
only after a separate explicit implementation instruction (decision record §1 item 10, §7). The enum label
(`construction_return_in`, decision A) and the costing policy (decision B) are confirmed; the corrected design
baseline is `CONSTRUCTION_RETURNS_WASTAGE_DAMAGE_DESIGN_2026-10-16.md` (commit `4e2076f`, unpushed).

**Scope of this plan:** usable-material returns only — the material returns to the store it was issued from, at
the original issue's recorded unit cost, with the project's net material cost reduced and the weighted-average
pool recalculated. **Out of scope, permanently for Phase 1:** wastage, abnormal loss, damage write-downs, NRV
changes, supplier returns, GL posting, any change to `gl_posting_enabled` or its `CHECK`, cross-site returns,
and any approval/second-actor tier.

**Evidence class.** Every file, object and constraint named below was read from the repository at HEAD
`4e2076f` (read-only). No database was written to, no hosted service was contacted, and no test result in this
document is a claim about hosted Supabase or production.

---

## Preconditions before Stage 1 starts

| # | Precondition | Status |
| --- | --- | --- |
| P1 | Separate explicit implementation instruction from the owner naming this plan | **Outstanding** |
| P2 | Accountant confirmation that policy B is suitable for financial reporting (and whether IAS 2 §23 reaches site stock) — external accounting validation | **Outstanding**, flagged in the decision record §7 |
| P3 | The unsupplied "item 11" from the original owner instruction, if it exists | **Waived by the owner (2026-10-16)** — directed to be ignored so the authorised implementation could proceed; no requirement is inferred from it. The decision record §1 carries the same waiver. If it is later found to have carried a requirement, this plan and the shipped code must be revisited. |
| P4 | Owner ruling on the three open plan details (below, "Decision points") | **Resolved (2026-10-16)** — PD-1 adopted as implemented (two construction migrations, in addition to the mandatory single-statement enum migration); PD-2 deferred by the owner, with the rationale and the known limitation recorded under "PD-2 — deferred"; PD-3 adopted (new suite plus one `gate.mjs` key). |
| P5 | Corrected baseline present in the working tree/history | **Met** — commit `4e2076f` (unpushed; pushing needs separate authorisation) |

## Open plan details (owner ruling requested — do not resolve unilaterally)

| # | Question | Recommendation |
| --- | --- | --- |
| **PD-1** | One construction migration or two (register vs command), in addition to the mandatory separate enum migration? | **Two** (`20261025000000` register, `20261026000000` command) for reviewable blast radius; the design's "one migration" phrasing is satisfied in substance. Merging into one file is acceptable if the owner prefers minimal migration count. |
| **PD-2** | Add a **partial** unique index on the shared `stock_movements` table `(business_id, source_type, source_id) where source_type = 'construction_return'` as a hard double-post guard? | **Deferred by the owner (2026-10-16)**, after a read-only pre-commit verification of the implemented command: the guard duplicates fences that already exist, and the index would add a build-time lock plus a forward-compatibility constraint to a shared table. Rationale and the limitation it leaves open are recorded in **“PD-2 — deferred”** below. **No migration is added for it.** |
| **PD-3** | Where do the return tests live — a new `tests/release/construction-returns.test.ts` suite plus a `gate.mjs` key, or appended to the existing 17-row `construction-procurement.test.ts`? | **New suite** (clear provenance, its own evidence artifact), with `gate.mjs` gaining one key and every existing key preserved. |

### PD-2 — deferred

**Ruling (owner, 2026-10-16).** The proposed partial unique index on `stock_movements` is deferred and no
migration is added for it. The rationale is the read-only pre-commit verification of 2026-10-16 (which changed no
schema, code or test):

1. **The duplicate it would guard against is already impossible for the command path.** Three independent fences
   exist: the advisory lock and replay check inside the command (`20261026000000:96,99-104`), the register's
   `unique (business_id, client_key)` (`20261025000000:77`), and the pre-existing **full** unique index
   `stock_movements_client_key_uidx (business_id, client_key)` (`20260813000003:35,43-45`) — which this command
   activates, because it passes the client key onto its movement (`20261026000000:216-224`). A retried or raced
   command is therefore refused before the index would ever see it.
2. **No query-plan benefit.** The identical three columns are already indexed non-uniquely
   (`idx_stock_movements_business_source`, `20261011000005:479-480`).
3. **Build cost and lock risk on a core table.** A plain `CREATE INDEX` takes a SHARE lock on `stock_movements`
   and blocks inventory writes while it builds. `CREATE INDEX CONCURRENTLY` cannot be combined with other
   statements in a migration file: the replay sends each file as a single `client.query`
   (`tests/release/database.mjs:71`), which PostgreSQL treats as a transaction block. Using it would need a
   separate build path and its own authorisation.
4. **Forward compatibility.** A unique `(business_id, source_type, source_id)` index fixes one movement per
   return row at schema level. A later approved design that legitimately writes two movements for one return
   (for example a usable / usable-with-restriction split) would then be blocked by a constraint rather than by a
   reviewed rule.

**Known limitation, recorded here for later review.** Movement writes through the command are command-only *by
convention, not by schema guarantee*: `public.stock_movements` carries a permissive insert policy
(`stock_movements_writer_insert`, `20261007000000:448`) and the application already inserts movements directly
over PostgREST (`src/dal/repositories/InventoryRepository.ts:158-261`). Where the deployed project's table
privileges allow it, a member could write a movement carrying any movement type — including
`construction_return_in` — without a register row. This is pre-existing for **every** movement type, not specific
to returns, and its blast radius here is bounded: a project's material cost is derived from the register, not from
movements (`construction_project_material_cost`), so a forged movement can distort a store's stock pool but
cannot create, relieve or misstate a project's recorded material cost.

**Revisit when:** a second writer of construction-return movements is ever introduced; a future phase needs more
than one movement per return; or deployed verification finds direct movement writes actually reachable in the
deployed environment.

---

## Stage 1 — Movement-type label `construction_return_in`

| | |
| --- | --- |
| **Objective** | Add the decided label additively, in its own migration, before anything consumes it |
| **File** | **new** `supabase/migrations/20261024000000_stock_movement_type_construction_return.sql` |
| **Object** | `stock_movement_type` gains `'construction_return_in'` — `alter type public.stock_movement_type add value if not exists 'construction_return_in';` (one statement, plus a header comment; mirrors `20261020500000`) |
| **Dependencies** | none. **Must be a separate file**: PostgreSQL cannot use a value added in the same transaction, and the R13 harness runs each migration file as one `client.query` (`tests/release/database.mjs:56-75`) |
| **Key tests** | Replay applies it (harness records the migration by sha256); a probe asserting `pg_enum` contains the new label **and** still contains `issue_out`; no other schema object changes |
| **Completion criteria** | Migration is exactly one statement; label present after replay; the two construction suites and the full release suite show no new failures; no client type or code file touched yet |

## Stage 2 — Returns register, privileges, RLS, indexes

| | |
| --- | --- |
| **Objective** | The append-only register that makes project-cost netting and traceability possible |
| **File** | **new** `supabase/migrations/20261025000000_construction_material_returns.sql` (PD-1) |
| **Objects** | Table `public.construction_material_returns` — `id`, `business_id`, `site_id`, `branch_id`, `location_id`, `project_ref`, `source_issue_id → construction_material_issues`, `product_id`, `uom`, `quantity`, `quantity_base`, `unit_cost_base`, `total_cost_base`, `currency`, `return_date`, `condition`, `reason`, `evidence_reference`, `received_by`, `notes`, `stock_movement_id → stock_movements`, `created_by`, `created_at`, `client_key`. Constraints mirroring `construction_material_issues`: `check (quantity > 0 and quantity_base > 0)`, `check (unit_cost_base > 0 and total_cost_base > 0)`, `check (condition in ('usable','usable_with_restriction'))`, reason/evidence presence via `_ledgr_construction_reason_present`, `unique (business_id, client_key)`; FKs to `businesses`, `construction_procurement_sites`, `branches`, `inventory_locations`, `products`, `stock_movements` and the source issue. Indexes `(business_id, source_issue_id)` (the cumulative check), `(business_id, return_date)`, `(business_id, project_ref)`. RLS: `enable row level security`, `revoke all … from anon, authenticated`, `grant select … to authenticated`, one policy `…_member_read` = `is_business_member(business_id) and can_access_branch(business_id, branch_id)`. Append-only: register the table in the `_ledgr_construction_append_only` trigger loop with an **empty** token. Catalogue: `insert into construction_procurement_capabilities … 'procurement.material.return' …` (`on conflict do update`, as `20261021000000:172-184`) — required before any grant, because `construction_procurement_grants.capability` has an FK to that catalogue and `grant_construction_procurement_capability` validates the code exists. Self-verification block covering the new table (the Stage A block `20261023000000:438-492` enumerates a closed 15-table set and will not cover it) |
| **Dependencies** | Stage 1 not required here; nothing in this stage consumes the enum |
| **Key tests** | Register exists with the expected constraints/indexes/policy (catalog probe); direct INSERT/UPDATE/DELETE as `authenticated` → `42501`; `anon` holds no privilege; a privileged writer is blocked by the append-only guard; the catalogue returns the new code through `construction_procurement_capabilities_for` |
| **Completion criteria** | Replay applies cleanly; policy predicate contains `can_access_branch` (self-verification raises otherwise); no grant to `anon`; the 19 existing construction tables are unchanged |

## Stage 3 — The return command `return_construction_materials_to_store`

| | |
| --- | --- |
| **Objective** | One `SECURITY DEFINER` command that derives everything, bounds everything, and writes exactly one movement |
| **File** | **new** `supabase/migrations/20261026000000_construction_return_command.sql` (PD-1) |
| **Object** | `public.return_construction_materials_to_store(p_payload jsonb, p_client_key uuid) returns jsonb`, `volatile`, `security definer`, `set search_path = public`; `revoke all … from public, anon` (execute to `authenticated`, `service_role`) |
| **Command contract** | 1. **Actor first**: `_ledgr_construction_actor(business, 'procurement.material.return')` — anonymous/non-member/no-capability → `42501`. 2. **Lock, then replay fence**: advisory lock — either the **key-scoped** form used by the journal command (a hash over business, source type and client key; `20261012000000:614`) or the **business-scoped** form used by the GRN command (a hash of a fixed construction-return prefix plus the business; `20261021000000:1980`); choose one and state it in the migration header. Then the `(business_id, client_key)` replay returning `{id, idempotent: true, stock_effect:'none'}`. 3. **Source issue derived**: `select … from construction_material_issues where id = … and business_id = … for update`; foreign/missing → `42501`/`22023`; `site_id`, `branch_id`, `location_id`, `project_ref`, `product_id`, `uom`, `unit_cost_base` all read from it (a payload that supplies them is refused). 4. **Authorisation**: `can_access_branch(business, branch_id)` and `can_access_location(business, location_id)` → `42501`. 5. **Quantity**: `quantity > 0`; `quantity_base := quantity × (issue.quantity_base / issue.quantity)` — the **recorded ratio**, never `construction_product_uom_conversions`; UOM must equal the issue's UOM. 6. **Cumulative bound**: `Σ existing returns for this issue + quantity_base ≤ issue.quantity_base` else `over-return` (`22023`); the `for update` on the issue row serialises concurrent partial returns. 7. **Policy and period**: `movement_posting_enabled` required, `gl_posting_enabled` must be false (`22023`), `_ledgr_assert_period_open(business, return_date, 'Material return')` → `period-closed`. 8. **Evidence/reason** mandatory; `return_date ≥ issue.issue_date`. 9. **Write exactly one movement + one register row** (`stock_movement_id` links them). 10. Return `{id, idempotent:false, project_ref, quantity_base, unit_cost_base, total_cost_base, journal_effect:'none'}` |
| **Dependencies** | Stage 1 (label) and Stage 2 (register + catalogue row) |
| **Key tests** | T1, T2, T3, T5, T7, T8, T15, T16 (mapping below) |
| **Completion criteria** | Every refusal raises before any write (no row, no movement — proven by before/after counts as in `CP.ROLLBACK.ATOMIC-COMMANDS`); a concurrent duplicate replays gracefully instead of raising 23505; the movement carries `client_key` |

## Stage 4 — Movement write, pool recalculation, double-count safeguards

| | |
| --- | --- |
| **Objective** | One inbound movement at the original cost, with the shared R06 writer re-pricing the pool — and no way to post it twice |
| **Objects** | The movement insert inside Stage 3's command: `movement_type = 'construction_return_in'`, `quantity = +quantity_base`, `unit_cost = issue.unit_cost_base`, `source_type = 'construction_return'`, `source_id = <return id>`, `location_id = issue.location_id`, `movement_date = return_date`, `client_key = p_client_key`, `created_by = actor`; plus **no change** to `_ledgr_apply_stock_movement_balance` / `trg_stock_movement_apply_balance` (`20260928000001:69-170`, `:222`) — the recalculation is the existing behaviour: `avg = (on_hand × avg + qty × unit_cost) / (on_hand + qty)` for any costed inbound. Optionally (PD-2) a **partial** unique index `(business_id, source_type, source_id) where source_type = 'construction_return'` |
| **Safeguards against double counting** | (a) the register's `unique (business_id, client_key)` + advisory lock; (b) `stock_movements_client_key_uidx` becomes a **live** fence for this path because it is the first *construction* command to pass a `client_key` on a movement (for construction writes today the index is inert, since every existing construction movement insert omits the key — design §9.4); (c) the command asserts the balance delta equals `quantity_base` in its response, and the tests assert **exactly one** movement per return; (d) PD-2's partial index as a database-level guarantee |
| **Dependencies** | Stage 1 (label), Stage 3 |
| **Key tests** | T1 (one movement, correct location/type/cost; `on_hand` rises by exactly `quantity_base`), T12 (pool average equals the value the approved policy produces), **T17** (a subsequent issue to a *different* project is costed at the recalculated average — the documented downstream effect of decision B item 5), T4 (replay ⇒ one movement) |
| **Completion criteria** | One movement per return under replay and concurrency; the recorded pool average matches the arithmetic the plan documents; no journal entry created; `gl_posting_enabled` untouched |

## Stage 5 — `construction_project_material_cost`: net returns, preserve the signature

| | |
| --- | --- |
| **Objective** | Net valid returns against issued quantity and cost while keeping the signature and `issue_count` |
| **Object** | `create or replace function public.construction_project_material_cost(p_business_id uuid) returns table(project_ref text, issue_count bigint, quantity_base numeric, material_cost numeric, currency text, first_issue_date date, last_issue_date date)` — **identical signature**, body changed: `quantity_base` and `material_cost` become `Σ issues − Σ returns` for the project; `issue_count` stays the count of issue records; the `can_access_branch` predicate from `20261023000000:296-330` is applied to **both** arms so a return cannot leak an out-of-branch project |
| **Dependencies** | Stage 2 (register must exist) |
| **Key tests** | T1 (cost falls by exactly `qty × issue unit cost`), a branch-visibility row extending `CPB.RPC.PROJECT-MATERIAL-COST` (A1-only cannot see an A2 return's effect), and a signature assertion (`information_schema.parameters` / `pg_get_function_arguments` unchanged); the existing `CP.ISSUE.PROJECT-COST` and two workspace page tests must still pass unchanged |
| **Completion criteria** | Signature byte-identical to today; `issue_count` semantics unchanged; existing 17 `CP.*` rows and 12 `CPB.*` rows pass without edits |

## Stage 6 — UI, repository, types, evidence capture

| | |
| --- | --- |
| **Objective** | Capture the return, its reason and its evidence, and show return detail from the register |
| **Files** | **new** `src/components/construction/ConstructionReturnsSection.tsx` (return form + register list, gated by the new capability via `gateForCapability`); `src/pages/construction/ConstructionWorkspacePage.tsx` (`SECTIONS` entry near `:31-38`, conditional render near `:134-149`); `src/dal/repositories/ConstructionProcurementRepository.ts` (capability constant at `:66-78`, `findMaterialReturns`, `returnMaterialsToStore` beside `:805`/`:1020`); `src/lib/construction/constructionCommandFeedback.ts` (new refusal tokens: `over-return`, `traceable-to-issue-required`, `return-date-before-issue`, …); `src/dal/types/database.ts` (`StockMovementType` union `:137-152` — also correct the stale "exact 10 members" comment and the missing `issue_out`); `src/dal/types/database.generated.ts` (regenerate); test mocks in `src/pages/construction/__tests__/ConstructionWorkspacePage.test.tsx` (`:32`, `:170`) and `ConstructionExceptionFlows.test.tsx` (`:35`, `:219`) |
| **Dependencies** | Stages 2–5 (the RPC and command exist) |
| **Key tests** | Component/page tests: the section is hidden without `procurement.material.return`; a return submits one RPC with the payload's `client_key`; a refusal renders its explanation; the register list shows quantity, cost and date; the page mocks are extended, not rewritten |
| **Completion criteria** | `npx tsc -b` and `npm run test:release:types` clean (unused locals are failures); page tests pass; no construction detail leaks into customer-facing invoice screens, PDFs or exports (Stage B boundary) |

## Stage 7 — Automated tests

| | |
| --- | --- |
| **Files** | **new** `tests/release/construction-returns.test.ts` (PD-3) + one key in `tests/release/gate.mjs` (all existing keys preserved) — or the same rows appended to `tests/release/construction-procurement.test.ts` with no wiring change |
| **Test set** | **T1** happy path (partial return; cost falls by `qty × issue cost`; one inbound movement at the issue's location; `on_hand` up by exactly `quantity_base`; `journal_effect 'none'`). **T2/T3** cumulative over-return refused, nothing written. **T4** same `client_key` replays with **one** movement; two connections via `db.createSecondClient` produce one row (the `CP.IDEMPOTENCY.CONCURRENT-GRN` pattern). **T5** no capability → `42501`; `anon` → `42501`; cross-business issue/site → `42501`; forged `site_id`/`branch_id`/`location_id`/`unit_cost_base` in the payload → refused. **T6** an A1-only user cannot return an A2 issue, and the A2 return is invisible on read (extends `CPB.*`; the new register needs its own row). **T7** a full return **succeeds with the store's `on_hand` at 0**, then a second attempt fails `over-return`. **T8** closed period → `period-closed`, nothing written (`CP.POSTING.POLICY-GATED:1215-1231` pattern). **T10** direct UPDATE/DELETE of the register → `42501` for `authenticated` and by the append-only guard for a privileged writer. **T11** no journal entry for the return (structural, `ledgerState`). **T12** the pool average before/after equals the value the approved policy produces. **T15** after the product's UOM conversion factor changes, `quantity_base` still comes from the issue's recorded ratio. **T16** a single capability holder can return a high-value quantity with no approval token and no `pos_approvals` write. **T17** a later issue to a different project is costed at the recalculated average |
| **Dependencies** | Stages 1–5 (server side); Stage 6 for the UI rows |
| **Completion criteria** | Every row above present and passing **locally isolated**; every refusal row asserts **no-write** by before/after counts; the two existing construction suites and `CPB.*` still pass; the gate reports no new BLOCKED row other than the pre-existing 57 |

## Stage 8 — Local validation, deployment prerequisites, hosted verification

| | |
| --- | --- |
| **Local validation (this repository)** | `LEDGR_TEST_ENV=local npm run test:release` (expect PASS/FAIL/BLOCKED counts updated only by the new rows; the pre-existing BLOCKED set unchanged), `npm run test:release:types`, `npx tsc -b`, `npm run build` with placeholder `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, `git diff --check`. Evidence is **local isolated** — embedded PostgreSQL, synthetic JWT claims, every probe rolled back |
| **Deployment prerequisites** | Migrations `20261024000000` → `20261025000000` → `20261026000000` applied **in filename order** to a non-production Supabase project, with the enum file committed before its consumer (a rebase or squash that reorders them breaks the deploy); a post-migration catalog check on the deployed project (label exists; register RLS enabled; `authenticated` SELECT-only; no `anon` grant; policy qual contains `can_access_branch`); `gl_posting_enabled` still `false` |
| **Hosted verification (separate authorisation, never production)** | Real Supabase Auth identities, not synthetic claims: capability grant/revoke, the cumulative bound, branch isolation for two real branch-scoped users, the period lock, idempotent replay over PostgREST, and exactly one movement per return — run in an **isolated** environment with the connectivity canary, positive control and service-role ground-truth method of `CONSTRUCTION_BRANCH_SCOPE_DECISION_2026-10-16.md` §5.4, so a denied operation is distinguishable from a broken run |
| **Completion criteria** | Local suite green with the new rows; the deployed catalog checks pass on the isolated project; the hosted verification produces its own evidence artifact. **Local success must never be described as production verification**, and `productionVerified` stays `false` until the hosted run is actually executed and recorded |

---

## Acceptance criteria for the phase as a whole

1. A return names one source issue; every other field is derived, and a payload that supplies scope or cost is refused.
2. Cost relief equals `returned quantity × the source issue's recorded unit cost`, and the store's pool re-prices exactly as documented — proven by T12 and T17, not asserted.
3. Cumulative returns can never exceed the issue's recorded quantity, under concurrency (T2/T3/T4).
4. Exactly one `construction_return_in` movement per return; no journal entry; `gl_posting_enabled` untouched.
5. `construction_project_material_cost` keeps its signature and its `issue_count` meaning while netting returns.
6. Reads of the register are business- and branch-scoped; writes are command-only; the register is immutable.
7. Every refusal path writes nothing (T2, T3, T5, T6, T8, T10).
8. The capability `procurement.material.return` alone authorises a return; no approval tier exists.

**Boundary reminder.** Nothing in Stages 1–8 touches wastage, abnormal loss, damage write-downs, NRV, supplier
returns, GL posting, the `gl_posting_enabled` CHECK, stock valuation rules for any other path, or the
accounting refusals recorded in the decision matrix §5b.
