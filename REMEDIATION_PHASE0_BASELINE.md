# Ledgr — Remediation Phase 0: Baseline

**Date:** 2026-08-13
**Auditor/engineer:** Senior Backend/DB/Security/Accounting remediation pass

## Branch & commit

| Item | Value |
|---|---|
| Branch | `arena/019ffa8d-ledgr-react` |
| Commit | `6c5fc50a924e143d2155f249b90b5e4906ea847f` (merge of PR #90, `main`) |
| Uncommitted changes | Only `POST_REMEDIATION_VERIFICATION.md` (this remediation's input report) |

## Environment limitations

- **No live Supabase project / database / credentials available.** RLS policies, triggers, RPCs and any database-side behaviour can be *written and statically reviewed* but **cannot be executed** against a live database in this environment. Anything runtime-dependent is reported `NOT VERIFIED`, not `PASS`.
- No staged deployment, no test dataset. End-to-end accounting/PDF/offline/tax/payroll/branch workflows cannot be reproduced here.
- `schema.sql` is **empty** (0 bytes). The core financial schema (`invoices`, `invoice_lines`, `journal_entries`, `journal_lines`, `accounts`, `invoice_payments`, `expenses`, `expense_lines`, `expense_payments`, `businesses`, `business_users`, `products`, `stock_movements`, `payroll_*`) is **created out-of-band**, not in `supabase/migrations/`. Migrations therefore use idempotent `alter table … add column if not exists` / `create index if not exists` / `to_regclass()` guards.

## Relevant files / objects reviewed this pass

- RLS helpers: `is_business_member`, `can_write_business_data`, `can_admin_business_data`, `can_write_payroll` (`20260728000008`, `20260728000009`), `is_partner_admin`, `business_partner_id` (`20260727000004`).
- Unprotected tables (confirmed): `invoice_delivery_events`, `recurring_invoices` (`20260725000001`), `api_usage` (`20250724` / `20260727000001`), `currencies` (`20260727000000`). None has `enable row level security`.
- Payment increment RPC: `increment_amount_paid` (`20260730000004`) — **rejects `p_amount <= 0`**, yet `JournalRepository.reverse()` calls it with a **negative** amount.
- Document number reservation: `reserve_next_document_number` (`20260728000011`) — correct, atomic, permission-gated.
- Rate limiting: `consume_api_rate_limit` RPC + `create_api_journal_entry` RPC (`20260730000003`) — service-role only.
- Dead code: `supabase/functions/api/middleware.ts` still present (buggy, never imported).
- Offline: `src/offline/{db,syncEngine,payloads,queueApi,offlineSyncContext}.ts` — queue with statuses `pending/syncing/synced/failed`; **no idempotency key**; `syncItem` performs plain inserts, so an interrupted sync after server-commit but before local `synced` mark will **duplicate** on retry.
- Payment reversal: `JournalRepository.reverse()` (negative-amount RPC call, error swallowed).
- Invoice/expense payment: `InvoiceRepository.recordPayment`, `ExpenseRepository.recordPayment` (status guard UI-only; `InvoiceRepository` checks `void`/`credit_note` only *after* insert; references non-existent `voided`/`credited` in UI).
- VAT barrier: present in `IncomePage`, `ExpensesPage`, `QuickExpenseMobile`, `QuickIncomeMobile`; **absent from `InvoicesPage.tsx`**.
- Quantity integrity: main invoice/expense flows use `Number(line.quantity)` (not forced to 1). Mobile quick-add deliberately defaults to `quantity: 1` (single-unit quick entry, no quantity input) — noted as a product limitation, not a bug.
- Discounts: posted to 4130 (sales discount, contra-revenue) and 4260/5175 (purchase discount); accounts seeded (`20260811000001`).

## Existing tests (baseline)

`npm run test` → **202 passed / 24 files** (green). `tsc -b`, `eslint`, `vite build`, `npm audit` all green. No failing tests.

## Baseline conclusions (findings to fix)

- **P0** RLS on 4 tables missing.
- **P0** dead `middleware.ts` present.
- **P1** payment reversal negative-amount regression + swallowed RPC error.
- **P1** void/credit-note payment guard is UI-only (enforce at repository/DB).
- **P1** invoice VAT barrier missing from invoice builder.
- **P1/P2** offline sync lacks idempotency → duplicate risk on retry.
