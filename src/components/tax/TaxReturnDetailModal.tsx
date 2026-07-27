import { useState } from 'react';
import { X, Download, ExternalLink, Receipt } from 'lucide-react';
import { repos } from '@/lib/repositories';
import { useTaxPayments } from '@/hooks/useTaxObligations';
import type { TaxObligation } from '@/hooks/useTaxObligations';
import { formatCurrencyAmount } from '@/lib/currency';
import { formatDueDate } from '@/lib/taxDates';
import { getJurisdictionRules, type Jurisdiction } from '@/lib/taxRules';

/**
 * Statutory return view. For VAT this is the Form VAT 3 layout — output tax,
 * input tax, net payable — which is what MRA's return actually asks for.
 * PAYE and TPR show their remittance schedule equivalents.
 */
export function TaxReturnDetailModal({
  obligation,
  jurisdiction,
  currency,
  businessName,
  tpin,
  onClose,
}: {
  obligation: TaxObligation;
  jurisdiction: Jurisdiction;
  currency: string;
  businessName: string;
  tpin?: string | null;
  onClose: () => void;
}) {
  const tr = obligation.taxReturn;
  const { data: payments = [] } = useTaxPayments(tr.id);
  const [receiptUrl, setReceiptUrl] = useState<string | null>(null);
  const rules = getJurisdictionRules(jurisdiction);

  const isVat = tr.tax_code === 'vat_standard';
  const outputTax = Number(tr.output_tax);
  const inputTax = Number(tr.input_tax);
  const net = outputTax - inputTax;

  async function openReceipt(path: string) {
    const url = await repos.taxPayment.getReceiptUrl(path);
    if (url) {
      setReceiptUrl(url);
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  function exportCsv() {
    const rows: string[][] = [
      ['Ledgr — ' + (obligation.formName ?? `${obligation.label} Return`)],
      ['Business', businessName],
      ...(tpin ? [['TPIN', tpin]] : []),
      ['Authority', rules.authorityName],
      ['Period', obligation.periodDisplay],
      ['Period start', tr.period_start],
      ['Period end', tr.period_end],
      ['Due date', tr.due_date],
      [],
    ];

    if (isVat) {
      rows.push(
        ['Box', 'Description', `Amount (${currency})`],
        ['1', 'Output tax (VAT on sales)', outputTax.toFixed(2)],
        ['2', 'Input tax (VAT on purchases)', inputTax.toFixed(2)],
        ['3', net >= 0 ? 'Net VAT payable' : 'Net VAT repayable', Math.abs(net).toFixed(2)],
      );
    } else {
      rows.push(
        ['Description', `Amount (${currency})`],
        [`Total ${obligation.label}`, Number(tr.gross_amount).toFixed(2)],
        ['Amount due', Number(tr.amount_due).toFixed(2)],
      );
    }

    rows.push(
      [],
      ['Amount paid', Number(tr.amount_paid).toFixed(2)],
      ['Outstanding', obligation.outstanding.toFixed(2)],
      ['Status', tr.status],
      ...(tr.filed_ref ? [['Filing reference', tr.filed_ref]] : []),
    );

    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${obligation.shortLabel}-${tr.period_label}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-gray-200 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              {obligation.formName ?? `${obligation.label} Return`}
            </h2>
            <p className="text-xs text-gray-500">
              {businessName} · {obligation.periodDisplay} · {rules.authorityName}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 transition-colors hover:text-gray-600" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Period</p>
              <p className="font-medium text-gray-900">{obligation.periodDisplay}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Due date</p>
              <p className="font-medium text-gray-900">{formatDueDate(tr.due_date)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">Status</p>
              <p className="font-medium capitalize text-gray-900">{tr.status}</p>
            </div>
            {tpin && (
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">TPIN</p>
                <p className="font-medium text-gray-900">{tpin}</p>
              </div>
            )}
          </div>

          {isVat ? (
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                  <tr>
                    <th scope="col" className="w-16 px-4 py-2.5 text-left">Box</th>
                    <th scope="col" className="px-4 py-2.5 text-left">Description</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <tr>
                    <td className="px-4 py-3 text-gray-500">1</td>
                    <td className="px-4 py-3 text-gray-700">Output tax — VAT charged on sales</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {formatCurrencyAmount(outputTax, currency)}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-gray-500">2</td>
                    <td className="px-4 py-3 text-gray-700">Input tax — VAT paid on purchases</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      ({formatCurrencyAmount(inputTax, currency)})
                    </td>
                  </tr>
                  <tr className="bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-500">3</td>
                    <td className="px-4 py-3 font-semibold text-gray-900">
                      {net >= 0 ? 'Net VAT payable to ' + rules.authority : 'Net VAT repayable by ' + rules.authority}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${net >= 0 ? 'text-gray-900' : 'text-brand-700'}`}>
                      {formatCurrencyAmount(Math.abs(net), currency)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  <tr>
                    <td className="px-4 py-3 text-gray-700">Total {obligation.label} for the period</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900">
                      {formatCurrencyAmount(Number(tr.gross_amount), currency)}
                    </td>
                  </tr>
                  <tr className="bg-gray-50">
                    <td className="px-4 py-3 font-semibold text-gray-900">Amount due</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">
                      {formatCurrencyAmount(Number(tr.amount_due), currency)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 rounded-xl bg-gray-50 px-4 py-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Paid to date</span>
              <span className="font-medium text-gray-900">
                {formatCurrencyAmount(Number(tr.amount_paid), currency)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">Outstanding</span>
              <span className="font-semibold text-gray-900">
                {formatCurrencyAmount(obligation.outstanding, currency)}
              </span>
            </div>
          </div>

          {tr.filed_ref && (
            <p className="text-sm text-gray-600">
              Filed{tr.filed_at ? ` on ${formatDueDate(tr.filed_at.slice(0, 10))}` : ''} · reference{' '}
              <span className="font-medium text-gray-900">{tr.filed_ref}</span>
            </p>
          )}

          {payments.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-gray-900">Payments</h3>
              <div className="overflow-hidden rounded-xl border border-gray-200">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                    <tr>
                      <th scope="col" className="px-4 py-2.5 text-left">Date</th>
                      <th scope="col" className="px-4 py-2.5 text-left">Method</th>
                      <th scope="col" className="px-4 py-2.5 text-left">Reference</th>
                      <th scope="col" className="px-4 py-2.5 text-right">Amount</th>
                      <th scope="col" className="px-4 py-2.5 text-center">Receipt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="px-4 py-2.5 text-gray-700">{p.payment_date}</td>
                        <td className="px-4 py-2.5 capitalize text-gray-700">
                          {p.payment_method.replace(/_/g, ' ')}
                        </td>
                        <td className="px-4 py-2.5 text-gray-500">{p.reference ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right font-medium text-gray-900">
                          {formatCurrencyAmount(Number(p.amount), currency)}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {p.receipt_path ? (
                            <button
                              onClick={() => openReceipt(p.receipt_path!)}
                              className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700"
                            >
                              <Receipt className="h-3.5 w-3.5" />
                              View
                            </button>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {receiptUrl && (
            <p className="text-xs text-gray-500">
              Receipt opened in a new tab. The link expires in 5 minutes.
            </p>
          )}
        </div>

        <div className="flex justify-between gap-2 border-t border-gray-200 px-6 py-4">
          <a
            href={rules.portalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            {rules.authority} portal
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <div className="flex gap-2">
            <button onClick={exportCsv}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
            <button onClick={onClose}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
