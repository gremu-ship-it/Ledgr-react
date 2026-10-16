import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { repos } from '@/lib/repositories';
import type {
  ConstructionPurchaseOrder,
  ConstructionPurchaseOrderLine,
} from '@/dal/repositories/ConstructionProcurementRepository';
import { describeConstructionFailure } from '@/lib/construction/constructionCommandFeedback';
import { DELIVERY_NOTE_NOTE, newIdempotencyKey } from '@/lib/construction/constructionWorkspaceView';
import {
  FailureBanner,
  Field,
  FIELD_CLASS,
  InfoNote,
  StatusPill,
} from '@/components/construction/constructionUi';

/**
 * Delivery-note evidence against an authorized purchase order.
 *
 * This form records what the supplier's paperwork says. It cannot move stock:
 * the command it calls returns `stock_effect: 'none'` and `journal_effect: 'none'`,
 * and the interface says so before and after recording.
 */
export function ConstructionDeliveryNoteForm({
  businessId,
  po,
  lines,
  products,
  existingNotes,
  onRecorded,
  onCancel,
}: {
  businessId: string;
  po: ConstructionPurchaseOrder;
  lines: ConstructionPurchaseOrderLine[];
  products: Array<{ id: string; name: string }>;
  existingNotes: Array<{ id: string; delivery_note_number: string; document_date: string }>;
  onRecorded: (number: string) => void;
  onCancel: () => void;
}) {
  const [number, setNumber] = useState('');
  const [documentDate, setDocumentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [receivedBy, setReceivedBy] = useState('');
  const [evidence, setEvidence] = useState('');
  const [notes, setNotes] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [clientKey, setClientKey] = useState(() => newIdempotencyKey());

  const productsById = new Map(products.map((product) => [product.id, product]));

  const mutation = useMutation({
    mutationFn: () =>
      repos.construction.recordDeliveryNote(
        {
          business_id: businessId,
          po_id: po.id,
          delivery_note_number: number.trim(),
          document_date: documentDate,
          document_received_by: receivedBy.trim() || null,
          evidence_reference: evidence.trim(),
          notes: notes.trim() || null,
          lines: lines
            .filter((line) => (quantities[line.id] ?? '').trim() !== '')
            .map((line) => ({
              po_line_id: line.id,
              uom: line.uom,
              quantity_declared: quantities[line.id],
            })),
        },
        clientKey,
      ),
    onSuccess: (result) => {
      setClientKey(newIdempotencyKey());
      onRecorded(String(result.number ?? number));
    },
  });

  const declaredCount = lines.filter((line) => (quantities[line.id] ?? '').trim() !== '').length;
  const canSubmit = number.trim().length > 0 && evidence.trim().length > 0 && declaredCount > 0;

  return (
    <form
      className="mt-2 space-y-4 rounded-xl border border-gray-300 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
      aria-label="Record delivery note"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-gray-900">Record delivery note</h4>
        <StatusPill label="Evidence only" className="bg-slate-100 text-slate-700" />
      </div>
      <InfoNote>
        <p>{DELIVERY_NOTE_NOTE}</p>
      </InfoNote>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Supplier delivery note number" required hint="A duplicate for the same supplier is refused.">
          <input
            aria-label="Supplier delivery note number"
            value={number}
            onChange={(event) => setNumber(event.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
        <Field label="Document date" required>
          <input
            aria-label="Document date"
            type="date"
            value={documentDate}
            onChange={(event) => setDocumentDate(event.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
        <Field label="Received by (as written on the note)">
          <input aria-label="Received by" value={receivedBy} onChange={(event) => setReceivedBy(event.target.value)} className={FIELD_CLASS} />
        </Field>
      </div>

      <Field label="Evidence reference" required hint="Where the signed delivery note is filed. Required by the command.">
        <input aria-label="Evidence reference" value={evidence} onChange={(event) => setEvidence(event.target.value)} className={FIELD_CLASS} />
      </Field>

      <div className="space-y-2">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Declared quantities</h5>
        {existingNotes.length > 0 ? (
          <p className="text-xs text-gray-500">
            Already recorded against this order: {existingNotes.map((note) => note.delivery_note_number).join(', ')}
          </p>
        ) : null}
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-2 py-1">Product</th>
              <th className="px-2 py-1">Unit</th>
              <th className="px-2 py-1 text-right">Ordered</th>
              <th className="px-2 py-1">Declared on the note</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id} className="border-t border-gray-100">
                <td className="px-2 py-2 text-gray-900">{productsById.get(line.product_id)?.name ?? line.product_id}</td>
                <td className="px-2 py-2 text-gray-700">{line.uom}</td>
                <td className="px-2 py-2 text-right text-gray-700">{String(line.quantity_ordered)}</td>
                <td className="px-2 py-2">
                  <input
                    aria-label={`Declared quantity for line ${line.line_number}`}
                    type="number"
                    min="0"
                    step="any"
                    value={quantities[line.id] ?? ''}
                    onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))}
                    className={`${FIELD_CLASS} mt-0 w-32`}
                    placeholder="not declared"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Field label="Notes">
        <textarea aria-label="Delivery note notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className={FIELD_CLASS} />
      </Field>

      {mutation.isError ? <FailureBanner failure={describeConstructionFailure(mutation.error)} /> : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit || mutation.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
        >
          <FileText className="h-4 w-4" aria-hidden /> {mutation.isPending ? 'Recording…' : 'Record delivery note'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-gray-600 hover:text-gray-900">
          Cancel
        </button>
        {!canSubmit ? (
          <span className="text-xs text-gray-500">A note number, an evidence reference and at least one declared quantity are required.</span>
        ) : null}
      </div>
    </form>
  );
}
