import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import { repos } from '@/lib/repositories';
import {
  CONSTRUCTION_CAPABILITIES,
  type ConstructionPurchaseOrder,
  type ConstructionPurchaseOrderLine,
  type ReceiptHoldInput,
  type ReceiptLineInput,
} from '@/dal/repositories/ConstructionProcurementRepository';
import { describeConstructionFailure } from '@/lib/construction/constructionCommandFeedback';
import { newIdempotencyKey, toNumber } from '@/lib/construction/constructionWorkspaceView';
import {
  FailureBanner,
  Field,
  FIELD_CLASS,
  InfoNote,
  StatusPill,
} from '@/components/construction/constructionUi';

interface LineDraft {
  received: string;
  accepted: string;
  rejected: string;
  quarantined: string;
  disputed: string;
  holdReason: string;
  holdEvidence: string;
  note: string;
}

const EMPTY_LINE: LineDraft = {
  received: '',
  accepted: '',
  rejected: '0',
  quarantined: '0',
  disputed: '0',
  holdReason: '',
  holdEvidence: '',
  note: '',
};

/**
 * Goods receipt against an authorized purchase order.
 *
 * The form collects the five-way classification the command requires
 * (received = accepted + rejected + quarantined + disputed) and one hold with a
 * reason and evidence for every non-accepted bucket. The browser does not decide
 * whether that adds up: the database refuses an unbalanced classification and a
 * non-accepted quantity without a hold. The live balance line here is a form
 * affordance that highlights the arithmetic before the request is sent.
 */
export function ConstructionGoodsReceiptForm({
  businessId,
  po,
  lines,
  products,
  deliveryNotes,
  capabilities,
  onRecorded,
  onCancel,
}: {
  businessId: string;
  po: ConstructionPurchaseOrder;
  lines: ConstructionPurchaseOrderLine[];
  products: Array<{ id: string; name: string }>;
  deliveryNotes: Array<{ id: string; delivery_note_number: string; document_date: string }>;
  capabilities: string[];
  onRecorded: (number: string, acceptedBase: number) => void;
  onCancel: () => void;
}) {
  const [receiptDate, setReceiptDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [deliveryNoteId, setDeliveryNoteId] = useState(deliveryNotes[0]?.id ?? '');
  const [notes, setNotes] = useState('');
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>(() =>
    Object.fromEntries(lines.map((line) => [line.id, { ...EMPTY_LINE }])),
  );
  const [overReceiptReason, setOverReceiptReason] = useState('');
  const [overReceiptEvidence, setOverReceiptEvidence] = useState('');
  const [clientKey, setClientKey] = useState(() => newIdempotencyKey());

  const productsById = new Map(products.map((product) => [product.id, product]));
  const hasInspectionCapability = capabilities.includes(CONSTRUCTION_CAPABILITIES.receiptInspect);

  const setField = (lineId: string, field: keyof LineDraft, value: string) => {
    setDrafts((current) => ({ ...current, [lineId]: { ...(current[lineId] ?? EMPTY_LINE), [field]: value } }));
  };

  const activeLines = lines.filter((line) => (drafts[line.id]?.received ?? '').trim() !== '');

  const buildLineInput = (line: ConstructionPurchaseOrderLine): ReceiptLineInput => {
    const draft = drafts[line.id] ?? EMPTY_LINE;
    const received = toNumber(draft.received);
    const explicitAccepted = draft.accepted.trim() !== '' ? toNumber(draft.accepted) : null;
    const rejected = toNumber(draft.rejected);
    const quarantined = toNumber(draft.quarantined);
    const disputed = toNumber(draft.disputed);
    // Default: everything received is accepted unless the person says otherwise.
    const accepted = explicitAccepted ?? Math.max(received - rejected - quarantined - disputed, 0);
    const holds: ReceiptHoldInput[] = [];
    if (rejected > 0) {
      holds.push({ hold_type: 'rejected', quantity: rejected, reason: draft.holdReason, evidence_reference: draft.holdEvidence });
    }
    if (quarantined > 0) {
      holds.push({ hold_type: 'quarantined', quantity: quarantined, reason: draft.holdReason, evidence_reference: draft.holdEvidence });
    }
    if (disputed > 0) {
      holds.push({ hold_type: 'disputed', quantity: disputed, reason: draft.holdReason, evidence_reference: draft.holdEvidence });
    }
    return {
      po_line_id: line.id,
      quantity_received: draft.received,
      quantity_accepted: accepted,
      quantity_rejected: rejected,
      quantity_quarantined: quarantined,
      quantity_disputed: disputed,
      ...(overReceiptReason.trim() ? { over_receipt_reason: overReceiptReason.trim() } : {}),
      ...(overReceiptEvidence.trim() ? { over_receipt_evidence: overReceiptEvidence.trim() } : {}),
      line_note: draft.note.trim() || null,
      ...(holds.length > 0 ? { holds } : {}),
    };
  };

  const mutation = useMutation({
    mutationFn: () =>
      repos.construction.recordGoodsReceipt(
        {
          business_id: businessId,
          po_id: po.id,
          receipt_date: receiptDate,
          delivery_note_id: deliveryNoteId || null,
          notes: notes.trim() || null,
          lines: activeLines.map(buildLineInput),
        },
        clientKey,
      ),
    onSuccess: (result) => {
      setClientKey(newIdempotencyKey());
      const acceptedBase = activeLines.reduce((total, line) => {
        const draft = drafts[line.id] ?? EMPTY_LINE;
        const received = toNumber(draft.received);
        const accepted = draft.accepted.trim() !== '' ? toNumber(draft.accepted) : Math.max(received - toNumber(draft.rejected) - toNumber(draft.quarantined) - toNumber(draft.disputed), 0);
        const factor = toNumber(line.quantity_ordered_base) / Math.max(toNumber(line.quantity_ordered), 1);
        return total + accepted * factor;
      }, 0);
      onRecorded(String(result.number ?? ''), acceptedBase);
    },
  });

  const canSubmit = activeLines.length > 0 && activeLines.every((line) => {
    const draft = drafts[line.id] ?? EMPTY_LINE;
    const received = toNumber(draft.received);
    const explicitAccepted = draft.accepted.trim() !== '' ? toNumber(draft.accepted) : null;
    const rejected = toNumber(draft.rejected);
    const quarantined = toNumber(draft.quarantined);
    const disputed = toNumber(draft.disputed);
    const accepted = explicitAccepted ?? Math.max(received - rejected - quarantined - disputed, 0);
    const balanced = received > 0 && Math.abs(accepted + rejected + quarantined + disputed - received) < 1e-9;
    const held = rejected + quarantined + disputed;
    const holdsEvidenced = held === 0 || (draft.holdReason.trim().length > 0 && draft.holdEvidence.trim().length > 0);
    return balanced && holdsEvidenced;
  });

  return (
    <form
      className="mt-2 space-y-4 rounded-xl border border-gray-300 bg-white p-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
      aria-label="Record goods receipt"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-gray-900">Record goods receipt</h4>
        <StatusPill label="May lead to stock" className="bg-blue-50 text-blue-700" />
      </div>
      <InfoNote>
        <p>
          Only the accepted quantity can ever reach stock, and only after an evidenced cost basis exists and the approved posting policy allows a
          movement. Rejected, quarantined and disputed quantities stay outside inventory and are reported as outstanding supplier claims.
        </p>
        <p>No journal entry is created by a goods receipt.</p>
      </InfoNote>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Receipt date" required>
          <input aria-label="Receipt date" type="date" value={receiptDate} onChange={(event) => setReceiptDate(event.target.value)} className={FIELD_CLASS} />
        </Field>
        <Field label="Delivery note (optional)" hint="Link the supplier paperwork this receipt was checked against.">
          <select aria-label="Delivery note" value={deliveryNoteId} onChange={(event) => setDeliveryNoteId(event.target.value)} className={FIELD_CLASS}>
            <option value="">No delivery note linked</option>
            {deliveryNotes.map((note) => (
              <option key={note.id} value={note.id}>
                {note.delivery_note_number} ({note.document_date})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Notes">
          <input aria-label="Receipt notes" value={notes} onChange={(event) => setNotes(event.target.value)} className={FIELD_CLASS} />
        </Field>
      </div>

      <div className="space-y-3">
        {lines.map((line) => {
          const draft = drafts[line.id] ?? EMPTY_LINE;
          const received = toNumber(draft.received);
          const accepted = draft.accepted.trim() !== '' ? toNumber(draft.accepted) : Math.max(received - toNumber(draft.rejected) - toNumber(draft.quarantined) - toNumber(draft.disputed), 0);
          const held = toNumber(draft.rejected) + toNumber(draft.quarantined) + toNumber(draft.disputed);
          const difference = received - (accepted + held);
          const balanced = received === 0 || Math.abs(difference) < 1e-9;
          return (
            <fieldset key={line.id} className="rounded-lg border border-gray-200 p-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Line {line.line_number} · {productsById.get(line.product_id)?.name ?? line.product_id} · ordered {String(line.quantity_ordered)} {line.uom}
              </legend>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <Field label="Received" required>
                  <input
                    aria-label={`Received quantity line ${line.line_number}`}
                    type="number"
                    min="0"
                    step="any"
                    value={draft.received}
                    onChange={(event) => {
                      setField(line.id, 'received', event.target.value);
                      if (draft.accepted.trim() === '' && draft.rejected === '0' && draft.quarantined === '0' && draft.disputed === '0') {
                        setField(line.id, 'accepted', event.target.value);
                      }
                    }}
                    className={FIELD_CLASS}
                  />
                </Field>
                <Field label="Accepted">
                  <input
                    aria-label={`Accepted quantity line ${line.line_number}`}
                    type="number"
                    min="0"
                    step="any"
                    value={draft.accepted}
                    onChange={(event) => setField(line.id, 'accepted', event.target.value)}
                    className={FIELD_CLASS}
                  />
                </Field>
                <Field label="Rejected">
                  <input
                    aria-label={`Rejected quantity line ${line.line_number}`}
                    type="number"
                    min="0"
                    step="any"
                    value={draft.rejected}
                    onChange={(event) => setField(line.id, 'rejected', event.target.value)}
                    className={FIELD_CLASS}
                  />
                </Field>
                <Field label="Quarantined">
                  <input
                    aria-label={`Quarantined quantity line ${line.line_number}`}
                    type="number"
                    min="0"
                    step="any"
                    value={draft.quarantined}
                    onChange={(event) => setField(line.id, 'quarantined', event.target.value)}
                    className={FIELD_CLASS}
                  />
                </Field>
                <Field label="Disputed">
                  <input
                    aria-label={`Disputed quantity line ${line.line_number}`}
                    type="number"
                    min="0"
                    step="any"
                    value={draft.disputed}
                    onChange={(event) => setField(line.id, 'disputed', event.target.value)}
                    className={FIELD_CLASS}
                  />
                </Field>
              </div>

              {received > 0 ? (
                <p className={`mt-2 text-xs ${balanced ? 'text-gray-500' : 'text-amber-700'}`}>
                  {balanced
                    ? `Classification balances: ${accepted} accepted + ${held} held = ${received} received.`
                    : `Classification does not balance by ${difference.toFixed(6)}: received must equal accepted + rejected + quarantined + disputed.`}
                </p>
              ) : null}

              {held > 0 ? (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-medium text-amber-900">
                    {held} unit(s) are not accepted and each needs a hold with a reason and evidence.
                  </p>
                  {!hasInspectionCapability ? (
                    <p className="mt-1 text-xs text-amber-800">
                      Your account does not hold “Inspect and classify receipts”. The database will refuse this receipt; ask an approver to record it.
                    </p>
                  ) : null}
                  <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Hold reason" required>
                      <input
                        aria-label={`Hold reason line ${line.line_number}`}
                        value={draft.holdReason}
                        onChange={(event) => setField(line.id, 'holdReason', event.target.value)}
                        className={FIELD_CLASS}
                      />
                    </Field>
                    <Field label="Hold evidence reference" required>
                      <input
                        aria-label={`Hold evidence line ${line.line_number}`}
                        value={draft.holdEvidence}
                        onChange={(event) => setField(line.id, 'holdEvidence', event.target.value)}
                        className={FIELD_CLASS}
                      />
                    </Field>
                  </div>
                </div>
              ) : null}

              <div className="mt-3">
                <Field label="Line note">
                  <input
                    aria-label={`Line note ${line.line_number}`}
                    value={draft.note}
                    onChange={(event) => setField(line.id, 'note', event.target.value)}
                    className={FIELD_CLASS}
                  />
                </Field>
              </div>
            </fieldset>
          );
        })}
      </div>

      <details className="rounded-lg border border-gray-200 bg-gray-50 p-3">
        <summary className="cursor-pointer text-sm font-medium text-gray-800">Receiving more than was ordered?</summary>
        <p className="mt-1 text-xs text-gray-600">
          An over-receipt is refused unless an authorized reason and evidence are recorded. Leave these blank when receiving within the ordered
          quantity.
        </p>
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Over-receipt reason">
            <input aria-label="Over-receipt reason" value={overReceiptReason} onChange={(event) => setOverReceiptReason(event.target.value)} className={FIELD_CLASS} />
          </Field>
          <Field label="Over-receipt evidence">
            <input aria-label="Over-receipt evidence" value={overReceiptEvidence} onChange={(event) => setOverReceiptEvidence(event.target.value)} className={FIELD_CLASS} />
          </Field>
        </div>
      </details>

      {mutation.isError ? <FailureBanner failure={describeConstructionFailure(mutation.error)} /> : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!canSubmit || mutation.isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
        >
          <ClipboardCheck className="h-4 w-4" aria-hidden /> {mutation.isPending ? 'Recording…' : 'Record goods receipt'}
        </button>
        <button type="button" onClick={onCancel} className="text-sm text-gray-600 hover:text-gray-900">
          Cancel
        </button>
        {!canSubmit ? (
          <span className="text-xs text-gray-500">
            Enter at least one received quantity; the classification must balance and every hold needs a reason and evidence.
          </span>
        ) : null}
      </div>
    </form>
  );
}
