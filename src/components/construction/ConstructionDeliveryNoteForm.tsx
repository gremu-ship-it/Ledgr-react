import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { repos } from '@/lib/repositories';
import type {
  ConstructionDeliveryNote,
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
 * and the interface says so before and after recording. There is no quantity cap
 * here either — what the supplier's paper claims is evidence, and the receipt is
 * the document that decides stock.
 *
 * ## The two modes
 *
 * `record` (the default) calls `record_construction_delivery_note`. When the
 * supplier reuses a delivery-note number that is already recorded for this
 * supplier the server refuses it (`supplier-delivery-note-duplicate`); the only
 * way to record that second document is `exception`, which calls
 * `record_construction_delivery_note_exception` and additionally names the
 * recorded note it duplicates, with a written reason and an evidence reference.
 *
 * Exception mode is therefore not "create another delivery note": the note number
 * is taken from the note being named (the server requires the two to be the same
 * reference anyway), that note is shown in full before submission, and the reason
 * and evidence are required fields. Both modes are evidence-only.
 */
export function ConstructionDeliveryNoteForm({
  businessId,
  po,
  lines,
  products,
  existingNotes,
  exception,
  onRecorded,
  onCancel,
}: {
  businessId: string;
  po: ConstructionPurchaseOrder;
  lines: ConstructionPurchaseOrderLine[];
  products: Array<{ id: string; name: string }>;
  existingNotes: Array<{ id: string; delivery_note_number: string; document_date: string }>;
  /**
   * Present this prop to record a duplicate as an authorized exception. The
   * candidates are the recorded, non-exception delivery notes for this supplier;
   * the database re-validates that the named note is the same business, the same
   * supplier and the same delivery-note reference, so this list is a convenience,
   * never the authority.
   */
  exception?: { candidates: ConstructionDeliveryNote[] };
  onRecorded: (number: string) => void;
  onCancel: () => void;
}) {
  const isException = Boolean(exception);
  const candidates = exception?.candidates ?? [];
  const [number, setNumber] = useState('');
  const [conflictId, setConflictId] = useState('');
  const [documentDate, setDocumentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [receivedBy, setReceivedBy] = useState('');
  const [evidence, setEvidence] = useState('');
  const [notes, setNotes] = useState('');
  const [exceptionReason, setExceptionReason] = useState('');
  const [exceptionEvidence, setExceptionEvidence] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [clientKey, setClientKey] = useState(() => newIdempotencyKey());

  const productsById = new Map(products.map((product) => [product.id, product]));

  const conflict = candidates.find((entry) => entry.id === conflictId) ?? null;

  // In exception mode the note number IS the record being corrected: the server
  // refuses unless the named note carries the same normalized reference, so the
  // number is taken from the named note and shown read-only rather than retyped.
  const effectiveNumber = isException ? (conflict?.delivery_note_number ?? '') : number.trim();

  const payload = () => ({
    business_id: businessId,
    po_id: po.id,
    delivery_note_number: effectiveNumber,
    document_date: documentDate,
    document_received_by: receivedBy.trim() || null,
    evidence_reference: evidence.trim(),
    notes: notes.trim() || null,
    ...(isException
      ? {
          exception_of: conflict?.id ?? '',
          exception_reason: exceptionReason.trim(),
          exception_evidence: exceptionEvidence.trim(),
        }
      : {}),
    lines: lines
      .filter((line) => (quantities[line.id] ?? '').trim() !== '')
      .map((line) => ({
        po_line_id: line.id,
        uom: line.uom,
        quantity_declared: quantities[line.id],
      })),
  });

  const mutation = useMutation({
    mutationFn: () =>
      isException
        ? repos.construction.recordDeliveryNoteException(payload(), clientKey)
        : repos.construction.recordDeliveryNote(payload(), clientKey),
    onSuccess: (result) => {
      // Only a completed command rotates the replay key, so a retry after a
      // failure replays the SAME key and the server recognises the duplicate.
      setClientKey(newIdempotencyKey());
      onRecorded(String(result.number ?? (isException ? effectiveNumber : number)));
    },
  });

  const declaredCount = lines.filter((line) => (quantities[line.id] ?? '').trim() !== '').length;
  const exceptionReady =
    !isException || (conflict !== null && exceptionReason.trim().length > 0 && exceptionEvidence.trim().length > 0);
  const canSubmit =
    effectiveNumber.trim().length > 0 && evidence.trim().length > 0 && declaredCount > 0 && exceptionReady;

  return (
    <form
      className="mt-2 space-y-4 rounded-xl border border-gray-300 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
      aria-label={isException ? 'Record duplicate delivery note exception' : 'Record delivery note'}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-gray-900">
          {isException ? 'Record duplicate delivery note — authorized exception' : 'Record delivery note'}
        </h4>
        <StatusPill label="Evidence only" className="bg-slate-100 text-slate-700" />
        {isException ? <StatusPill label="Exception" className="bg-amber-100 text-amber-900" /> : null}
      </div>

      {isException ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p>
            The supplier reused a delivery-note number that is <strong>already recorded</strong> for this supplier. This records the
            second document as an exception against the recorded one, and needs the exception authority plus a written reason and an
            evidence reference. The recorded note is not edited: construction procurement history is append-only.
          </p>
          <p className="mt-1">
            It is still evidence only — the command returns <code>stock_effect: none</code> and <code>journal_effect: none</code>.
            Nothing reaches stock until a goods receipt is recorded against the purchase order and the posting policy allows it.
          </p>
        </div>
      ) : (
        <InfoNote>
          <p>{DELIVERY_NOTE_NOTE}</p>
        </InfoNote>
      )}

      {isException ? (
        <Field
          label="Recorded delivery note this duplicates"
          required
          hint="Only the notes recorded for this supplier can be named. The server refuses any other note."
        >
          <select
            aria-label="Recorded delivery note this duplicates"
            value={conflictId}
            onChange={(event) => setConflictId(event.target.value)}
            className={FIELD_CLASS}
          >
            <option value="">Select the recorded delivery note…</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.delivery_note_number} · {candidate.document_date} · evidence {candidate.evidence_reference}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {isException && conflict ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
          <p className="font-medium text-gray-900">This will be recorded as an exception against:</p>
          <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
            <div>
              <dt className="text-gray-500">Note number</dt>
              <dd className="font-mono">{conflict.delivery_note_number}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Document date</dt>
              <dd>{conflict.document_date}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Recorded by</dt>
              <dd className="truncate">{conflict.recorded_by}</dd>
            </div>
            <div>
              <dt className="text-gray-500">Evidence</dt>
              <dd className="truncate">{conflict.evidence_reference}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {isException ? (
          <Field label="Reused delivery note number" required hint="Taken from the recorded note being named. Read-only — it is the conflict.">
            <input
              aria-label="Reused delivery note number"
              value={effectiveNumber}
              readOnly
              className={`${FIELD_CLASS} bg-gray-100 font-mono text-gray-700`}
            />
          </Field>
        ) : (
          <Field label="Supplier delivery note number" required hint="A duplicate for the same supplier is refused.">
            <input
              aria-label="Supplier delivery note number"
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              className={FIELD_CLASS}
            />
          </Field>
        )}
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

      {isException ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Exception reason" required hint="Why the supplier's reused number is being recorded rather than refused.">
            <input
              aria-label="Exception reason"
              value={exceptionReason}
              onChange={(event) => setExceptionReason(event.target.value)}
              className={FIELD_CLASS}
              placeholder="e.g. supplier reissued the same number for a second delivery"
            />
          </Field>
          <Field label="Exception evidence" required hint="The document that supports the exception — a supplier e-mail, a reissued note, a memo.">
            <input
              aria-label="Exception evidence"
              value={exceptionEvidence}
              onChange={(event) => setExceptionEvidence(event.target.value)}
              className={FIELD_CLASS}
              placeholder="e.g. supplier e-mail thread 2026-10-16"
            />
          </Field>
        </div>
      ) : null}

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
          <FileText className="h-4 w-4" aria-hidden />{' '}
          {mutation.isPending ? 'Recording…' : isException ? 'Record duplicate note as exception' : 'Record delivery note'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-gray-600 hover:text-gray-900">
          Cancel
        </button>
        {!canSubmit ? (
          <span className="text-xs text-gray-500">
            {isException
              ? 'The recorded note it duplicates, an exception reason, an exception evidence reference, the note evidence reference and at least one declared quantity are required.'
              : 'A note number, an evidence reference and at least one declared quantity are required.'}
          </span>
        ) : null}
      </div>
    </form>
  );
}
