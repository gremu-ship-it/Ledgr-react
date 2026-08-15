# Phase 9.1 — Exact Database Type Regeneration

**Status:** ANALYSIS COMPLETE — regeneration is **BLOCKED in this sandbox**
(Supabase network unreachable: `https://supabase.co` → connection failure),
so the exact `supabase gen types typescript` run against hosted staging must
be executed by a machine with network access (the Supabase CLI is already
installed on the staging-admin machine). Everything downstream of that run is
specified here.

## 1. Prerequisites (order matters)

1. **Deploy the merged Phase 8B migrations to staging** — run the
   **Deploy (staging)** workflow (main → staging). This applies
   `2026081500000{0,1,2,3,4,5}_*.sql` so staging contains the reconstructed
   RPCs, views, RLS and storage objects. Types regenerated before this step
   would omit the Phase 8B objects.
2. Confirm the deploy is green (`Link & migrate staging database` step).

## 2. Exact regeneration command

From the repo root, on a machine with the Supabase CLI (already installed:
`supabase --version` → 2.114.0) and the **staging** DB password:

```bash
supabase gen types typescript \
  --db-url "postgresql://postgres:<STAGING_DB_PASSWORD>@db.bkxzgkurcqvccsdjmqzg.supabase.co:5432/postgres" \
  > src/dal/types/database.generated.ts
```

- Use the **direct** host (`db.<ref>.supabase.co:5432`), not the pooler.
- The password is the `ledgr-staging` DB password (the one set during
  Phase 8A.1 setup; rotate it afterwards — see the final report).
- Do **not** hand-edit the generated file (Phase 9.1 rule).

## 3. What the regenerated file will contain (expected)

| Object class | Expected in regenerated file |
|---|---|
| Tables | 65 (40 base + 25 migration-created) — same as the fresh replay |
| Enums | 16 |
| Views | 7 — the 3 original (`v_cash_flow`, `v_inventory_ledger_variance`, `v_partner_client_usage`) + the **4 Phase 8B reconstructions** (`v_ar_ageing`, `v_asset_register`, `v_reorder_alerts`, `v_trial_balance`) |
| Functions | all migration-created RPCs incl. the **9 Phase 8B reconstructions** + `pg_trgm` helpers |
| CompositeTypes | none |

## 4. `database.supplement.ts` — obsolescence analysis

Current supplement contents (10 objects):

| Supplement object | Created by migration | After regeneration |
|---|---|---|
| `api_keys` | 20260727000001 | **obsolete** — will be in generated types |
| `api_usage` | 20250724_api_usage | **obsolete** |
| `webhooks` | 20260727000001 | **obsolete** |
| `webhook_deliveries` | 20260727000001 | **obsolete** |
| `partners` | 20260727000002 | **obsolete** |
| `partner_feature_flags` | 20260727000002 | **obsolete** |
| `partner_clients` | 20260727000002 | **obsolete** |
| `partner_admins` | 20260727000004 | **obsolete** |
| `partner_invoices` | 20260727000003 | **obsolete** |
| `v_partner_client_usage` | 20260727000008 | **obsolete** |

**Verdict: all 10 supplement entries become obsolete.** They were
hand-transcribed because `database.generated.ts` predated their migrations;
the regenerated file derives from the same migrations, so the definitions
will be present and identical.

Also note: 6 further tables used via untyped casts (`ai_insights_usage`,
`business_terms_acceptances`, `invoice_delivery_events`, `recurring_invoices`,
`subscription_reminders_sent`, `support_agent_usage`) will now appear in the
generated types, letting consumers drop their `as never` casts.

## 5. Removal procedure (safe)

1. Regenerate types (step 2). Run `npm run typecheck` — expect **errors**:
   duplicate definitions from the supplement merge.
2. Delete `src/dal/types/database.supplement.ts`.
3. Update `src/dal/types/database.ts`: remove the supplement import/merge so
   it is a plain re-export of `Database` from `database.generated.ts`.
4. `npm run typecheck` → must pass with zero errors.
5. `npm run lint && npm run test && npm run build` → must pass.
6. `grep -rn "database.supplement" src/` → no remaining references.
7. Optionally remove the now-unnecessary `as never` casts (not required).

## 6. Verification after regeneration

- `git diff --stat src/dal/types/database.generated.ts` — expect large diff.
- Spot-check: `grep -c "v_trial_balance" src/dal/types/database.generated.ts`
  → ≥ 3 (Row + Relationships).
- Spot-check: `grep -c "create_business_with_owner" ...generated.ts` → ≥ 1.
- `npx supabase gen types typescript --db-url ... | diff - src/dal/types/database.generated.ts`
  → empty (deterministic regeneration).

## 7. Remaining manually maintained types (expected after cleanup)

| Type | Why it remains |
|---|---|
| `src/dal/types/database.supplement.ts` | **Deleted** (obsolete) — nothing should remain |
| `Row`/`InsertDto`/`UpdateDto`/`Json` helpers in `database.ts` | Thin generics over generated types; remain as app conveniences, not schema definitions |
| Any table/column types in `src/types/*` | Check: they should be `Row<'table'>`-derived; any duplicated hand-written shape found during cleanup should be migrated to `Row<>` |

The goal: **`database.generated.ts` is the only schema type source of
truth.**
