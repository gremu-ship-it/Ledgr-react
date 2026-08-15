# Phase 9.4 — Hosted-Staging Browser Test Script (Journeys A–M)

**How to use:** execute against **https://ledgr-react.vercel.app** (staging
frontend) backed by **ledgr-staging** (Supabase project
`bkxzgkurcqvccsdjmqzg`). Record **PASS / FAIL / PARTIAL / BLOCKED** and any
defect (with severity per 9.12) in the results table at the end. Use fake
data only. Expected results are stated per step — a step only passes when the
actual result matches the expected result.

> **Baseline before starting:** staging deploy must be green (all 61
> migrations including Phase 8B), and the Phase 8B reference-data migration
> is pending approval — **Journey H (payroll) is BLOCKED until PAYE bands are
> approved** (9.2).

---

## JOURNEY A — NEW BUSINESS

1. Open the app. **Expected:** login screen renders, no console errors.
2. Register a new user (e.g. `phase9-a-owner@test.local`, fake details).
   **Expected:** verification email flow works (or auto-confirm if
   configured); after verification the user can sign in.
3. Create business "Phase9 Org A" (MWK, FY start 07-01, timezone
   Africa/Blantyre, VAT registered = yes). **Expected:** no error.
4. Confirm owner role. **Expected:** dashboard loads; role shown = owner.
5. Create a branch ("HQ"). **Expected:** saved, appears in lists.
6. Configure business (logo later in Journey J; numbering prefixes).
   **Expected:** settings save.
7. Confirm default accounts. **Expected:** Accounts page lists the 166-account
   GAAP chart of accounts (search for 1110 Cash on Hand, 4112 Service
   Revenue, 2121 VAT Payable, 2132 Pension Payable).
8. Confirm dashboard loads with no blank sections. **Expected:** dashboard
   cards render (may be zero values — not blank/error).

**Pass criteria:** 1–8 all expected.

## JOURNEY B — TEAM

1. In Settings → Team, invite `phase9-b-acct@test.local` as **accountant**.
   **Expected:** invite link/token created.
2. Register/accept as that user (open invite link). **Expected:** acceptance
   succeeds; user is a member with role accountant.
3. Invite and accept: **admin** (a-manager), **viewer** (standard user).
4. Login as each role and verify permitted access vs restricted access:

| Role | Expected permitted | Expected restricted |
|---|---|---|
| owner | everything | — |
| admin | everything except billing owner-only actions | owner-only billing |
| accountant | read/write transactions, reports, payroll view/write | team management, hard delete |
| viewer | read lists/dashboards | write everywhere, payroll, settings |

**Pass criteria:** each role sees exactly its expected surface; the app's
role gating (`usePermissions`) and the DB RLS (8B.3) agree.

## JOURNEY C — SALES (incl. DISCOUNT REGRESSION)

1. Create customer "Phase9 Customer A" (VAT-registered, wht_exempt=false).
2. Create product "Widget" (price 15,000, VAT standard).
3. Create invoice INV-0001: 3 × Widget @ 15,000, **discount 10%**,
   VAT 17.5%.
   **Expected values (per the app's calc — verify they match):**
   - gross 45,000; discount 4,500; subtotal 40,500
   - VAT 7,087.50 (40,500 × 17.5%); total 47,587.50
4. **DISCOUNT REGRESSION (KNOWN ISSUE #1)** — verify all four layers agree:
   - **UI:** discount shown on the invoice line AND on the invoice total.
   - **Database:** `invoice_lines.discount_amount`/`discount_percent` and
     `invoices.discount_amount`/`discount_percent` match the UI.
   - **PDF:** discount appears on the generated PDF (Journey D).
   - **Accounting:** revenue posted = net-of-discount amount; journal
     entries balance; `v_trial_balance` reflects the net revenue.
   - **Customer balance:** AR ageing outstanding = total − payments.
   **Pass criteria:** all five layers agree. A test that merely "saves"
   without verifying all layers does NOT pass.
5. Record a payment of 20,000 (bank transfer). **Expected:** amount_paid
   20,000; status partially_paid; outstanding 27,587.50; journal entries
   balance (DR cash 20,000 / CR AR 20,000).
6. Verify customer balance card reflects outstanding.

## JOURNEY D — PDF (incl. DOWNLOAD REGRESSION)

Generate, download and open **every** PDF exposed by the app:
invoice, credit note, expense, trial balance, P&L, balance sheet, cash flow,
AR ageing, asset register, payroll payslip (if exposed), tax return.

For each: (1) generate → (2) download → (3) open the file → (4) not corrupt →
(5) correct business → (6) correct customer → (7) dates → (8) amounts →
(9) VAT → (10) discounts → (11) totals → (12) layout/page count →
(13) logo where applicable.

**PDF DOWNLOAD REGRESSION (KNOWN ISSUE #2 / H-08):** the previously reported
"PDF download awaited / silent failure" — verify in **Chrome and Safari**:
- clicking download shows progress, then completes;
- the downloaded file opens and is non-empty;
- on a deliberately induced failure (e.g. offline), an **actionable error
  banner** appears (no silent hang).

**Pass criteria:** every PDF passes 1–13; both browsers download
successfully.

## JOURNEY E — PURCHASES & INVENTORY

1. Create supplier "Phase9 Supplier A".
2. Create purchase/stock receipt: 10 Widgets @ 10,000.
   **Expected:** quantity_on_hand 10; journal DR Trading Stock 100,000 /
   CR GRNI 100,000 (balanced).
3. Record sale (Journey C flow) reducing stock by 3.
   **Expected:** quantity_on_hand 7; COGS journal 3 × cost (balanced).
4. **Quantity identity check:** quantity before + purchase − sale =
   quantity after (record the numbers).
5. Set reorder_level = 8 and verify the reorder alert appears when
   available ≤ 8. **Expected:** alert row in Warehouse/Inventory page.

**Pass criteria:** identity holds; journals balance; alert appears.

## JOURNEY F — EXPENSES

1. Create expense (general, supplier A, 50,000 + VAT 17.5% → total 58,750),
   payment method bank transfer.
2. **Expected:** journal DR expense account 50,000 / DR VAT receivable
   8,750 / CR cash 58,750 — **balanced**; expense report shows the amounts;
   PDF matches.

## JOURNEY G — BANK RECONCILIATION

1. Upload/import a bank statement (or create statement lines manually).
2. Match a statement line to the payment journal line; reconcile.
   **Expected:** line marked reconciled; statement reconciles to the closing
   balance.
3. Lock the statement (if supported). **Expected:** reconciled lines cannot
   be edited or deleted (`bank_line_locked_guard` trigger); totals remain
   correct.
4. **Tenant check:** a user from another org cannot see or touch this
   statement (should see zero rows).

## JOURNEY H — PAYROLL ⛔ BLOCKED until PAYE reference data is approved

1. Create 2 fake employees (e.g. gross 500,000 and 2,000,000).
2. Run payroll for the period. **Expected PAYE** (approved bands, §9.2):
   - 500,000 → 99,000
   - 2,000,000 → 570,500
   (verify against the approved reference data and the app's computed
   figures, including pension 5%/10% treatment).
3. Verify journal entries balance; payroll reports match.

**Do not certify payroll tax correctness before the reference data is
approved and these cases pass.**

## JOURNEY I — FINANCIAL REPORTING

1. Open Trial Balance. **Expected: TOTAL DEBITS = TOTAL CREDITS** (record
   the numbers).
2. Open P&L, Balance Sheet, Cash Flow, AR ageing, asset register, reorder
   report. For each: the same transaction must produce **consistent** figures
   across the source journal, the report, and the PDF (no contradictions).

## JOURNEY J — STORAGE

1. Upload a business logo (Settings). **Expected:** upload succeeds; public
   URL renders in the app and on generated PDFs.
2. Replace the logo (upsert). **Expected:** new logo used everywhere.
3. Delete the logo where supported. **Expected:** removed.
4. Export user/business data (if exposed). **Expected:** signed download
   works once.
5. **Security:** User A (org A) must NOT be able to obtain User B's export
   or manipulate Org B's logo path. Test:
   - direct URL of B's export → denied/404;
   - direct storage path guess `storage/v1/object/public/business-logos/<B-id>/logo-...` →
     upload attempt must be denied (RLS 8B.4).
6. **Anonymous** access: public logo URL loads; user-exports URL does not.

## JOURNEY K — AI INSIGHTS

1. Open AI Insights with the seeded org data. **Expected:** answers reference
   the correct business context (revenue 3M, cash, outstanding, anomalies).
2. **Scoping:** answers must never reference another org's data.
3. **Integrity:** AI cannot modify accounting records (no write path);
   verify a conversation leaves journal/invoice data unchanged.
4. Empty-data business: create a second org with no transactions → open AI
   Insights. **Expected:** sensible "no data yet" response, no crash.
5. Induce an AI error (e.g. provider failure). **Expected:** graceful error
   handling; no corruption.

## JOURNEY L — API & WEBHOOKS

1. Create an API key (if exposed) and call the public API with a signed
   request (JWT from anon key + api key header). **Expected:** rate limit
   applies; a valid journal entry can be created; unbalanced payloads are
   rejected (`create_api_journal_entry`).
2. Create a webhook; trigger a delivery; verify signature verification;
   verify duplicate delivery protection; invalid signature rejected.
3. **Tenant scoping:** a request for org B's data with org A's key fails.
4. **No production endpoints:** verify all configured webhook/cron URLs point
   at staging (search the DB `cron.job` + edge function env).

## JOURNEY M — OFFLINE

Ledgr has an offline layer (`src/offline/*`, Dexie). Test if the workflow is
actually implemented for a transaction type:
1. Disable network; create a supported transaction (e.g. quick expense);
   queue it. **Expected:** item queues locally.
2. Restore network; sync. **Expected:** no duplicate; accounting entries
   correct; inventory correct; audit trail present.
3. Interrupted sync / retry / duplicate submission. **Expected:** idempotent
   (no double-posting).
**If offline is NOT implemented for a workflow, record BLOCKED/NOT
APPLICABLE explicitly — do not mark PASS.**

---

## 9.5 / 9.6 — UI-level tenant isolation & negative tests

**Tenant matrix (UI + manipulated requests):** create ORG-A (owner, manager,
user) and ORG-B (owner, user). For dashboard, customers, suppliers,
invoices, expenses, products, inventory, payroll, reports, audit logs,
exports, API: attempt cross-org access via (1) normal UI, (2) manipulated
URL (e.g. `/invoices?business_id=<B>`), (3) direct API request with altered
business_id, (4) modified payload, (5) altered record id.
**Expected: CROSS-TENANT ACCESS = ZERO** — every attempt returns empty or
denied.

**Negative tests** (record expected vs actual, PASS/FAIL, severity):
invalid invoice (zero qty, negative price), invalid payment, overpayment,
duplicate transaction, duplicate webhook, expired invitation, unauthorized
role change, unauthorized payroll access, unauthorized audit modification,
invalid storage path, malformed API request, invalid webhook signature,
stale session, deleted/disabled user, wrong business_id.

---

## Results recording table

| Journey | Step | Expected | Actual | Result | Defect (id/severity) |
|---|---|---|---|---|---|
| A | 1–8 | … | | | |

Defect IDs: P9-001 … (see Phase 9.12 severity classification).
