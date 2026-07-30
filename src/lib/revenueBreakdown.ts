export interface RevenueInvoice {
  id: string;
  invoice_type: string;
  exchange_rate: number | null;
}

export interface RevenueInvoiceLine {
  invoice_id: string;
  product_id: string | null;
  description: string;
  quantity: number | null;
  line_subtotal: number | null;
  line_total: number;
  tax_amount: number;
}

export interface RevenueBreakdownRow {
  key: string;
  name: string;
  quantity: number;
  invoiceCount: number;
  amount: number;
}

/**
 * Produces an invoice-based, functional-currency revenue analysis.
 * Invoice line amounts are net of VAT: VAT is collected for the tax authority,
 * not revenue. Credit notes are explicitly negative so imports where credit
 * note lines were saved as positive values still reduce the related product or
 * service's revenue.
 */
export function buildRevenueBreakdown(
  invoices: RevenueInvoice[],
  lines: RevenueInvoiceLine[],
  productNames: ReadonlyMap<string, string> = new Map(),
): RevenueBreakdownRow[] {
  const invoicesById = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const grouped = new Map<string, RevenueBreakdownRow & { invoiceIds: Set<string> }>();

  for (const line of lines) {
    const invoice = invoicesById.get(line.invoice_id);
    if (!invoice) continue;

    const key = line.product_id ? `product:${line.product_id}` : `description:${line.description.trim().toLowerCase()}`;
    const name = line.product_id
      ? (productNames.get(line.product_id) ?? line.description.trim()) || 'Uncategorised product or service'
      : line.description.trim() || 'Uncategorised product or service';
    const subtotal = Number(line.line_subtotal ?? (Number(line.line_total) - Number(line.tax_amount)));
    const direction = invoice.invoice_type === 'credit_note' ? -1 : 1;
    const amount = direction * subtotal * Number(invoice.exchange_rate || 1);
    const quantity = direction * Number(line.quantity ?? 0);
    const current = grouped.get(key) ?? { key, name, quantity: 0, invoiceCount: 0, amount: 0, invoiceIds: new Set<string>() };

    current.quantity += quantity;
    current.amount += amount;
    current.invoiceIds.add(invoice.id);
    current.invoiceCount = current.invoiceIds.size;
    grouped.set(key, current);
  }

  return [...grouped.values()]
    .map((row) => ({
      key: row.key,
      name: row.name,
      quantity: row.quantity,
      invoiceCount: row.invoiceCount,
      amount: row.amount,
    }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name));
}
