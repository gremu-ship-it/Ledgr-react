# H04: period lock and invoice approval (2026-09-26)

Status: implemented on branch `arena/01a0d9f5-ledgr-react` (PR #185, draft). **Not deployed.** Production is still f671656.
Scope: the owner asked to implement the H04 controls "as recommended" (a period lock plus second-person invoice approval) and authorised the historical repair.

## 1. What changed

### A. Period lock (migration `20261014000000_period_lock_and_invoice_approval.sql`)
- It reuses the **existing** `accounting_periods` table (`is_closed`), which Settings → Period management already toggles. Before this change **nothing in the migration chain enforced it**. The triggers named in `PeriodRepository` comments, including `fn_check_no_drafts_before_closing`, are not in this repo. Whether they exist in production is **not assumed**.
- **Close:** the `close_accounting_period(period_id, reason)` command. Allowed roles: owner, admin or accountant. The period must have ended, and it must have no draft journal entries.
- **Reopen:** the `reopen_accounting_period(period_id, reason)` command. Owner only; the reason must be at least 10 characters.
- Both commands are logged in `accounting_period_events`.
- A direct update of `is_closed` is refused (42501). A closed period's dates cannot be changed and it cannot be deleted (22023).
- **Locked data:** nothing dated inside a closed period can be inserted, changed or deleted in these 8 tables, by any writer, including the service role:
  - journal entries and journal lines;
  - invoices and invoice lines;
  - invoice payments;
  - expenses and expense payments;
  - stock movements.

  Errors start with `period-closed:`.
- **Allowed exceptions:**
  - settlement fields on an old invoice (`amount_paid`, and status among sent/partially_paid/paid/overdue), so a payment received today still posts;
  - marking a closed-period journal as reversed, when the reversal is dated in an open period.

  Corrections go into the open period (IAS 8).
- **Periods that are already closed become enforced from this migration on.** Check them before deploying (§4).

### B. Invoice approval (segregation of duties)
- An invoice leaving `draft`, or inserted as non-draft, needs approval from a **different person** (owner, admin or accountant) when either:
  - its creator's role is in the policy list (default: sales_clerk, data_entry, cashier); or
  - its total is at or above the business threshold (default: no threshold). This does not apply when the creator is the owner.
- Till sales (`post_pos_sale`) are exempt. They are governed by the existing till controls.
- Approvals are append-only rows in `invoice_approvals`, written only by `approve_invoice`. No approval columns were added to documents, which keeps the R07 rule.
- Editing a material field of an approved draft revokes the approval: amounts, customer, date, currency or any line.
- `invoices.submitted_by` is set by the server and cannot be changed.
- The policy is changed with `set_invoice_approval_policy` (owner or admin). There is no settings UI for it yet.

### C. Repair date safety (`20261013000001_ledgr_repair_2026_09.sql`)
- The D2 COGS journal is dated on the invoice's issue date if that period is open. Otherwise it is dated today (IAS 8), so the repair never writes into a closed period.

### D. Client
- `PeriodRepository.lock/unlock` now call the commands. Unlock asks for a reason.
- `PeriodManagementPage`:
  - owner, admin and accountant can close a period;
  - only the owner can reopen one;
  - FX revaluation is limited to owner and admin.
- The demo client supports both commands.
- New `InvoiceApprovalPanel` in the invoice detail view. On drafts it shows whether an approval is on record, and an **Approve** button for eligible approvers. It is never shown to the invoice's creator.
- **Pre-existing gap (not changed):**
  - IncomePage always creates invoices as `draft`;
  - the UI has no action that issues a draft (draft→sent);
  - so the "journal on issue" branch never runs from the UI.

  The approval check runs on the server whenever an invoice is issued, from any path. Designing an "Issue invoice" flow is a separate product decision.

## 2. Tests
- New release suite `tests/release/pl-period-approval.test.ts` (10 records):
  - PL.PERIOD: CLOSE-AUTHORITY, CLOSED-WRITES-REFUSED, SETTLEMENT-ALLOWED, REOPEN-OWNER-ONLY, NO-DIRECT-WRITES, REVERSAL-MARK-ALLOWED;
  - PL.APPROVAL: ROLE-REQUIRES-SECOND-PERSON, THRESHOLD-AND-SELF-APPROVAL, EDIT-REVOKES-AND-NO-FORGERY, POS-EXEMPT-AND-DEFAULTS.
- `ic-containment` **H04.INVOICE.PERIOD-AND-APPROVAL-POLICY** was BLOCKED and now **passes**.
- R07 COMMAND-SURFACE was superseded in place to add `approve_invoice`. Its rule, "no approval columns on documents", is unchanged.
- Typecheck and lint: clean. Unit tests: 920/920. Gate results are in §3.
- All fixtures are synthetic. No production data was used.

## 3. Release gate
Two runs, identical record-by-record: **820 PASS / 0 FAIL / 54 BLOCKED** each (all 54 environment-bound, same as before). Versus f5a4843 (809/0/55): +10 new PL records; H04.INVOICE.PERIOD-AND-APPROVAL-POLICY BLOCKED → PASS. Build OK.
- added: the new PL records;
- changed: H04 moves from BLOCKED to PASS.

## 4. Historical repair: what the owner must do (I have no production access)
I did **not** run anything in production, and none of this is claimed to have happened. Order:
1. **Evidence snapshot first**, per `docs/runbooks/IC_2026-09-25_P0_EVIDENCE_PRESERVATION.md`. That runbook is still pending.
2. **Before merging**, run these read-only checks:
   - `select id, name, start_date, end_date from accounting_periods where is_closed;` These periods become locked on deploy. Reopen any that were closed by mistake before deploying, or after deploying through the owner-only reopen command.
   - `select b.name from branches b where not exists (select 1 from inventory_locations l where l.branch_id=b.id);`
3. Merge and deploy (the owner's decision).
4. Run the **size** workflow (`repair-2026-09-inventory.yml`), then paste back the `plan_hash` and summary for review.
5. Run **apply** with the evidence reference and that `plan_hash`. Then run size again; the remaining plan hash should be `d41d8cd98f00b204e9800998ecf8427e`.
