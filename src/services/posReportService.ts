import type { PosShift } from '@/types/pos';
import { formatMwkDetailed } from '@/lib/formatters';

export interface PosShiftReportPayload {
  shift_id: string;
  business_id?: string;
  branch_id?: string | null;
  opened_at?: string | null;
  closed_at?: string | null;
  status?: string;
  shift_number?: string | null;
  cashier_name?: string | null;
  opening_cash?: number | string | null;
  cash_tenders?: number | string | null;
  other_tenders?: number | string | null;
  total_sales?: number | string | null;
  sales_count?: number | string | null;
  gross_sales?: number | string | null;
  discount_total?: number | string | null;
  net_sales?: number | string | null;
  tax_total?: number | string | null;
  tax_breakdown?: Record<string, { amount?: number | string; count?: number | string }> | null;
  tender_breakdown?: Record<string, number | string> | null;
  tender_counts?: Record<string, { count?: number | string; total?: number | string }> | null;
  refund_total?: number | string | null;
  refunds_gross_total?: number | string | null;
  return_count?: number | string | null;
  cash_in_total?: number | string | null;
  cash_out_total?: number | string | null;
  expected_cash?: number | string | null;
  actual_cash?: number | string | null;
  variance?: number | string | null;
  cash_movements?: Array<{
    movement_type: string;
    amount: number | string;
    reason: string;
    created_at: string;
  }>;
  report_number?: string | null;
  close?: {
    report_number?: string | null;
    closed_at?: string | null;
    expected_cash?: number | string | null;
    actual_cash?: number | string | null;
    variance?: number | string | null;
  } | null;
}

export interface PosZReportSummary {
  businessId: string;
  businessName: string;
  branchName: string;
  reportNumber: string;
  generatedAt: string;
  shift: PosShift;
  shiftNumber: string;
  cashierName: string;
  grossSales: number | null;
  discountsTotal: number | null;
  netSales: number | null;
  taxTotal: number | null;
  taxBreakdown: NonNullable<PosShiftReportPayload['tax_breakdown']>;
  refundsTotal: number | null;
  returnCount: number | null;
  openingFloat: number | null;
  cashInTotal: number | null;
  cashOutTotal: number | null;
  expectedCashInDrawer: number | null;
  actualCountedCash: number | null;
  cashVariance: number | null;
  varianceStatus: 'balanced' | 'surplus' | 'shortage' | 'unavailable';
  paymentBreakdown: Record<string, { count: number | null; total: number | null }>;
  cashMovements: NonNullable<PosShiftReportPayload['cash_movements']>;
  transactionsCount: number | null;
}

function numericOrNull(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstNumber(...values: Array<number | string | null | undefined>): number | null {
  for (const value of values) {
    const number = numericOrNull(value);
    if (number !== null) return number;
  }
  return null;
}

/**
 * Formats only a report returned for this exact shift by get_pos_shift_report.
 * No invoice/sales list is accepted here: all financial values remain
 * server-authoritative and cannot include activity from another shift.
 */
export function generateZReportSummary(
  shift: PosShift,
  report: PosShiftReportPayload,
  businessName = 'Ledgr Store',
  branchName = 'Main Branch',
): PosZReportSummary {
  if (report.shift_id !== shift.id) {
    throw new Error('Shift report payload does not match the requested shift.');
  }

  const expectedCash = firstNumber(report.close?.expected_cash, report.expected_cash);
  const actualCash = firstNumber(report.close?.actual_cash, report.actual_cash, shift.actual_cash, shift.closing_cash_actual);
  const variance = firstNumber(
    report.close?.variance,
    report.variance,
    shift.cash_variance,
    shift.variance,
  );
  const varianceStatus = variance === null
    ? 'unavailable'
    : variance === 0
      ? 'balanced'
      : variance > 0
        ? 'surplus'
        : 'shortage';

  const methodKeys = new Set([
    ...Object.keys(report.tender_breakdown ?? {}),
    ...Object.keys(report.tender_counts ?? {}),
  ]);
  const paymentBreakdown = Object.fromEntries(Array.from(methodKeys, (method) => {
    const tender = report.tender_counts?.[method];
    return [method, {
      count: numericOrNull(tender?.count),
      total: firstNumber(tender?.total, report.tender_breakdown?.[method]),
    }];
  }));

  return {
    businessId: report.business_id ?? shift.business_id,
    businessName,
    branchName,
    reportNumber: report.close?.report_number ?? report.report_number ?? '—',
    generatedAt: report.close?.closed_at ?? report.closed_at ?? new Date().toISOString(),
    shift,
    shiftNumber: report.shift_number ?? shift.shift_number ?? shift.id,
    cashierName: report.cashier_name ?? shift.cashier_name ?? '—',
    grossSales: numericOrNull(report.gross_sales),
    discountsTotal: numericOrNull(report.discount_total),
    netSales: firstNumber(report.net_sales, report.total_sales),
    taxTotal: numericOrNull(report.tax_total),
    taxBreakdown: report.tax_breakdown ?? {},
    refundsTotal: firstNumber(report.refunds_gross_total, report.refund_total),
    returnCount: numericOrNull(report.return_count),
    openingFloat: firstNumber(report.opening_cash, shift.opening_cash, shift.opening_float),
    cashInTotal: numericOrNull(report.cash_in_total),
    cashOutTotal: numericOrNull(report.cash_out_total),
    expectedCashInDrawer: expectedCash,
    actualCountedCash: actualCash,
    cashVariance: variance,
    varianceStatus,
    paymentBreakdown,
    cashMovements: report.cash_movements ?? [],
    transactionsCount: numericOrNull(report.sales_count),
  };
}

export function formatZReportEmailBody(summary: PosZReportSummary): string {
  const amount = (value: number | null) => value === null ? 'Not available' : formatMwkDetailed(value);
  return `
END-OF-DAY POS Z-REPORT (${summary.reportNumber})
========================================
Store: ${summary.businessName} (${summary.branchName})
Shift: ${summary.shiftNumber}
Cashier: ${summary.cashierName}
Date: ${new Date(summary.generatedAt).toLocaleString()}
Shift Duration: ${summary.shift.opened_at ? new Date(summary.shift.opened_at).toLocaleTimeString() : '—'} - ${summary.shift.closed_at ? new Date(summary.shift.closed_at).toLocaleTimeString() : 'Current'}

FINANCIAL SUMMARY:
----------------------------------------
Gross Sales:        ${amount(summary.grossSales)}
Discounts Total:    ${amount(summary.discountsTotal)}
Net Sales Revenue:  ${amount(summary.netSales)}
Tax / VAT:          ${amount(summary.taxTotal)}
Refunds Processed:  ${amount(summary.refundsTotal)} (${summary.returnCount ?? '—'} returns)

CASH DRAWER RECONCILIATION:
----------------------------------------
Opening Float:      ${amount(summary.openingFloat)}
Cash In (Top-ups):  ${amount(summary.cashInTotal)}
Cash Out (Drops):   ${amount(summary.cashOutTotal)}
Expected in Drawer: ${amount(summary.expectedCashInDrawer)}
Actual Counted:     ${amount(summary.actualCountedCash)}
Variance:           ${summary.cashVariance === null ? 'Not available' : `${summary.cashVariance >= 0 ? '+' : ''}${amount(summary.cashVariance)} (${summary.varianceStatus.toUpperCase()})`}

Generated from the server-authoritative Ledgr POS shift report.
  `.trim();
}
