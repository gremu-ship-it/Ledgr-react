import { numeric } from './employeeUtils';

export function formatPayPeriod(value: unknown, locale: string): string {
  if (!value) return '—';
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' }).format(date);
}

export function formatPayRunMoney(value: unknown, currency: string, locale: string): string {
  const amount = numeric(value);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function payRunPostingErrorTranslation(error: unknown): { key: string; values?: Record<string, string> } {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const expense = message.match(/Set an expense account on payroll component\s+(.+?)\s+before posting/i);
  if (expense) return { key: 'payroll.postMissingExpenseAccount', values: { component: expense[1] } };
  const liability = message.match(/Set a liability account on payroll component\s+(.+?)\s+before posting/i);
  if (liability) return { key: 'payroll.postMissingLiabilityAccount', values: { component: liability[1] } };
  const outsideBusiness = message.match(/Payroll component\s+(.+?)\s+points to an account outside this business/i);
  if (outsideBusiness) return { key: 'payroll.postInvalidComponentAccount', values: { component: outsideBusiness[1] } };
  const missingBands = message.match(/No PAYE tax bands are configured for fiscal year\s+(\d{4})/i);
  if (missingBands) return { key: 'payroll.postNoTaxBands', values: { year: missingBands[1] } };
  const deductions = message.match(/Deductions exceed gross pay for employee\s+(.+)/i);
  if (deductions) return { key: 'payroll.postDeductionsExceedGross', values: { employee: deductions[1] } };
  if (/Link an active bank account before posting payroll/i.test(message)) return { key: 'payroll.postMissingBankAccount' };
  if (/Pension Payable account/i.test(message)) return { key: 'payroll.postMissingPensionAccount' };
  if (/no included employees/i.test(message)) return { key: 'payroll.postNoEmployees' };
  return { key: 'payroll.postFailed' };
}
