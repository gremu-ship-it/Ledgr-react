import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
      aria-label={isException ? t('construction.procurement.receipts.deliveryNoteForm.ariaException') : t('construction.procurement.receipts.deliveryNoteForm.title')}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-gray-900">
          {isException ? t('construction.procurement.receipts.deliveryNoteForm.exceptionTitle') : t('construction.procurement.receipts.deliveryNoteForm.title')}
        </h4>
        <StatusPill label={t('construction.procurement.receipts.deliveryNoteForm.evidenceOnly')} className="bg-slate-100 text-slate-700" />
        {isException ? <StatusPill label={t('construction.procurement.receipts.deliveryNoteForm.exceptionPill')} className="bg-amber-100 text-amber-900" /> : null}
      </div>

      {isException ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p>
            {t('construction.procurement.receipts.deliveryNoteForm.excP1Before')}<strong>{t('construction.procurement.receipts.deliveryNoteForm.excP1Strong')}</strong>{t('construction.procurement.receipts.deliveryNoteForm.excP1After')}
          </p>
          <p className="mt-1">
            {t('construction.procurement.receipts.deliveryNoteForm.excP2Before')}<code>stock_effect: none</code>{t('construction.procurement.receipts.deliveryNoteForm.excP2Middle')}<code>journal_effect: none</code>{t('construction.procurement.receipts.deliveryNoteForm.excP2After')}
          </p>
        </div>
      ) : (
        <InfoNote>
          <p>{DELIVERY_NOTE_NOTE}</p>
        </InfoNote>
      )}

      {isException ? (
        <Field
          label={t('construction.procurement.receipts.deliveryNoteForm.conflictLabel')}
          required
          hint={t('construction.procurement.receipts.deliveryNoteForm.conflictHint')}
        >
          <select
            aria-label={t('construction.procurement.receipts.deliveryNoteForm.conflictLabel')}
            value={conflictId}
            onChange={(event) => setConflictId(event.target.value)}
            className={FIELD_CLASS}
          >
            <option value="">{t('construction.procurement.receipts.deliveryNoteForm.selectConflict')}</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {t('construction.procurement.receipts.deliveryNoteForm.conflictOption', {
                  number: candidate.delivery_note_number,
                  date: candidate.document_date,
                  evidence: candidate.evidence_reference,
                })}
              </option>
            ))}
          </select>
        </Field>
      ) : null}

      {isException && conflict ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
          <p className="font-medium text-gray-900">{t('construction.procurement.receipts.deliveryNoteForm.exceptionAgainst')}</p>
          <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-4">
            <div>
              <dt className="text-gray-500">{t('construction.procurement.receipts.deliveryNoteForm.noteNumber')}</dt>
              <dd className="font-mono">{conflict.delivery_note_number}</dd>
            </div>
            <div>
              <dt className="text-gray-500">{t('construction.procurement.receipts.deliveryNoteForm.documentDateDt')}</dt>
              <dd>{conflict.document_date}</dd>
            </div>
            <div>
              <dt className="text-gray-500">{t('construction.procurement.receipts.deliveryNoteForm.recordedBy')}</dt>
              <dd className="truncate">{conflict.recorded_by}</dd>
            </div>
            <div>
              <dt className="text-gray-500">{t('construction.procurement.receipts.deliveryNoteForm.evidenceDt')}</dt>
              <dd className="truncate">{conflict.evidence_reference}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {isException ? (
          <Field label={t('construction.procurement.receipts.deliveryNoteForm.reusedNumber')} required hint={t('construction.procurement.receipts.deliveryNoteForm.reusedHint')}>
            <input
              aria-label={t('construction.procurement.receipts.deliveryNoteForm.reusedNumber')}
              value={effectiveNumber}
              readOnly
              className={`${FIELD_CLASS} bg-gray-100 font-mono text-gray-700`}
            />
          </Field>
        ) : (
          <Field label={t('construction.procurement.receipts.deliveryNoteForm.numberLabel')} required hint={t('construction.procurement.receipts.deliveryNoteForm.numberHint')}>
            <input
              aria-label={t('construction.procurement.receipts.deliveryNoteForm.numberLabel')}
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              className={FIELD_CLASS}
            />
          </Field>
        )}
        <Field label={t('construction.procurement.receipts.deliveryNoteForm.documentDate')} required>
          <input
            aria-label={t('construction.procurement.receipts.deliveryNoteForm.documentDate')}
            type="date"
            value={documentDate}
            onChange={(event) => setDocumentDate(event.target.value)}
            className={FIELD_CLASS}
          />
        </Field>
        <Field label={t('construction.procurement.receipts.deliveryNoteForm.receivedByLabel')}>
          <input aria-label={t('construction.procurement.receipts.deliveryNoteForm.receivedByAria')} value={receivedBy} onChange={(event) => setReceivedBy(event.target.value)} className={FIELD_CLASS} />
        </Field>
      </div>

      <Field label={t('construction.procurement.receipts.deliveryNoteForm.evidenceLabel')} required hint={t('construction.procurement.receipts.deliveryNoteForm.evidenceHint')}>
        <input aria-label={t('construction.procurement.receipts.deliveryNoteForm.evidenceLabel')} value={evidence} onChange={(event) => setEvidence(event.target.value)} className={FIELD_CLASS} />
      </Field>

      {isException ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('construction.procurement.receipts.deliveryNoteForm.exceptionReason')} required hint={t('construction.procurement.receipts.deliveryNoteForm.exceptionReasonHint')}>
            <input
              aria-label={t('construction.procurement.receipts.deliveryNoteForm.exceptionReason')}
              value={exceptionReason}
              onChange={(event) => setExceptionReason(event.target.value)}
              className={FIELD_CLASS}
              placeholder={t('construction.procurement.receipts.deliveryNoteForm.exceptionReasonPlaceholder')}
            />
          </Field>
          <Field label={t('construction.procurement.receipts.deliveryNoteForm.exceptionEvidence')} required hint={t('construction.procurement.receipts.deliveryNoteForm.exceptionEvidenceHint')}>
            <input
              aria-label={t('construction.procurement.receipts.deliveryNoteForm.exceptionEvidence')}
              value={exceptionEvidence}
              onChange={(event) => setExceptionEvidence(event.target.value)}
              className={FIELD_CLASS}
              placeholder={t('construction.procurement.receipts.deliveryNoteForm.exceptionEvidencePlaceholder')}
            />
          </Field>
        </div>
      ) : null}

      <div className="space-y-2">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('construction.procurement.receipts.deliveryNoteForm.declaredQuantities')}</h5>
        {existingNotes.length > 0 ? (
          <p className="text-xs text-gray-500">
            {t('construction.procurement.receipts.deliveryNoteForm.alreadyRecorded', {
              list: existingNotes.map((note) => note.delivery_note_number).join(', '),
            })}
          </p>
        ) : null}
        <table className="min-w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
              <th className="px-2 py-1">{t('construction.procurement.receipts.deliveryNoteForm.thProduct')}</th>
              <th className="px-2 py-1">{t('construction.procurement.receipts.deliveryNoteForm.thUnit')}</th>
              <th className="px-2 py-1 text-right">{t('construction.procurement.receipts.deliveryNoteForm.thOrdered')}</th>
              <th className="px-2 py-1">{t('construction.procurement.receipts.deliveryNoteForm.thDeclared')}</th>
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
                    aria-label={t('construction.procurement.receipts.deliveryNoteForm.declaredAria', { line: line.line_number })}
                    type="number"
                    min="0"
                    step="any"
                    value={quantities[line.id] ?? ''}
                    onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))}
                    className={`${FIELD_CLASS} mt-0 w-32`}
                    placeholder={t('construction.procurement.receipts.deliveryNoteForm.notDeclared')}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Field label={t('construction.procurement.receipts.deliveryNoteForm.notesLabel')}>
        <textarea aria-label={t('construction.procurement.receipts.deliveryNoteForm.notesAria')} value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className={FIELD_CLASS} />
      </Field>

      {mutation.isError ? <FailureBanner failure={describeConstructionFailure(mutation.error)} /> : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit || mutation.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
        >
          <FileText className="h-4 w-4" aria-hidden />{' '}
          {mutation.isPending
            ? t('construction.procurement.receipts.deliveryNoteForm.recording')
            : isException
              ? t('construction.procurement.receipts.deliveryNoteForm.recordException')
              : t('construction.procurement.receipts.deliveryNoteForm.title')}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-gray-600 hover:text-gray-900">
          {t('construction.procurement.shared.cancel')}
        </button>
        {!canSubmit ? (
          <span className="text-xs text-gray-500">
            {isException
              ? t('construction.procurement.receipts.deliveryNoteForm.exceptionSubmitHint')
              : t('construction.procurement.receipts.deliveryNoteForm.submitHint')}
          </span>
        ) : null}
      </div>
    </form>
  );
}
