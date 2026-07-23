/**
 * CapitalJournalService — posts double-entry journals for loans and share
 * capital so the general ledger / financial statements stay in sync.
 *
 * Mirrors FixedAssetsJournalService: build balanced lines, call
 * repos.journal.createBalancedEntry(), then repos.journal.post().
 *
 * source_type values: 'loan_drawdown' | 'loan_repayment' |
 * 'share_issue' | 'share_buyback'.
 */

import { repos } from '@/lib/repositories';
import { nextEntryNumber } from '@/services/FixedAssetsJournalService';
import type { Row, ShareTransactionType } from '@/dal/types/database';

type JournalLine = Parameters<typeof repos.journal.createBalancedEntry>[1][number];

function line(
  lineNumber: number,
  accountId: string,
  description: string,
  isDebit: boolean,
  amount: number,
): JournalLine {
  return {
    line_number: lineNumber,
    account_id: accountId,
    description,
    is_debit: isDebit,
    amount,
    amount_base: amount,
    currency: 'MWK',
    exchange_rate: 1,
    tax_code: 'none',
    tax_amount: 0,
    reconciled: false,
  };
}

// ── Loans ───────────────────────────────────────────────────────────────────

export interface CreateLoanInput {
  businessId: string;
  createdBy: string;
  lenderName: string;
  description?: string;
  principalAmount: number;
  interestRatePct?: number | null;
  termMonths?: number | null;
  startDate: string;
  firstPaymentDate?: string | null;
  loanAccountId: string;
  bankAccountId: string;
  interestExpenseAccountId?: string | null;
}

export async function createLoan(input: CreateLoanInput): Promise<Row<'loans'>> {
  const loan = await repos.loan.create({
    business_id: input.businessId,
    lender_name: input.lenderName,
    description: input.description ?? null,
    loan_account_id: input.loanAccountId,
    interest_expense_account_id: input.interestExpenseAccountId ?? null,
    principal_amount: input.principalAmount,
    interest_rate_pct: input.interestRatePct ?? null,
    term_months: input.termMonths ?? null,
    start_date: input.startDate,
    first_payment_date: input.firstPaymentDate ?? null,
    status: 'active',
    created_by: input.createdBy,
  });

  const description = `Loan drawdown — ${input.lenderName}`;
  const entryNumber = await nextEntryNumber();
  const { entry } = await repos.journal.createBalancedEntry(
    {
      business_id: input.businessId,
      entry_number: entryNumber,
      entry_date: input.startDate,
      description,
      source_type: 'loan_drawdown',
      source_id: loan.id,
      currency: 'MWK',
      exchange_rate: 1,
      status: 'draft',
      created_by: input.createdBy,
    },
    [
      line(1, input.bankAccountId, description, true, input.principalAmount), // Dr Bank
      line(2, input.loanAccountId, description, false, input.principalAmount), // Cr Loan Payable
    ],
  );
  await repos.journal.post(entry.id, input.createdBy);

  return repos.loan.update(loan.id, { drawdown_journal_id: entry.id });
}

export interface RecordRepaymentInput {
  businessId: string;
  createdBy: string;
  loanId: string;
  repaymentDate: string;
  amount: number;
  principalPortion: number;
  interestPortion: number;
  bankAccountId: string | null;
  reference?: string;
  notes?: string;
}

export async function recordLoanRepayment(
  input: RecordRepaymentInput,
): Promise<Row<'loan_repayments'>> {
  const loan = await repos.loan.findById(input.loanId);
  if (!loan) throw new Error('Loan not found.');

  if (Math.abs(input.principalPortion + input.interestPortion - input.amount) > 0.005) {
    throw new Error('Principal portion + interest portion must equal the total repayment amount.');
  }
  if (!input.bankAccountId) throw new Error('A bank/cash account is required for the repayment.');

  const description = `Loan repayment — ${loan.lender_name}`;
  const lines: JournalLine[] = [
    line(1, loan.loan_account_id, description, true, input.principalPortion), // Dr Loan Payable
  ];
  let n = 2;
  if (input.interestPortion > 0 && loan.interest_expense_account_id) {
    lines.push(line(n++, loan.interest_expense_account_id, `Loan interest — ${loan.lender_name}`, true, input.interestPortion)); // Dr Interest Expense
  }
  lines.push(line(n, input.bankAccountId, description, false, input.amount)); // Cr Bank

  const entryNumber = await nextEntryNumber();
  const { entry } = await repos.journal.createBalancedEntry(
    {
      business_id: input.businessId,
      entry_number: entryNumber,
      entry_date: input.repaymentDate,
      description,
      source_type: 'loan_repayment',
      source_id: loan.id,
      currency: 'MWK',
      exchange_rate: 1,
      status: 'draft',
      created_by: input.createdBy,
    },
    lines,
  );
  await repos.journal.post(entry.id, input.createdBy);

  const repayment = await repos.loanRepayment.create({
    business_id: input.businessId,
    loan_id: loan.id,
    repayment_date: input.repaymentDate,
    amount: input.amount,
    principal_portion: input.principalPortion,
    interest_portion: input.interestPortion,
    bank_account_id: input.bankAccountId,
    journal_entry_id: entry.id,
    reference: input.reference ?? null,
    notes: input.notes ?? null,
    created_by: input.createdBy,
  });

  // Mark the loan paid off once principal is fully repaid.
  const repayments = await repos.loanRepayment.findByLoan(input.businessId, loan.id);
  const repaidPrincipal = repayments.reduce((sum, r) => sum + Number(r.principal_portion), 0);
  if (repaidPrincipal >= Number(loan.principal_amount) - 0.005) {
    await repos.loan.update(loan.id, { status: 'paid_off' });
  }

  return repayment;
}

// ── Share capital ─────────────────────────────────────────────────────────────

export interface RecordShareInput {
  businessId: string;
  createdBy: string;
  shareholderName: string;
  transactionType: ShareTransactionType;
  sharesCount?: number | null;
  amount: number;
  shareAccountId: string;
  bankAccountId: string | null;
  reference?: string;
  notes?: string;
}

export async function recordShareTransaction(
  input: RecordShareInput,
): Promise<Row<'share_transactions'>> {
  if (!input.bankAccountId) throw new Error('A bank/cash account is required.');
  if (input.amount <= 0) throw new Error('Enter a valid amount.');

  const isIssue = input.transactionType === 'issue';
  const description = `Share capital ${isIssue ? 'issued' : 'bought back'} — ${input.shareholderName}`;

  // Issue:  Dr Bank  /  Cr Share Capital
  // Buyback: Dr Share Capital  /  Cr Bank
  const lines: JournalLine[] = isIssue
    ? [
        line(1, input.bankAccountId, description, true, input.amount),
        line(2, input.shareAccountId, description, false, input.amount),
      ]
    : [
        line(1, input.shareAccountId, description, true, input.amount),
        line(2, input.bankAccountId, description, false, input.amount),
      ];

  const entryNumber = await nextEntryNumber();
  const { entry } = await repos.journal.createBalancedEntry(
    {
      business_id: input.businessId,
      entry_number: entryNumber,
      entry_date: new Date().toISOString().slice(0, 10),
      description,
      source_type: isIssue ? 'share_issue' : 'share_buyback',
      currency: 'MWK',
      exchange_rate: 1,
      status: 'draft',
      created_by: input.createdBy,
    },
    lines,
  );
  await repos.journal.post(entry.id, input.createdBy);

  return repos.share.create({
    business_id: input.businessId,
    shareholder_name: input.shareholderName,
    transaction_type: input.transactionType,
    shares_count: input.sharesCount ?? null,
    amount: input.amount,
    share_account_id: input.shareAccountId,
    bank_account_id: input.bankAccountId,
    journal_entry_id: entry.id,
    reference: input.reference ?? null,
    notes: input.notes ?? null,
    created_by: input.createdBy,
  });
}
