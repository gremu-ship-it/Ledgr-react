/**
 * Golden-file test for the Statement of Changes in Equity.
 *
 * Locks the roll-forward arithmetic against the shared mini-ledger
 * (./miniLedger.ts) in both bookkeeping worlds this app actually produces,
 * since no period-close routine posts closing journals automatically:
 *
 *   1. Unclosed books (January): P&L accounts hold the period result and
 *      Drawings (3140) holds the period's distributions. Retained Earnings
 *      must still present the ECONOMIC position — ledger RE net of the
 *      cumulative drawings balance — otherwise closing equity is overstated
 *      by exactly the drawings and the SOFP tie-out trips the amber warning.
 *      (Before the fix, every owner drawing produced a permanent,
 *      spurious equityReconciliationWarning and the XBRL export overstated
 *      RetainedEarnings by the drawings amount.)
 *   2. Manually closed books (February, after entry E12): the closing entry
 *      Dr 3130 / Cr 3140 reduces RE accounts and zeroes 3140 — the
 *      roll-forward must still foot and tie out.
 */
import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';
import { FinancialStatementRepository } from '../FinancialStatementRepository';
import { stubSupabaseClient } from '@/test-utils/supabaseStub';
import { BIZ, LEDGER_ACCOUNTS, LEDGER_LINES } from './miniLedger';

function makeRepo(): FinancialStatementRepository {
  const { client } = stubSupabaseClient({ accounts: LEDGER_ACCOUNTS, journal_lines: LEDGER_LINES });
  return new FinancialStatementRepository(client as unknown as SupabaseClient<Database>);
}

describe('getChangesInEquity — golden mini-ledger', () => {
  it('January: unclosed books still tie out, drawings reduce Retained Earnings', async () => {
    const soce = await makeRepo().getChangesInEquity(BIZ, '2026-01-01', '2026-01-31');

    expect(soce.shareCapital).toEqual({
      label: 'Share Capital',
      openingBalance: 1_000,
      netProfitAllocation: 0,
      contributions: 0,
      drawingsOrDividends: 0,
      otherMovements: 0,
      closingBalance: 1_000,
    });

    expect(soce.retainedEarnings).toEqual({
      label: 'Retained Earnings',
      openingBalance: 0,
      netProfitAllocation: 620, // January net profit
      contributions: 0,
      drawingsOrDividends: 200, // E5, presented positive = distribution
      otherMovements: 0,
      closingBalance: 420, // 0 + 620 − 200
    });

    expect(soce.reserves).toEqual({
      label: 'Reserves',
      openingBalance: 0,
      netProfitAllocation: 0,
      contributions: 0,
      drawingsOrDividends: 0,
      otherMovements: 0,
      closingBalance: 0,
    });

    expect(soce.totalOpeningEquity).toBe(1_000);
    expect(soce.totalClosingEquity).toBe(1_420);
    // SOFP at 31 Jan shows equity of 800 (1,000 share capital − 200 drawings
    // still parked on 3140); the remaining 620 is January's unclosed profit.
    // Before the fix closing equity reported 1,620 and this check failed by
    // exactly the 200 drawings.
    expect(soce.reconciles).toBe(true);

    // The roll-forward row foots: opening + profit − drawings + other = closing.
    const re = soce.retainedEarnings;
    expect(
      re.openingBalance + re.netProfitAllocation + re.contributions
        - re.drawingsOrDividends + re.otherMovements,
    ).toBe(re.closingBalance);
  });

  it('February: a manual closing entry keeps the roll-forward consistent', async () => {
    const soce = await makeRepo().getChangesInEquity(BIZ, '2026-02-01', '2026-02-28');

    // E12 (Dr 3130 / Cr 3140, 200) moved January's drawings out of 3140 and
    // into Current Year Profit / Loss: ledger RE drops by 200 while 3140
    // returns to zero. February itself has no trading, so equity is flat.
    expect(soce.retainedEarnings.openingBalance).toBe(-200); // 0 less January drawings
    expect(soce.retainedEarnings.netProfitAllocation).toBe(0);
    expect(soce.retainedEarnings.drawingsOrDividends).toBe(-200); // 3140 swept to zero
    expect(soce.retainedEarnings.otherMovements).toBe(-200); // the Dr 3130 closing posting
    expect(soce.retainedEarnings.closingBalance).toBe(-200);
    expect(soce.totalOpeningEquity).toBe(800);
    expect(soce.totalClosingEquity).toBe(800);
    expect(soce.reconciles).toBe(true);

    const re = soce.retainedEarnings;
    expect(
      re.openingBalance + re.netProfitAllocation + re.contributions
        - re.drawingsOrDividends + re.otherMovements,
    ).toBe(re.closingBalance);
  });
});
