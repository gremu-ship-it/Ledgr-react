import type { PosShift, PosSale } from '@/types/pos';
import { formatMwkDetailed } from '@/lib/formatters';

export interface PosZReportSummary {
  businessId: string;
  businessName: string;
  branchName: string;
  reportNumber: string;
  generatedAt: string;
  shift: PosShift;
  cashierName: string;
  grossSales: number;
  discountsTotal: number;
  netSales: number;
  taxTotal: number;
  refundsTotal: number;
  openingFloat: number;
  cashInTotal: number;
  cashOutTotal: number;
  expectedCashInDrawer: number;
  actualCountedCash: number;
  cashVariance: number;
  varianceStatus: 'balanced' | 'surplus' | 'shortage';
  paymentBreakdown: Record<string, { count: number; total: number }>;
  transactionsCount: number;
}

export function generateZReportSummary(
  shift: PosShift,
  sales: PosSale[] = [],
  businessName = 'Ledgr Store',
  branchName = 'Main Branch',
): PosZReportSummary {
  const openingFloat = Number(shift.opening_cash ?? shift.opening_float ?? 0);
  const actualCash = Number(shift.actual_cash ?? shift.closing_cash_actual ?? 0);
  const expectedCash = Number(shift.expected_cash ?? shift.expectedCash ?? openingFloat);
  const variance = Number(shift.cash_variance ?? (actualCash - expectedCash));

  let grossSales = 0;
  let discountsTotal = 0;
  let netSales = 0;
  let taxTotal = 0;
  let refundsTotal = 0;

  const paymentBreakdown: Record<string, { count: number; total: number }> = {
    cash: { count: 0, total: Number(shift.cash_sales_amount || 0) },
    airtel_money: { count: 0, total: 0 },
    tnm_mpamba: { count: 0, total: 0 },
    bank_transfer: { count: 0, total: 0 },
    card: { count: 0, total: 0 },
    credit_sale: { count: 0, total: 0 },
  };

  sales.forEach((s) => {
    const gross = Number(s.gross_amount ?? (s as any).grossAmount ?? s.total_amount ?? 0);
    const disc = Number(s.discount_amount ?? (s as any).discountAmount ?? 0);
    const net = Number(s.net_amount ?? (s as any).netAmount ?? (gross - disc));
    const tax = Number(s.tax_amount ?? (s as any).taxAmount ?? 0);

    if (s.status === 'returned') {
      refundsTotal += net;
    } else if (s.status !== 'voided') {
      grossSales += gross;
      discountsTotal += disc;
      netSales += net;
      taxTotal += tax;
    }
  });

  if (grossSales === 0 && Number(shift.total_sales_amount) > 0) {
    grossSales = Number(shift.total_sales_amount);
    netSales = Number(shift.total_sales_amount);
  }

  const reportNumber = `Z-${new Date().getFullYear()}-${String(Date.now()).slice(-5)}`;
  const varianceStatus = variance === 0 ? 'balanced' : variance > 0 ? 'surplus' : 'shortage';

  return {
    businessId: shift.business_id,
    businessName,
    branchName,
    reportNumber,
    generatedAt: new Date().toISOString(),
    shift,
    cashierName: shift.cashier_name || 'Cashier',
    grossSales,
    discountsTotal,
    netSales,
    taxTotal,
    refundsTotal: refundsTotal || Number(shift.refunds_amount || 0),
    openingFloat,
    cashInTotal: Number(shift.cash_in_amount || 0),
    cashOutTotal: Number(shift.cash_out_amount || 0),
    expectedCashInDrawer: expectedCash,
    actualCountedCash: actualCash,
    cashVariance: variance,
    varianceStatus,
    paymentBreakdown,
    transactionsCount: sales.length,
  };
}

export function formatZReportEmailBody(summary: PosZReportSummary): string {
  return `
END-OF-DAY POS Z-REPORT (${summary.reportNumber})
========================================
Store: ${summary.businessName} (${summary.branchName})
Cashier: ${summary.cashierName}
Date: ${new Date(summary.generatedAt).toLocaleString()}
Shift Duration: ${new Date(summary.shift.opened_at).toLocaleTimeString()} - ${summary.shift.closed_at ? new Date(summary.shift.closed_at).toLocaleTimeString() : 'Current'}

FINANCIAL SUMMARY:
----------------------------------------
Gross Sales:        ${formatMwkDetailed(summary.grossSales)}
Discounts Total:    -${formatMwkDetailed(summary.discountsTotal)}
Net Sales Revenue:  ${formatMwkDetailed(summary.netSales)}
Tax / VAT (16.5%):  ${formatMwkDetailed(summary.taxTotal)}
Refunds Processed:  -${formatMwkDetailed(summary.refundsTotal)}

CASH DRAWER RECONCILIATION:
----------------------------------------
Opening Float:      ${formatMwkDetailed(summary.openingFloat)}
Cash In (Top-ups):  +${formatMwkDetailed(summary.cashInTotal)}
Cash Out (Drops):   -${formatMwkDetailed(summary.cashOutTotal)}
Expected in Drawer: ${formatMwkDetailed(summary.expectedCashInDrawer)}
Actual Counted:     ${formatMwkDetailed(summary.actualCountedCash)}
Variance:           ${summary.cashVariance >= 0 ? '+' : ''}${formatMwkDetailed(summary.cashVariance)} (${summary.varianceStatus.toUpperCase()})

Generated securely by Ledgr POS.
  `.trim();
}
