import { describe, expect, it } from 'vitest';
import { buildRevenueBreakdown } from '../revenueBreakdown';

describe('buildRevenueBreakdown', () => {
  it('groups products, excludes VAT, converts to functional currency, and nets credit notes', () => {
    const rows = buildRevenueBreakdown(
      [
        { id: 'invoice-1', invoice_type: 'invoice', exchange_rate: 2 },
        { id: 'credit-1', invoice_type: 'credit_note', exchange_rate: 2 },
      ],
      [
        { invoice_id: 'invoice-1', product_id: 'rice', description: 'Rice (25kg)', quantity: 3, line_subtotal: 100, line_total: 116.5, tax_amount: 16.5 },
        // A positive credit-note line must still reduce revenue.
        { invoice_id: 'credit-1', product_id: 'rice', description: 'Rice (25kg)', quantity: 1, line_subtotal: 25, line_total: 29.125, tax_amount: 4.125 },
        { invoice_id: 'invoice-1', product_id: null, description: 'Delivery service', quantity: 1, line_subtotal: null, line_total: 58.25, tax_amount: 8.25 },
      ],
      new Map([['rice', 'Premium Rice']]),
    );

    expect(rows).toEqual([
      { key: 'product:rice', name: 'Premium Rice', quantity: 2, invoiceCount: 2, amount: 150 },
      { key: 'description:delivery service', name: 'Delivery service', quantity: 1, invoiceCount: 1, amount: 100 },
    ]);
  });
});
