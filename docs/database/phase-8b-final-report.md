# Phase 8B Final Report — Application-Critical Objects, RLS and Storage Reconstruction

**Date:** 2026-08-15
**Branch/PR:** `arena/phase-8b-reconstruction` → PR #96
**Phase status:** 🟡 **YELLOW — all critical objects reproducible, all security
tests pass, two UNKNOWNs documented (PAYE band values, legacy audit hash
algorithm); GREEN requires approved reference data + hosted-staging UI
validation.**

---

## 1. Executive Summary

Phase 8B reconstructed everything Phase 8A.1 proved was missing from the
repository — without touching production and without copying production
data:

| Workstream | Deliverable | Tests |
|---|---|---|
| 8B.1 RPCs | 9 RPCs + shared `audit_chain_hash` + 2 corrective migrations | 20/20 |
| 8B.2 Views | 4 views (trial balance, AR ageing, asset register, reorder alerts) | 8/8 |
| 8B.3 RLS | Policies for 24 tables; 6 fail-closed; full cross-tenant matrix | 41/41 |
| 8B.4 Storage | 2 buckets + policies | 8/8 |
| 8B.5+8B.6 Workflows & accounting | 19 app workflows + debits=credits per transaction | 16/16 |
| 8B.7 Fresh reproducibility | 61-migration replay == everything above; types regenerated | — |

**93/93 database test assertions pass** on a fresh 61-migration replay with
real RLS enforcement (`SET ROLE authenticated`). All repository checks pass:
`typecheck` ✅, `lint` ✅ (0 errors), `test` ✅ (229), `build` ✅.

**Bugs found & fixed in migration sources (never in the database):**
- `create_api_journal_entry` failed on fresh schema (missing NOT NULL
  `reconciled`) → `20260815000005`
- six NOT NULL defaults shadowed by the 8A.1 base migration →
  `20260815000001`

## 2. RPC reconstruction matrix (8B.1)

| RPC | Reconstructed | Evidence | Tested |
|---|---|---|---|
| `create_business_with_owner` | ✅ | CreateBusinessPage args, RegisterPage metadata, counter semantics, live defaults | ✅ |
| `seed_new_business` | ✅ | seedChartOfAccounts.ts (166-account GAAP COA), fiscalYear.ts | ✅ |
| `accept_invitation` | ✅ | AcceptInvitationPage contract, invite edge function flow | ✅ |
| `invite_member` | ✅ | TeamManagementPage, create-invite-link permission model | ✅ |
| `current_user_role` | ✅ | signature + membership model | ✅ |
| `get_user_role` | ✅ | signature + membership model | ✅ |
| `get_enum_values` | ✅ | signature + pg_enum | ✅ |
| `log_manual_audit_event` | ✅ | Journal/Period repository args; chain-consistent | ✅ |
| `verify_audit_chain` | ✅ | AuditLogRepository output contract; tamper detection tested | ✅ |

Every behaviour tagged `[VERIFIED]`/`[INFERRED]`/`[UNKNOWN]` in
`docs/database/phase-8b-rpc-reconstruction.md`.

## 3. View reconstruction matrix (8B.2)

| View | Columns match generated types | Semantics source | SUM(d)=SUM(c) | Tested |
|---|---|---|---|---|
| `v_trial_balance` | ✅ 9/9 | FinancialStatementRepository.computeBalances | ✅ 4400=4400 | ✅ |
| `v_ar_ageing` | ✅ 13/13 | IncomeRepository.findOutstanding + amount_due derivation | — | ✅ |
| `v_asset_register` | ✅ 17/17 | AssetsPage NBV formula, AssetRepository | — | ✅ |
| `v_reorder_alerts` | ✅ 12/12 | WarehousePage alert condition | — | ✅ |

All views are `security_invoker` (RLS flows through from underlying tables).
Full detail: `docs/database/phase-8b-view-reconstruction.md`.

## 4. RLS policy matrix (8B.3)

- **24 tables** now have policies using the repository's own verified
  helpers (`is_business_member`, `can_write_business_data`,
  `can_admin_business_data`, `can_view_payroll`, `can_write_payroll`,
  `can_read_audit`, `is_platform_admin`).
- **6 tables** deliberately remain deny-all (service-role only):
  `api_usage` (pinned by `rlsIsolation.test.ts`), `ai_insights_usage`,
  `support_agent_usage`, `subscription_reminders_sent`,
  `business_terms_acceptances`, `profiles`.
- `audit_log` is **immutable** for clients (SELECT via `can_read_audit`
  only; writes exclusively through the SECURITY DEFINER RPC).
- Full matrix: `docs/database/phase-8b-rls-matrix.md`.

## 5. Storage configuration (8B.4)

- `business-logos` (public): authenticated INSERT/UPDATE scoped to the
  caller's own businesses via the verified `${business.id}/` path prefix,
  plus the SELECT policy required by `INSERT ... RETURNING`.
- `user-exports` (private): no client policies; service-role uploads +
  signed URLs.
- Detail: `docs/database/phase-8b-storage.md`.

## 6. Security test results (8B.3, 41/41)

- **NO CROSS-TENANT READ / INSERT / UPDATE / DELETE** — demonstrated across
  ORG-A (owner/admin/accountant) vs ORG-B (owner/viewer) for contacts,
  products, journal lines, team lists, profiles, employees, audit log.
- Anonymous denied on all tables.
- Role tiering correct: writer set can insert/update; owner/admin only can
  hard-delete; payroll tier per 20260728000009 (accountant included — the
  repo's own model); audit read per `can_read_audit`; viewer cannot write
  anywhere.
- audit_log immutability: direct INSERT/UPDATE/DELETE denied.
- RPC boundary: `log_manual_audit_event` on another business denied.

## 7. Cross-tenant test results

See §6 — every sensitive table tested both directions with the exact
ORG-A/ORG-B matrix from the phase brief (A-owner→A/B, A-user→A/B,
B-owner→A/B, anonymous→A/B, SELECT/INSERT/UPDATE/DELETE). No cross-tenant
access was possible.

## 8. Accounting integrity results (8B.6, all PASS)

| Transaction | Debits | Credits | Result |
|---|---|---|---|
| Purchase (stock receipt) | 1000 | 1000 | ✅ |
| Sale (COGS) | 700 | 700 | ✅ |
| Sale (revenue + VAT) | 1500 | 1500 | ✅ |
| Payment received | 500 | 500 | ✅ |
| Expense + payment | 300 | 300 | ✅ |
| Payroll run | 400 | 400 | ✅ |
| API journal entry | 50 | 50 | ✅ |
| **Trial balance** | **4400** | **4400** | ✅ |

Tolerance matches `JournalRepository.validateBalanced` (≤ 0.005).

## 9. Application workflow results (8B.5, 16/16)

Register → business → branch → member → customer → supplier → product →
purchase → sale → invoice → payment → expense → bank reconciliation →
payroll → trial balance → AR ageing → asset register → reorder alerts →
audit chain → API/webhook. All exercised at the database layer with real RLS
and the app's actual write patterns. (Frontend-only items — PDF generation,
AI insights chat, storage upload UX — require a hosted-staging UI
click-through; see recommendations.)

## 10. Fresh database reproducibility results (8B.7)

- A completely fresh disposable PostgreSQL is created for **every** test
  run (5 suites) from **repository migrations only** + documented
  Supabase-platform stubs (auth/storage/pg_cron/pg_net).
- **61/61 migrations replay cleanly.**
- Approximate types regenerated from the final fresh schema
  (`artifacts/database/fresh-database.generated.approx.ts` — 65 tables, 16
  enums) and `fresh-schema.json` refreshed.
- No Studio-created objects, no manual SQL outside migrations, no production
  data (all test data is fake).

## 11. Remaining UNKNOWN items

| ID | Item | Impact | Evidence status |
|---|---|---|---|
| U-01 | **Malawi statutory PAYE band values** (the original `seed_new_business` seeded them; values were never in the repo) | Payroll PAYE computes 0 until bands are added | [UNKNOWN] — documented in 8B.1 |
| U-02 | **Legacy audit hash algorithm** (the original `log_manual_audit_event` may differ) | Fresh chains are self-consistent; *legacy* chains (from the old database) cannot be verified | [UNKNOWN] — documented in 8B.1 |
| U-03 | Original ageing bucket labels / `estimated_reorder_cost` formula | Cosmetic | [INFERRED] |
| U-04 | Storage `file_size_limit` / MIME restrictions on legacy buckets | No evidence; left NULL | [UNKNOWN] |

## 12. Remaining risks

| Risk | Severity | Mitigation |
|---|---|---|
| Legacy audit rows unverifiable if algorithm differs | Low (fresh DB) / Medium (legacy) | Authorized production capture of one legacy row to reverse-check |
| PAYE bands absent → payroll under-taxes until configured | Medium | Approved reference data migration (recommended next) |
| Reconstructed RPC/view bodies differ subtly from legacy | Low | All consumers (pages/repos) tested against the reconstruction; behavioral contracts verified |
| Hosted-staging UI click-through not performed (sandbox limitation) | Low | Recommended before Phase 9 |

## 13. Recommended Phase 9

1. **Approved reference data migration**: Malawi PAYE bands (2025/26),
   default tax configurations, any chart-of-account tweaks — reviewed and
   signed off as *approved seed/reference data*.
2. **Hosted-staging UI validation**: run the 25-workflow click-through from
   the 8B.5 brief against `ledgr-staging` (now fully migrated) with fake
   data; verify PDFs, AI insights, storage upload UX end-to-end.
3. **Authorized legacy audit sample**: capture 1–3 `audit_log` rows from
   production (read-only, separately authorized) to confirm the hash
   algorithm; if different, add a verification shim.
4. **Exact type regeneration**: run `supabase gen types typescript` against
   staging (now possible — the CLI is installed and migrations apply) and
   migrate the supplement entries into `database.generated.ts`.
5. **Rotate the staging DB password** (it appeared in chat during setup).
6. **Delete the local-only `arena/phase-8a1-base-migration` and stale
   branches** once PR #96 merges.

---

## Final status

## 🟡 YELLOW

**Why not GREEN:** the certification rules require *all* critical RPCs,
views, policies, storage, accounting and workflows to be verified — all of
which now pass at the database layer — **plus approved seed/reference data**
(PAYE bands are UNKNOWN and not fabricated) and the fresh database to
reproduce the environment (verified). The remaining UNKNOWNs are documented
and non-blocking for security (no cross-tenant access is possible; audit
immutability holds; accounting balances).

**Why not RED:** business creation works, cross-tenant access is impossible
(41/41 security tests), accounting entries balance, payroll isolation
holds, audit integrity holds, all critical views produce correct results,
and no production data is required for staging to work.

**Gate to GREEN:** (1) approved PAYE-band reference-data migration,
(2) hosted-staging UI click-through (sandbox limitation), (3) exact type
regeneration. All three are listed in Phase 9 recommendations.
