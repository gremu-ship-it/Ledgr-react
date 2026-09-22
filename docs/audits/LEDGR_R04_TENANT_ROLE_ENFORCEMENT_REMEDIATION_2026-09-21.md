# Ledgr — R04 Tenant/Role/Branch Enforcement (Contacts Write Boundary) Remediation Report

**Date:** 2026-09-21 (Africa/Johannesburg)
**Package:** R04 — tenant/role/branch enforcement, release-suite-anchored failure (contacts write tier)
**Baselines of record:** R03 approved (**583/4/54, 641**); R02 approved (22/0/13); R01 approved (436 outcome objects); historical R13 immutable **106/7/41**
**Outcome:** The R04-anchored failing expectation `ROLE.cashier.write` is remediated and verified. Combined release suite **593 PASS / 3 FAIL / 54 BLOCKED / 0 N/A (650 records)**; deterministic repeat byte-identical; R01/R02/R03 evidence byte-identical; historical R13 preserved. **Work stops here — the wider R04 register programme (branch matrix DEC-03, remaining table scopes) requires separate authorization.**

---

## 1. Authorization and scope discipline

Continuation instruction (post-R03 review): proceed with the next package in programme order. R04's register entry (`LEDGR_REMEDIATION_CHANGE_IMPACT_REGISTER_2026-09-21.md`, *"R04 — Tenant/role/branch enforcement"*) describes a broad, DEC-03-dependent programme touching ~44 tables. The release harness anchors **exactly one** currently-failing R04 expectation, and that is the scope executed here:

- **In scope, completed:** `ROLE.cashier.write` (FAIL→PASS) — cashier direct `contacts` INSERT must be denied at the database boundary, without breaking the cashier's authorised contact path (the `post_pos_sale` command).
- **In scope of package but not resolvable in code today — handled as design decisions:** the eight `BRANCH.*` BLOCKED records need the DEC-03 branch-assignment decision ("no approved durable user-branch assignment contract. Refusing to invent assignment schema"); the two `TENANT.*.storage` BLOCKED records need an R13/bootstrap default-privileges parity review. §12 records both with proposed direction and explicit non-implementation.
- **Prohibitions honoured:** no phone/OTP/invitation changes; no POS stock/refund/shift changes (POS.STOCK remains R06-owned FAIL); no subscription/offline changes; no production or customer data; no opportunistic fixes outside the anchored failure.

## 2. Fixed baselines and contracts preserved

| Contract | State at R04 close | Evidence |
|---|---|---|
| Historical R13 baseline | **106/7/41 immutable**; original expectations unedited | §10 |
| R03 approved results | **583/4/54 (641)** reproduced byte-identical except the single intended flip | §10 |
| R01 evidence | 436 outcome objects byte-identical | §10 |
| R02 evidence | 35 records byte-identical (22/0/13 behaviour preserved) | §10 |
| `AI.ANON`/`AI.ROLE` | remain PASS (R03 product fix intact) | rerun both runs |
| Original failing expectation | **Fixed intent** — `ROLE.cashier.write` assertion untouched; product now satisfies it | §8.2 |
| Denial-verification standard | Every new denial statement asserts 42501 **and** zero returned rows; allowed flows assert scope and post-state immutability | §8.1 |

## 3. Investigation inventory (conducted before any change)

| Component | Path / object | Role in finding |
|---|---|---|
| Anchoring expectation | `ROLE.${role}.write` loop, `tests/release/database.test.ts:83` — contact INSERT denied for **viewer, cashier**; allowed for owner/admin/accountant/stock_clerk/branch_manager | authoritative intent |
| Shared write tier | `public.can_write_business_data(uuid)` (last replaced in `20260922000000_pos_role_write_scope.sql`) — 18-role canWrite mirror incl. both POS roles | defect carrier |
| Contacts policy lineage | `20260728000008_role_aware_master_data_rls.sql` (drops any pre-existing contacts policies; rebuilds `member_read`, `writer_insert`, `writer_update`, `admin_delete`, `platform_admin_read`), grants DML to authenticated | writer policies bind shared tier |
| POS write tiers precedent | `20260922000000` `can_write_sales_data` (minus stock_clerk) / `can_write_expense_data` (minus cashier+stock_clerk) with per-module single-role-exclusion comments | fix pattern |
| Authorised cashier contact path | `post_pos_sale()` (`20260923000000`, SECURITY DEFINER) resolves/creates the billed walk-in contact itself — *"so a cashier needs no direct INSERT on contacts"* (its own header/comment) | makes narrowing non-breaking |
| UI role semantics | `usePermissions.ts` (`canWrite`), `isPathAllowedForRole` (cashier: POS/sales paths only), `src/types/pos.ts` `DEFAULT_ROLE_PERMISSIONS` | role-model evidence |
| Staging inventories | `artifacts/database/staging-schema-inventory.json` confirms live policies = the uniform set | environment parity check |
| Client direct contacts writes | cashiers have no direct contacts write in POS services (`posService`, `posSaleRpc` read/execute only) | no client regression path |

## 4. Reproduced vulnerability

A cashier session (role `authenticated`, confirmed `business_users` membership, role `cashier`) executed:

```sql
insert into public.contacts(business_id,name,contact_type,is_active,wht_exempt)
values ($1,'R13 role probe','customer',true,false) returning id
```

**Before:** the insert completed. `contacts_writer_insert` evaluated `can_write_business_data`, whose 18-role list includes `cashier` (correct there for invoices/POS journeys) — but contacts are customer/supplier master data, outside the cashier's operational scope (DEC-03: *"cashier sale/catalog/own-shift only"*). Baseline `actual` verbatim: *"Forbidden operation completed without permission denial."*

Mechanism in one line: a **shared** write tier covering POS-sales writes was reused — via the uniform master-data policies — to gate customer master-data writes, where the cashier role must not appear.

## 5. Enforced boundary model

1. Contacts writer policies now bind a **scoped** tier `can_write_contacts_data()` = `can_write_business_data` minus exactly `cashier` (17 roles — every other role byte-identical, including the retained `stock_clerk` per the original matrix).
2. The cashier's authorised contact journey is the **SECURITY DEFINER** `post_pos_sale()` command, which resolves or creates the walk-in contact inside the command — unchanged and verified working (§8.1).
3. No other table's policy set was touched; branches/departments/inventory_locations keep the shared tier (no anchored failing expectation, and altering them would be speculative scope).
4. Members' read tier (`contacts_member_read`) is unchanged and verified not over-narrowed; foreign-tenant invisibility preserved.
5. Server-side enforcement only; no UI change needed for this boundary and none made.

## 6. Changes (complete list — 3 files)

### 6.1 `supabase/migrations/20260927000001_r04_contacts_writer_scope.sql` (new)
- `can_write_contacts_data(uuid)` scoped tier (SECURITY DEFINER, `auth.uid()` membership + role list minus cashier; comment records the mirror and the keep-in-sync rule); `REVOKE … FROM public`; `GRANT` to `authenticated`/`service_role` only.
- Re-points **only** `contacts_writer_insert` / `contacts_writer_update` to the scoped tier (`WITH CHECK` for update, blocking tenant moves).
- In-file `DO` verification: policy end state (both writers bound, no contacts policy still references the wider tier), function end state (no permitted `'cashier'` literal, grants correct), and claim-based behavioural probes (non-member must not pass). Fails loudly on any mismatch.
- Preconditions + documented rollback/containment header (re-point back to the shared tier and drop the helper — emergency-only, explicitly marked as re-opening the vulnerability).

### 6.2 `tests/release/r04-roles.test.ts` (new, 9 statements)
House-standard evidence suite on its own embedded-PG replay; statements enumerated in §8.1. Development-transparency note: the POS-path control initially over-asserted the returned payload would echo the client `receipt_number`; the proven RPC shape returns a server invoice number — the assertion was corrected (strengthened, never weakened) to require the posted document's id, `INV-*` number and balanced journal entries **before any evidence was recorded**.

### 6.3 `tests/release/gate.mjs`
Suite registration only: `'r04-roles.test.ts': 'r04-roles.json'`.

## 7. Database change statement

One helper function created and two policies re-pointed. **No** table, view, trigger, extension or data row modified; revocations only (no privilege broadening); full R13 replay (now 89 migrations) applies cleanly; fixture data demonstrated unaltered (`R04.CONTACTS.DATA-UNCHANGED` + the 640 byte-identical common records including `DB.FIXTURE`).

## 8. Test coverage

### 8.1 New `R04.*` statements (9/9 PASS)

| Record | Boundary | Scenario and dual-denial/allowed evidence |
|---|---|---|
| R04.CONTACTS.WRITER-MATRIX | DB | 7 seeded roles: cashier/viewer **denied 42501 with zero rows**; the 5 allowed roles insert one row; post-matrix count untouched (probes roll back) |
| R04.CONTACTS.POS-SALE-PATH-PRESERVED | DB | Cashier completes `post_pos_sale` — posted document (id, `INV-*`, `journal_entry_id`, `cogs_entry_id`) proves the authorised contact path |
| R04.CONTACTS.CROSS-ORG | DB | cashier→B, owner→B, B_owner→A foreign inserts denied; own-org owner/owner controls pass; count stable |
| R04.CONTACTS.ANON-DENIED | DB | anonymous **and** empty-UID authenticated contacts writes denied 42501 |
| R04.CONTACTS.POLICY-END-STATE | DB catalog | contacts policy set == the 5 known uniform policies; writer quals bind only `can_write_contacts_data`; zero references to the wider tier |
| R04.CONTACTS.TIER-DEF-MIRROR | DB definition | the 17 exact permitted role literals present; no permitted `'cashier'` literal |
| R04.CONTACTS.TIER-GRANTS | DB ACL | anon denied, authenticated/service_role retained |
| R04.CONTACTS.READ-UNCHANGED | DB | cashier/viewer keep own-org read (1 row); foreign tenant invisible (0 rows) — no over-narrowing |
| R04.CONTACTS.DATA-UNCHANGED | DB | contacts=2, memberships=14, branches=4 unchanged after all probes |

### 8.2 Original failing expectation now satisfied (assertions untouched)

| Record | Owner | Before | After | Changed fields |
|---|---|---|---|---|
| `ROLE.cashier.write` | R04 | FAIL — "Forbidden operation completed without permission denial." | **PASS** | `actual`, `status` only |

All six sibling `ROLE.*.write` expectations remain byte-identical (viewer still denied; admin/accountant/owner/stock_clerk/branch_manager still allowed and unchanged).

## 9. Combined release-suite results

| Run | Purpose | PASS | FAIL | BLOCKED | N/A | Records |
|---|---|---|---|---|---|---|
| `ledgr-r13-EIPGdg` | R03-final = R04 baseline | 583 | 4 | 54 | 0 | 641 |
| **`ledgr-r13-xkibav`** | **R04 final** | **593** | **3** | **54** | **0** | **650** |
| `ledgr-r13-qAGJV9` | Deterministic repeat of final | 593 | 3 | 54 | 0 | 650 |

Movement: +1 flip (`ROLE.cashier.write`), +9 new records, zero regressions. Surviving FAILs are separately owned: `EDGE.RETRY.no-secret` (R12/R14), `EDGE.WEBHOOK.viewer` (R12), `POS.STOCK` (R06). Notably the R13-anchored R04 set is now: 1 fixed, 8 awaiting DEC-03, 2 awaiting R13/bootstrap review (§12).

## 10. Integrity and preservation comparison (machine-checked, `.cache/r04/comparison.json`)

- 641 common records → **640 byte-identical**; single declared flip with changed fields exactly `{actual, status}`. **Additions 9** (all `R04.*`), **removals 0**.
- **Repeat determinism:** repeat vs final — 0 non-identical records, 0 missing/extra across all 650.
- **R01 preservation:** all 436 objects byte-identical. **R02:** all 35 records byte-identical. **R03:** all 16 records byte-identical (AI boundary intact).
- **Historical R13:** immutable 106/7/41 preserved; BLOCKED records never simulated as PASS.
- **Migration delta:** exactly `20260927000001_r04_contacts_writer_scope.sql` appended; ordering intact (machine-verified).
- Source fingerprints (sha256-16): migration `3056e67b2e2bf737`; r04-roles.test.ts `9ac7cf0ec6d280ac`; gate.mjs `cf1c0201c65d13d2`.

## 11. Full regression stack (all green at R04 close)

| Check | Result |
|---|---|
| Root unit/integration suite | **658 passed / 658** |
| Release-suite types | PASS |
| App types (`tsc -b`) | PASS |
| Combined release suite + repeat | 593/3/54 twice, byte-identical (0 diffs) |
| Lint | exit 0 (one pre-existing warning in untracked generated artifacts file, unchanged from R03) |
| `node --check` | PASS |
| esbuild bundle 26/26 edge functions | PASS (no edge handler was modified) |
| Placeholder production build | PASS (`built in 1.98s`) |
| Whitespace / `git diff --check` | PASS |

## 12. Remaining findings and package ownership

| Item | Status | Owner | Path forward (proposed, NOT implemented) |
|---|---|---|---|
| `BRANCH.read/create/modify/reports/inventory/customers/financial/cross-branch-admin` | **BLOCKED (8)** | DEC-03 → R04/R08 | Approve the durable branch-assignment contract first (minimal direction: an explicit user→branch assignment relation + server-side scope helper `can_access_branch`, with an all-branch opt-in role flag); only then implement branch predicates. No schema invented here. |
| `TENANT.{A,B}.storage` | **BLOCKED (2)** | R13/R04 bootstrap | Harness environments emulate *migration-only* ACL; the storage self-logo policy needs Supabase's default-privileges parity (effective `business_users` SELECT in the bootstrap) reviewed before any grant emulation is added. |
| Surviving 3 FAILs | FAIL (pre-existing) | R12/R14, R12, R06 | outside this package |
| Wider R04 register programme (~44 tables, role/action/scope matrix, mixed-tenant FK validation) | sequenced — R05–R08 command packages first | R04 programme | its own authorisation turn; nothing opportunistically touched |
| Nominal-viewer mutation review beyond anchored records | unchanged by R04 | R04 programme | covered by the same sequenced matrix work |

## 13. Prohibitions and operational status

All evidence is synthetic (embedded PostgreSQL 17, synthetic identities, network/mail blocked). No production, staging, or customer data was accessed. Phone OTP/recovery, invitations, POS stock/refunds/shifts, subscription enforcement, offline sync and modules were not modified (POS appears only as a *preserved allowed-path* verification of its intended command). The hosted database gains this boundary on the next ordinary deployment; this report asserts local-boundary behaviour only.

## 14. Stop declaration

The R04 release-suite-anchored failure is remediated with fixed-intent satisfaction, 9 new boundary statements are green, preservation/integrity is machine-verified, and this report is delivered. The remaining R04-programme items are design-gated (DEC-03) or sequenced with R05–R08 and were not opportunistically started. **Work stops here — no further package begins without separate review and authorization.**


---

## Addendum 2026-09-21 (post-phase field evidence): `revoke … from public` must name `anon` on Supabase-flavored databases

During manual application of `20260927000001_r04_contacts_writer_scope.sql` to a real Supabase project, the file's own §3b verification failed at *"contacts tier grant surface wrong"*, failed run rolled back fully (later diagnostics: function absent). Root cause: Supabase's stock `alter default privileges in schema public grant all on functions to anon, authenticated, service_role` auto-stamps an **explicit `anon` EXECUTE** onto freshly created functions; `revoke all … from public` does **not** remove that explicit grant (it only strips PUBLIC's). The verification behaved exactly as designed (fail-closed on a real exposure) — the *invariant* was under-expressed. Fix applied in place (file unapplied anywhere by definition — every attempted run had rolled back): line 102 now reads `revoke all on function public.can_write_contacts_data(uuid) from public, anon;` with an explanatory comment, mirroring R01/R03/R07/R08 revoke shapes. Reproduction+fix proven in the governed sandbox: with emulated Supabase default privileges, public-only revoke leaves `anon` EXECUTE (`true`) and the hardened revoke yields `anon=false, authenticated=true, service_role=true`. Full release protocol re-run twice after the edit: **PASS 648 · FAIL 2 · BLOCKED 51, 0 cross-run diffs** — no outcome moved. Related hygiene observation (deferred, outside this phase): `20260928000001_r06_stock_balance_authority.sql`'s `_ledgr_apply_stock_movement_balance()` has no explicit revoke; it is a `returns trigger` internal helper (not meaningfully invocable via RPC), recorded for a future hardening pass.
