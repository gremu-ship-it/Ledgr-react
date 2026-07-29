import { supabase } from '@/lib/supabase';
import { repos } from '@/lib/repositories';
import { exchangeRateService } from '@/lib/currency';
import { nextEntryNumber } from '@/services/journalService';
import type { Row } from '@/dal/types/database';

type JournalLineInput = Parameters<typeof repos.journal.createBalancedEntry>[1][number];

export interface FxRevaluationResult {
  journalEntryId: string | null;
  lineCount: number;
  totalUnrealisedGain: number;
  totalUnrealisedLoss: number;
}

async function getAccountByCode(businessId: string, code: string): Promise<Row<'accounts'>> {
  const account = await repos.account.findByCode(businessId, code);
  if (!account) throw new Error(`Account ${code} not found. Please repair/reseed the Chart of Accounts.`);
  return account;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Manual IAS 21 period-end revaluation for open foreign-currency monetary
 * items. It revalues trade receivables (invoices with an outstanding balance)
 * and trade payables (supplier bills with an outstanding balance) using the
 * closing rate on `revaluationDate`, then posts unrealised FX gain/loss lines.
 */
export async function runFxRevaluation(
  businessId: string,
  revaluationDate: string,
  userId: string | null,
): Promise<FxRevaluationResult> {
  if (!userId) throw new Error('You must be signed in to run FX revaluation.');

  // Idempotency guard — MUST run before any journal lines are posted.
  // A re-run revalues open balances from the ORIGINAL booking rate
  // (invoice/expense.exchange_rate), ignoring the first run's own
  // revaluation journals, so it posts the same unrealised gain/loss a second
  // time and corrupts Debtors/Creditors and the P&L. fx_revaluations has a
  // unique (business_id, revaluation_date) constraint, but that only fires
  // AFTER the duplicate journal entry was posted — leaving it orphaned in
  // the ledger with no audit row. Check first instead.
  const { data: existingRuns, error: existingError } = await supabase
    .from('fx_revaluations')
    .select('id, status, journal_entry_id')
    .eq('business_id', businessId)
    .eq('revaluation_date', revaluationDate);
  if (existingError) throw existingError;
  if ((existingRuns as Array<{ status: string }> | null)?.length) {
    throw new Error(
      `FX revaluation has already been run for ${revaluationDate} (see fx_revaluations). ` +
      `Re-running would double-post unrealised gains/losses. ` +
      `To redo it, the existing run must be reversed in the ledger first.`,
    );
  }

  const business = await repos.business.findById(businessId);
  const functionalCurrency = business.base_currency || 'MWK';

  const [debtors, creditors, fxGain, fxLoss] = await Promise.all([
    getAccountByCode(businessId, '1131'),
    getAccountByCode(businessId, '2111'),
    getAccountByCode(businessId, '4230'),
    getAccountByCode(businessId, '7300'),
  ]);

  const [invoices, expenses] = await Promise.all([
    repos.invoice.findByBusiness(businessId),
    repos.expense.findByBusiness(businessId),
  ]);

  const lines: JournalLineInput[] = [];
  let lineNumber = 1;
  let totalUnrealisedGain = 0;
  let totalUnrealisedLoss = 0;

  for (const invoice of invoices) {
    const currency = invoice.original_currency ?? invoice.currency;
    if (!currency || currency === functionalCurrency) continue;
    if (!['sent', 'partially_paid', 'overdue'].includes(invoice.status)) continue;

    const totalOriginal = Number(invoice.original_amount ?? invoice.total_amount);
    const paidOriginal = Number(invoice.amount_paid ?? 0);
    const openOriginal = Math.max(0, totalOriginal - paidOriginal);
    if (openOriginal <= 0) continue;

    const bookedRate = Number(invoice.exchange_rate || 1);
    const closing = await exchangeRateService.getRate(businessId, currency, functionalCurrency, revaluationDate);
    const delta = roundMoney(openOriginal * (closing.rate - bookedRate));
    if (Math.abs(delta) < 0.005) continue;

    if (delta > 0) {
      totalUnrealisedGain += delta;
      lines.push({
        line_number: lineNumber++,
        account_id: debtors.id,
        description: `IAS 21 revaluation — ${invoice.invoice_number}`,
        is_debit: true,
        amount: openOriginal,
        amount_base: delta,
        currency,
        exchange_rate: closing.rate,
        original_currency: currency,
        original_amount: openOriginal,
        rate_date: closing.rateDate,
        rate_is_stale: closing.isStale,
        tax_code: 'none',
        tax_amount: 0,
        reconciled: false,
      });
      lines.push({
        line_number: lineNumber++,
        account_id: fxGain.id,
        description: `Unrealised FX gain — ${invoice.invoice_number}`,
        is_debit: false,
        amount: delta,
        amount_base: delta,
        currency: functionalCurrency,
        exchange_rate: 1,
        original_currency: functionalCurrency,
        original_amount: delta,
        rate_date: revaluationDate,
        rate_is_stale: false,
        tax_code: 'none',
        tax_amount: 0,
        reconciled: false,
      });
    } else {
      const loss = Math.abs(delta);
      totalUnrealisedLoss += loss;
      lines.push({
        line_number: lineNumber++,
        account_id: fxLoss.id,
        description: `Unrealised FX loss — ${invoice.invoice_number}`,
        is_debit: true,
        amount: loss,
        amount_base: loss,
        currency: functionalCurrency,
        exchange_rate: 1,
        original_currency: functionalCurrency,
        original_amount: loss,
        rate_date: revaluationDate,
        rate_is_stale: false,
        tax_code: 'none',
        tax_amount: 0,
        reconciled: false,
      });
      lines.push({
        line_number: lineNumber++,
        account_id: debtors.id,
        description: `IAS 21 revaluation — ${invoice.invoice_number}`,
        is_debit: false,
        amount: openOriginal,
        amount_base: loss,
        currency,
        exchange_rate: closing.rate,
        original_currency: currency,
        original_amount: openOriginal,
        rate_date: closing.rateDate,
        rate_is_stale: closing.isStale,
        tax_code: 'none',
        tax_amount: 0,
        reconciled: false,
      });
    }
  }

  for (const expense of expenses) {
    const currency = expense.original_currency ?? expense.currency;
    if (!currency || currency === functionalCurrency) continue;
    if (!['draft', 'approved', 'partially_paid'].includes(expense.status)) continue;

    const totalOriginal = Number(expense.original_amount ?? expense.total_amount);
    const paidOriginal = Number(expense.amount_paid ?? 0);
    const openOriginal = Math.max(0, totalOriginal - paidOriginal);
    if (openOriginal <= 0) continue;

    const bookedRate = Number(expense.exchange_rate || 1);
    const closing = await exchangeRateService.getRate(businessId, currency, functionalCurrency, revaluationDate);
    const liabilityIncrease = roundMoney(openOriginal * (closing.rate - bookedRate));
    if (Math.abs(liabilityIncrease) < 0.005) continue;

    if (liabilityIncrease > 0) {
      totalUnrealisedLoss += liabilityIncrease;
      lines.push({
        line_number: lineNumber++,
        account_id: fxLoss.id,
        description: `Unrealised FX loss — ${expense.expense_number}`,
        is_debit: true,
        amount: liabilityIncrease,
        amount_base: liabilityIncrease,
        currency: functionalCurrency,
        exchange_rate: 1,
        original_currency: functionalCurrency,
        original_amount: liabilityIncrease,
        rate_date: revaluationDate,
        rate_is_stale: false,
        tax_code: 'none',
        tax_amount: 0,
        reconciled: false,
      });
      lines.push({
        line_number: lineNumber++,
        account_id: creditors.id,
        description: `IAS 21 revaluation — ${expense.expense_number}`,
        is_debit: false,
        amount: openOriginal,
        amount_base: liabilityIncrease,
        currency,
        exchange_rate: closing.rate,
        original_currency: currency,
        original_amount: openOriginal,
        rate_date: closing.rateDate,
        rate_is_stale: closing.isStale,
        tax_code: 'none',
        tax_amount: 0,
        reconciled: false,
      });
    } else {
      const gain = Math.abs(liabilityIncrease);
      totalUnrealisedGain += gain;
      lines.push({
        line_number: lineNumber++,
        account_id: creditors.id,
        description: `IAS 21 revaluation — ${expense.expense_number}`,
        is_debit: true,
        amount: openOriginal,
        amount_base: gain,
        currency,
        exchange_rate: closing.rate,
        original_currency: currency,
        original_amount: openOriginal,
        rate_date: closing.rateDate,
        rate_is_stale: closing.isStale,
        tax_code: 'none',
        tax_amount: 0,
        reconciled: false,
      });
      lines.push({
        line_number: lineNumber++,
        account_id: fxGain.id,
        description: `Unrealised FX gain — ${expense.expense_number}`,
        is_debit: false,
        amount: gain,
        amount_base: gain,
        currency: functionalCurrency,
        exchange_rate: 1,
        original_currency: functionalCurrency,
        original_amount: gain,
        rate_date: revaluationDate,
        rate_is_stale: false,
        tax_code: 'none',
        tax_amount: 0,
        reconciled: false,
      });
    }
  }

  if (lines.length === 0) {
    await supabase.from('fx_revaluations').insert({
      business_id: businessId,
      revaluation_date: revaluationDate,
      total_unrealised_gain: 0,
      total_unrealised_loss: 0,
      line_count: 0,
      created_by: userId,
    } as never);
    return { journalEntryId: null, lineCount: 0, totalUnrealisedGain: 0, totalUnrealisedLoss: 0 };
  }

  const entryNumber = await nextEntryNumber(businessId);
  const { entry } = await repos.journal.createBalancedEntry(
    {
      business_id: businessId,
      entry_number: entryNumber,
      entry_date: revaluationDate,
      description: `IAS 21 period-end FX revaluation ${revaluationDate}`,
      source_type: 'fx_revaluation',
      source_id: null,
      currency: functionalCurrency,
      exchange_rate: 1,
      status: 'draft',
      created_by: userId,
    },
    lines,
  );

  await repos.journal.post(entry.id, userId);

  await supabase.from('fx_revaluations').insert({
    business_id: businessId,
    revaluation_date: revaluationDate,
    journal_entry_id: entry.id,
    total_unrealised_gain: roundMoney(totalUnrealisedGain),
    total_unrealised_loss: roundMoney(totalUnrealisedLoss),
    line_count: lines.length,
    created_by: userId,
  } as never);

  return {
    journalEntryId: entry.id,
    lineCount: lines.length,
    totalUnrealisedGain: roundMoney(totalUnrealisedGain),
    totalUnrealisedLoss: roundMoney(totalUnrealisedLoss),
  };
}
