/**
 * Golden-file test for the IAS 7 Statement of Cash Flows (indirect method).
 *
 * Runs the full getCashFlow pipeline — P&L, working-capital change, and the
 * bank-line Investing/Financing scan — against the shared mini-ledger
 * fixture (see ./miniLedger.ts) with a filterable Supabase stub that honours
 * the date-window filters, so opening/closing balances and period flows are
 * derived by the code under test, not hard-coded per query.
 *
 * Beyond locking the numbers, this test encodes two reconciliation
 * invariants that have each been the subject of a production fix:
 *
 *   1. A disposal's full proceeds are Investing, so the gain/loss on
 *      disposal must be backed OUT of Operating — otherwise the gain rides
 *      inside Net Profit AND inside Investing proceeds, and the statement
 *      stops tying out (opening + movement ≠ closing by exactly the gain).
 *   2. Cash-to-cash-equivalent transfers (petty cash / mobile money <->
 *      bank) are internal: zero net effect, excluded from every section.
 */
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';
import { FinancialStatementRepository } from '../FinancialStatementRepository';
import { stubSupabaseClient } from '@/test-utils/supabaseStub';
import { BIZ, LEDGER_ACCOUNTS, LEDGER_LINES } from './miniLedger';

function makeRepo(
  accounts = LEDGER_ACCOUNTS,
  lines = LEDGER_LINES,
): FinancialStatementRepository {
  const { client } = stubSupabaseClient({ accounts, journal_lines: lines });
  return new FinancialStatementRepository(client as unknown as SupabaseClient<Database>);
}

describe('getCashFlow — golden mini-ledger (Jan 2026)', () => {
  it('locks every section and reconciles opening + movement = closing', async () => {
    const cf = await makeRepo().getCashFlow(BIZ, '2026-01-01', '2026-01-31', '2025-01-01', '2025-01-31');

    // ── Operating (indirect) ────────────────────────────────────────────
    // P&L for Jan: 500 revenue + 300 disposal gain − 130 opex − 50 depr.
    expect(cf.netProfit).toBe(620);
    expect(cf.depreciationAmortisationAddBack).toBe(50);
    // Working capital: Debtors up 250 (500 invoiced − 250 collected) -> −250.
    // Disposal P&L removal: −300 gain + 50 loss -> −250.
    // Before the disposal fix this field was −250 and operating 420, which
    // left the statement 300 short: opening 1,000 + 4,120 ≠ closing 4,870.
    expect(cf.otherOperatingMovements).toBe(-500);
    expect(cf.netCashFromOperating).toBe(170); // = 250 collected − 80 paid

    // ── Investing ───────────────────────────────────────────────────────
    expect(cf.assetPurchases).toBe(-1_000);
    expect(cf.assetDisposalProceeds).toBe(400); // 300 gain-case + 100 loss-case
    expect(cf.netCashFromInvesting).toBe(-600);

    // ── Financing ───────────────────────────────────────────────────────
    expect(cf.loanDrawdowns).toBe(5_000);
    expect(cf.loanRepayments).toBe(-500);
    expect(cf.shareCapitalContributions).toBe(0); // capital arrived in December
    expect(cf.drawingsAndDividendsPaid).toBe(-200);
    expect(cf.netCashFromFinancing).toBe(4_300);

    // ── Reconciliation ──────────────────────────────────────────────────
    expect(cf.netMovementInCash).toBe(3_870);
    expect(cf.openingCashBalance).toBe(1_000); // December capital
    expect(cf.closingCashBalance).toBe(4_870); // 4,970 bank − 100 Cash on Hand credit
    expect(cf.reconciles).toBe(true);

    // Comparative month is entirely empty -> zeros, not nulls.
    expect(cf.comparativeNetProfit).toBe(0);
    expect(cf.comparativeNetCashFromOperating).toBe(0);
    expect(cf.comparativeNetCashFromInvesting).toBe(0);
    expect(cf.comparativeNetCashFromFinancing).toBe(0);
    expect(cf.comparativeNetMovementInCash).toBe(0);
    expect(cf.comparativeOpeningCashBalance).toBe(0);
    expect(cf.comparativeClosingCashBalance).toBe(0);
  });

  it('treats an internal cash-deposit as zero net movement', async () => {
    // Window containing ONLY entry E7 (Cash on Hand -> Bank).
    const cf = await makeRepo().getCashFlow(BIZ, '2026-01-22', '2026-01-22');
    expect(cf.netMovementInCash).toBe(0);
    expect(cf.netCashFromInvesting).toBe(0);
    expect(cf.netCashFromFinancing).toBe(0);
    expect(cf.comparativeNetCashFromOperating).toBeNull();
    expect(cf.reconciles).toBe(true);
    expect(cf.closingCashBalance).toBe(cf.openingCashBalance);
  });
});

describe('getCashFlow — reversal of a financing entry', () => {
  it('inherits the reversed entry classification through reversal_of', async () => {
    const accounts = LEDGER_ACCOUNTS;
    const lines = [
      { journal_entry_id: 'R1', business_id: BIZ, account_id: 'a-loan', is_debit: true, amount_base: 500, journal_entries: { entry_date: '2026-03-05', status: 'posted', business_id: BIZ, source_type: null, reversal_of: null } },
      { journal_entry_id: 'R1', business_id: BIZ, account_id: 'a-bank', is_debit: false, amount_base: 500, journal_entries: { entry_date: '2026-03-05', status: 'posted', business_id: BIZ, source_type: null, reversal_of: null } },
      // Reversal: puts the cash back into the bank, undoes the repayment.
      { journal_entry_id: 'R2', business_id: BIZ, account_id: 'a-loan', is_debit: false, amount_base: 500, journal_entries: { entry_date: '2026-03-10', status: 'posted', business_id: BIZ, source_type: 'reversal', reversal_of: 'R1' } },
      { journal_entry_id: 'R2', business_id: BIZ, account_id: 'a-bank', is_debit: true, amount_base: 500, journal_entries: { entry_date: '2026-03-10', status: 'posted', business_id: BIZ, source_type: 'reversal', reversal_of: 'R1' } },
    ];
    const journalEntries = [{ id: 'R1', source_type: null }];
    const { client } = stubSupabaseClient({ accounts, journal_lines: lines, journal_entries: journalEntries });
    const repo = new FinancialStatementRepository(client as unknown as SupabaseClient<Database>);

    const cf = await repo.getCashFlow(BIZ, '2026-03-01', '2026-03-31');
    // The original is a repayment; its reversal inherits the loan-account
    // classification (original source_type null -> counterpart 2510) and
    // nets the financing section back to zero.
    expect(cf.loanRepayments).toBe(-500);
    expect(cf.loanDrawdowns).toBe(500);
    expect(cf.netCashFromFinancing).toBe(0);
    expect(cf.netMovementInCash).toBe(0);
    expect(cf.reconciles).toBe(true);
  });
});
