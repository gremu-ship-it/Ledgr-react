/**
 * Static sample books for the public `/demo` route.
 *
 * Nothing here is persisted or sent to Supabase. Figures are representative
 * MWK amounts for a fictional Lilongwe SME so visitors can see the product
 * without creating an account.
 */

export const DEMO_BUSINESS_NAME = 'Lilongwe Trading Ltd';

export const DEMO_KPIS = {
  netProfit: 1_280_000,
  totalIncome: 2_450_000,
  amountPaid: 1_964_000,
  totalExpenses: 1_170_000,
  accountsReceivable: 486_000,
  unpaidInvoiceCount: 3,
  vatAccrued: 312_000,
} as const;

export interface DemoTrendPoint {
  month: string;
  income: number;
  expenses: number;
}

export const DEMO_TREND: DemoTrendPoint[] = [
  { month: 'Apr', income: 1_820_000, expenses: 980_000 },
  { month: 'May', income: 1_950_000, expenses: 1_050_000 },
  { month: 'Jun', income: 2_110_000, expenses: 1_090_000 },
  { month: 'Jul', income: 2_040_000, expenses: 1_140_000 },
  { month: 'Aug', income: 2_280_000, expenses: 1_080_000 },
  { month: 'Sep', income: 2_450_000, expenses: 1_170_000 },
];

export type DemoInvoiceStatus = 'paid' | 'open' | 'overdue';

export interface DemoInvoice {
  id: string;
  number: string;
  client: string;
  amount: number;
  status: DemoInvoiceStatus;
  due: string;
}

export const DEMO_INVOICES: DemoInvoice[] = [
  { id: '1', number: 'INV-0042', client: 'Bvumbwe Traders', amount: 486_000, status: 'open', due: '2026-09-28' },
  { id: '2', number: 'INV-0041', client: 'Mzuzu Agro Ltd', amount: 312_500, status: 'paid', due: '2026-09-12' },
  { id: '3', number: 'INV-0040', client: 'Lilongwe Bookshop', amount: 158_000, status: 'open', due: '2026-10-02' },
  { id: '4', number: 'INV-0039', client: 'Blantyre Fresh Co', amount: 94_000, status: 'overdue', due: '2026-08-30' },
  { id: '5', number: 'INV-0038', client: 'Karonga Millers', amount: 221_000, status: 'paid', due: '2026-08-18' },
];

export function demoNetCashFlow(income = DEMO_KPIS.totalIncome, expenses = DEMO_KPIS.totalExpenses): number {
  return income - expenses;
}

export function demoProfitMargin(income = DEMO_KPIS.totalIncome, expenses = DEMO_KPIS.totalExpenses): number {
  if (income <= 0) return 0;
  return Math.round(((income - expenses) / income) * 100);
}
