/**
 * Shared mini-ledger fixture for the financial-statement golden tests.
 *
 * One self-consistent little set of books (single business `biz-1`, MWK) so
 * every statement golden test asserts against the SAME reality:
 *
 *   2025-12-15  E0   Capital introduced: Dr Bank 1,000 / Cr Share Capital 1,000
 *   2026-01-05  E1   Invoice issued on credit: Dr Debtors 500 / Cr Sales 500
 *   2026-01-10  E2   Bought building for cash: Dr Buildings 1,000 / Cr Bank 1,000
 *   2026-01-12  E3   Loan drawdown: Dr Bank 5,000 / Cr Bank Loan 5,000
 *   2026-01-15  E4   Loan repayment: Dr Bank Loan 500 / Cr Bank 500
 *   2026-01-18  E5   Owner drawings: Dr Drawings 200 / Cr Bank 200
 *   2026-01-20  E6   Half the invoice collected: Dr Bank 250 / Cr Debtors 250
 *   2026-01-22  E7   Cash deposited into bank: Dr Bank 100 / Cr Cash on Hand 100
 *   2026-01-25  E8   Paid operating expense: Dr Opex 80 / Cr Bank 80
 *   2026-01-28  E9   Depreciation: Dr Depr. Expense 50 / Cr Accum. Depr. 50
 *   2026-01-30  E10  Asset sold at a gain (NBV nil): Dr Bank 300 / Cr Gain 300
 *   2026-01-31  E11  Asset sold at a loss: Dr Bank 100, Dr Loss 50 / Cr Buildings 150
 *   2026-02-05  E12  Manual closing entry: Dr Current Year P&L 200 / Cr Drawings 200
 *
 * Derived truths the golden tests lock in:
 *   - Jan P&L: revenue 500, other income 300, opex 130, D&A 50 -> net 620
 *   - Jan cash: opening 1,000; operating 170; investing -600; financing 4,300;
 *     closing 4,870 (4,970 bank less the 100 credit balance building up on
 *     Cash on Hand from the internal deposit E7)
 *   - Equity: no close routine exists, so drawings sit on 3140 until E12
 *     moves them into current-year results in February
 */

export const BIZ = 'biz-1';

function account(
  id: string,
  code: string,
  name: string,
  accountType: string,
  accountSubtype: string | null,
  normalBalance: 'debit' | 'credit',
  isBankAccount = false,
): Record<string, unknown> {
  return {
    id,
    business_id: BIZ,
    code,
    name,
    account_type: accountType,
    account_subtype: accountSubtype,
    normal_balance: normalBalance,
    is_group: false,
    is_system: true,
    is_bank_account: isBankAccount,
    opening_balance: 0,
    deleted_at: null,
  };
}

export const LEDGER_ACCOUNTS: Array<Record<string, unknown>> = [
  account('a-cash', '1110', 'Cash on Hand', 'asset', 'current_asset', 'debit'),
  account('a-bank', '1121', 'NBM Bank — Current Account', 'asset', 'current_asset', 'debit', true),
  account('a-debtors', '1131', 'Trade Debtors', 'asset', 'current_asset', 'debit'),
  account('a-buildings', '1512', 'Buildings', 'asset', 'fixed_asset', 'debit'),
  account('a-accdep', '1521', 'Accum. Depr. — Buildings', 'asset', 'fixed_asset', 'credit'),
  account('a-loan', '2510', 'Bank Loan', 'liability', 'non_current_liability', 'credit'),
  account('a-sharecap', '3110', 'Share Capital', 'equity', 'share_capital', 'credit'),
  account('a-retained', '3130', 'Current Year Profit / Loss', 'equity', 'retained_earnings', 'credit'),
  account('a-drawings', '3140', 'Drawings / Dividends Paid', 'equity', 'retained_earnings', 'debit'),
  account('a-sales', '4111', 'Sales of Goods', 'income', 'revenue', 'credit'),
  account('a-gain', '4910', 'Gain on Disposal of Fixed Assets', 'income', 'other_income', 'credit'),
  account('a-opex', '6110', 'Sundry Expenses', 'expense', 'operating_expense', 'debit'),
  account('a-depr', '6200', 'Depreciation Expense', 'expense', 'depreciation_amortisation', 'debit'),
  account('a-loss', '6910', 'Loss on Disposal of Fixed Assets', 'expense', 'operating_expense', 'debit'),
];

function line(
  entryId: string,
  entryDate: string,
  sourceType: string | null,
  accountId: string,
  isDebit: boolean,
  amountBase: number,
): Record<string, unknown> {
  return {
    journal_entry_id: entryId,
    business_id: BIZ,
    account_id: accountId,
    is_debit: isDebit,
    amount_base: amountBase,
    journal_entries: {
      entry_date: entryDate,
      status: 'posted',
      business_id: BIZ,
      source_type: sourceType,
      reversal_of: null,
    },
  };
}

export const LEDGER_LINES: Array<Record<string, unknown>> = [
  // E0 — capital introduced (pre-period)
  line('E0', '2025-12-15', null, 'a-bank', true, 1_000),
  line('E0', '2025-12-15', null, 'a-sharecap', false, 1_000),
  // E1 — credit sale
  line('E1', '2026-01-05', 'invoice', 'a-debtors', true, 500),
  line('E1', '2026-01-05', 'invoice', 'a-sales', false, 500),
  // E2 — fixed asset purchased for cash (manual entry)
  line('E2', '2026-01-10', null, 'a-buildings', true, 1_000),
  line('E2', '2026-01-10', null, 'a-bank', false, 1_000),
  // E3 — loan drawdown (manual entry)
  line('E3', '2026-01-12', null, 'a-bank', true, 5_000),
  line('E3', '2026-01-12', null, 'a-loan', false, 5_000),
  // E4 — loan repayment (manual entry)
  line('E4', '2026-01-15', null, 'a-loan', true, 500),
  line('E4', '2026-01-15', null, 'a-bank', false, 500),
  // E5 — owner drawings
  line('E5', '2026-01-18', null, 'a-drawings', true, 200),
  line('E5', '2026-01-18', null, 'a-bank', false, 200),
  // E6 — invoice half collected
  line('E6', '2026-01-20', 'invoice', 'a-bank', true, 250),
  line('E6', '2026-01-20', 'invoice', 'a-debtors', false, 250),
  // E7 — internal transfer: cash on hand deposited into the bank
  line('E7', '2026-01-22', null, 'a-bank', true, 100),
  line('E7', '2026-01-22', null, 'a-cash', false, 100),
  // E8 — operating expense paid
  line('E8', '2026-01-25', 'expense', 'a-opex', true, 80),
  line('E8', '2026-01-25', 'expense', 'a-bank', false, 80),
  // E9 — depreciation (non-cash)
  line('E9', '2026-01-28', 'fixed_asset_depreciation', 'a-depr', true, 50),
  line('E9', '2026-01-28', 'fixed_asset_depreciation', 'a-accdep', false, 50),
  // E10 — disposal at a gain (asset fully depreciated in the fixture)
  line('E10', '2026-01-30', 'fixed_asset_disposal', 'a-bank', true, 300),
  line('E10', '2026-01-30', 'fixed_asset_disposal', 'a-gain', false, 300),
  // E11 — disposal at a loss
  line('E11', '2026-01-31', 'fixed_asset_disposal', 'a-bank', true, 100),
  line('E11', '2026-01-31', 'fixed_asset_disposal', 'a-loss', true, 50),
  line('E11', '2026-01-31', 'fixed_asset_disposal', 'a-buildings', false, 150),
  // E12 — manual closing entry sweeping January's drawings into current-year
  // results (February, so it only affects the equity roll-forward for Feb).
  line('E12', '2026-02-05', null, 'a-retained', true, 200),
  line('E12', '2026-02-05', null, 'a-drawings', false, 200),
];
