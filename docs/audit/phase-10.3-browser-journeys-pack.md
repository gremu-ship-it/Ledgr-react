# Phase 10.3 — Hosted-Staging Browser Journeys (A-09 → A-12) Execution Pack

**Target:** https://ledgr-react-prod.vercel.app (staging frontend) · staging
Supabase project `bkxzgkurcqvccsdjmqzg` (SQL checks in its SQL editor)
**Date prepared:** 2026-08-19 · **Status:** awaiting execution by the operator

> **Rules:** every step states an expected value — a step passes only when the
> actual result matches. Record **VERIFIED PASS / VERIFIED FAIL / PARTIAL /
> BLOCKED** per item. Never downgrade a failure for convenience; never mark
> PASS without evidence (screenshot or SQL output). Fake data only.

---

## 0. Prerequisites (5 min)

1. Staging deploy green on latest main (already verified: run 32302676486 success).
2. Create test users on staging:
   - `journey-owner-a@test.local` → business **Journey Org A** (MWK, FY 07-01, VAT registered = yes)
   - `journey-user-a@test.local` → invite as **user** to Org A
   - `journey-owner-b@test.local` → business **Journey Org B**
3. Open DevTools console; note the **Sentry release** (should contain a recent main SHA — confirms current bundle).

---

## A-09 — Discount 5-layer reconciliation (Journey C+D)

Create customer **Journey Customer A** (VAT-registered, not WHT-exempt); product **Widget** (sale price 15,000, VAT standard); invoice **INV-0001**: 3 × Widget @ 15,000, **discount 10%**, VAT 17.5%.

### Expected values (pre-computed from the app's code — verify each appears)

| Layer | Expected |
|---|---|
| 1. **UI** | line shows "10% discount • −4,500"; summary: Subtotal 40,500 · VAT (17.5%) 7,087.50 · Total **47,587.50** |
| 2. **Database** | `invoice_lines`: discount_percent 10, discount_amount 4,500, tax_amount 7,087.50, line_total 47,587.50 · `invoices`: subtotal 40,500, discount_amount 4,500, discount_percent 10, vat_amount 7,087.50, total_amount 47,587.50, **amount_due 47,587.50** (trigger-maintained) |
| 3. **PDF** | discount appears on the line ("10% discount • −4,500") AND in the totals; total 47,587.50; VAT 7,087.50 |
| 4. **Accounting** | journal (createInvoiceReceivableEntry): DR AR 47,587.50 / CR Revenue(gross) 45,000 / DR 4130 Sales Discounts 4,500 / CR 2121 VAT 7,087.50 — **balanced** (DR 52,087.50 = CR 52,087.50). Trial balance: 4110 CR 45,000, 4130 DR 4,500 |
| 5. **Customer balance** | AR ageing outstanding **47,587.50** |

### SQL verification (staging SQL editor — replace `:inv` with INV-0001's id)

```sql
-- a) invoice header + amount_due (the trigger must have set it)
select invoice_number, subtotal, discount_amount, discount_percent,
       vat_amount, total_amount, amount_due, amount_paid
from public.invoices where invoice_number = 'INV-0001';

-- b) lines
select line_number, quantity, unit_price, discount_percent,
       discount_amount, tax_amount, line_total
from public.invoice_lines where invoice_id = :inv order by line_number;

-- c) journal balances for the invoice
select je.entry_number,
       sum(case when jl.is_debit then jl.amount_base else -jl.amount_base end) as net
from journal_entries je join journal_lines jl on jl.journal_entry_id = je.id
where je.source_type = 'invoice' and je.source_id = :inv
group by je.entry_number;               -- expect net = 0 (balanced)

-- d) trial-balance snapshot (4110 revenue, 4130 discount contra)
select code, total_debits, total_credits from public.v_trial_balance
where business_id = (select id from public.businesses where name = 'Journey Org A')
  and code in ('4110','4130','1131','2121');

-- e) AR ageing outstanding
select invoice_number, amount_due from public.v_ar_ageing
where business_id = (select id from public.businesses where name = 'Journey Org A');
```

### Payment check (also part of Journey C)

Record a **20,000** bank-transfer payment. Expected: amount_paid 20,000;
status partially_paid; outstanding **27,587.50**; journal DR Bank 20,000 /
CR AR 20,000 (balanced); AR ageing row becomes **27,587.50**.

---

## A-10 — PDF download regression (Journey D) — Chrome AND Safari

For each PDF type (invoice INV-0001, credit note, expense, trial balance,
P&L, balance sheet, cash flow, AR ageing, asset register, payslip, tax
return): **(1)** generate → **(2)** download → **(3)** open file → **(4)** not
corrupt → **(5)** correct business → **(6)** correct customer → **(7)** dates
→ **(8)** amounts → **(9)** VAT → **(10)** discounts → **(11)** totals →
**(12)** layout/page count → **(13)** logo where applicable.

**Regression focus (known issue H-08):**
- Clicking download shows progress, then **completes** (no silent hang) in
  **both Chrome and Safari**.
- Downloaded file opens and is non-empty.
- **Induced failure:** go offline (DevTools → Network → Offline) and click
  download → an **actionable error banner** appears (no silent hang).

---

## A-11 — UI tenant manipulation (9.5/9.6) — cross-tenant must be ZERO

With Org A (owner + user) and Org B (owner), attempt **cross-org access**
from the Org A session against Org B's data via:

| # | Vector | Surfaces to test |
|---|---|---|
| 1 | Normal UI | dashboard, customers, suppliers, invoices, expenses, products, inventory, payroll, reports, audit log, exports, API |
| 2 | Manipulated URL | e.g. `/invoices?business_id=<B>`, `/reports?business_id=<B>`, record-detail routes with Org B ids |
| 3 | Direct API (console) | `supabase.from('invoices').select('*').eq('business_id','<B>')` — expect **0 rows or error** |
| 4 | Modified payload | update/insert with Org B's `business_id` — expect denial |
| 5 | Altered record id | read/update/delete a specific Org B record id — expect denial |

**Pass criteria:** every attempt returns empty or denied (rows=0, error, or
"not found"). Record each attempt's result. Any leak = **VERIFIED FAIL**
(severity critical) — stop and report.

---

## A-12 — AI + offline + backup-restore evidence

### AI (Journey K)
1. With Org A's seeded data, ask AI Insights a question (e.g. "total revenue
   this month"). **Expected:** answer references **Org A** context only.
2. **Scoping:** ask about "customers" — must never reference Org B.
3. **Integrity:** note the journal/invoice counts, run a conversation, then
   re-check — **expected: unchanged** (AI is read-only; verified in code —
   `src/lib/aiFinancial.ts` has no insert/update/delete/rpc).
4. Empty business: open AI in Org B (no transactions). **Expected:** sensible
   "no data yet" response, no crash.
5. Induce an AI error (provider down/blocked). **Expected:** graceful error,
   no corruption.

### Offline (Journey M)
1. DevTools → Network → **Offline**; create a **quick expense** (e.g.
   12,000, cash). **Expected:** it queues locally (item appears in the
   offline queue; a local `EXP-` number is generated).
2. Restore network; sync. **Expected:** expense posts once; no duplicate;
   journal balances; inventory/audit trail correct.
3. **Idempotency:** repeat/retry the same queued item (or resubmit with the
   same client_key). **Expected:** no double-posting (client_key unique
   index; verified in `ExpenseRepository.findByClientKey`).
   If offline is not actually implemented for a workflow, record
   **BLOCKED / NOT APPLICABLE** explicitly — do not mark PASS.

### Backup-restore evidence (operator run)
1. Staging Supabase dashboard → **Database → Backups**: confirm backups are
   enabled; record the **last successful backup timestamp** (screenshot).
2. Trigger a **manual backup**; record its status + timestamp.
3. Restore the latest backup **into a throwaway project/branch** (dashboard
   restore, or `supabase db dump` + restore locally via `pg_restore`/psql).
4. In the restored copy, verify integrity markers:
   ```sql
   select count(*) from public.businesses;      -- > 0
   select count(*) from public.journal_entries where status = 'posted';
   -- sample: a known invoice's amount_due equals total_amount - amount_paid
   select invoice_number, total_amount, amount_paid, amount_due
     from public.invoices
    where amount_due is distinct from (total_amount - amount_paid) limit 5;  -- 0 rows
   ```
5. Tear down the throwaway copy. Attach the evidence (timestamps + counts).

---

## Results table (fill and paste back)

| Item | Result | Evidence (screenshot/SQL) | Notes |
|---|---|---|---|
| A-09 UI (discount line + total 47,587.50) | | | |
| A-09 DB (lines + header + amount_due) | | | |
| A-09 PDF (discount + totals) | | | |
| A-09 Accounting (journal balanced; TB 4110/4130) | | | |
| A-09 Customer balance (47,587.50 → 27,587.50) | | | |
| A-10 Chrome downloads (all PDFs) | | | |
| A-10 Safari downloads (all PDFs) | | | |
| A-10 offline failure → error banner | | | |
| A-11 UI/URL/API/payload/id vectors (0 leaks) | | | |
| A-12 AI scoping + read-only + empty + error | | | |
| A-12 offline queue + sync + idempotency | | | |
| A-12 backup + restore + integrity markers | | | |

**Certification rule:** A-09…A-12 all VERIFIED PASS → the Phase 10
certification can be upgraded from 🟡 YELLOW to 🟢 GREEN (with A-06 closed).
Any VERIFIED FAIL → remediation before GREEN.
