import { useRef, useState } from 'react';
import {
  MATERIAL_RECEIPT_SOURCE_DOCUMENT_LABELS,
  MATERIAL_RECEIPT_SOURCE_DOCUMENT_TYPES,
  validateMaterialReceiptPreparation,
  type LocalMaterialReceiptPreparation,
  type MaterialReceiptPreparationErrors,
  type MaterialReceiptPreparationFields,
  type MaterialReceiptPreparationLineField,
  type MaterialReceiptPreparationLineFields,
  type MaterialReceiptPreparationStatus,
} from '@/lib/construction/materialReceiptPreparation';

const INPUT_CLASS = 'mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const LABEL_CLASS = 'block text-sm font-medium text-gray-800';
const ERROR_CLASS = 'mt-1 text-xs text-red-700';

interface MaterialReceiptPreparationSectionProps {
  projectLocalId: number;
  businessId: string;
  projectName: string;
  projectCode: string;
  siteName: string;
  siteLocation: string;
  preparations: LocalMaterialReceiptPreparation[];
  onSave: (
    fields: MaterialReceiptPreparationFields,
    localId: number | undefined,
    status: MaterialReceiptPreparationStatus,
  ) => number | null;
  onDiscard: (localId: number) => void;
}

type SectionView =
  | { mode: 'list' }
  | { mode: 'form'; localId?: number }
  | { mode: 'detail'; localId: number };

function newLine(lineLocalKey: number): MaterialReceiptPreparationLineFields {
  return {
    lineLocalKey,
    materialDescription: '',
    itemCodeNote: '',
    unitNote: '',
    quantityDelivered: '',
    quantityAccepted: '',
    quantityRejected: '',
    lineNote: '',
  };
}

function emptyFields(siteName: string, siteLocation: string): MaterialReceiptPreparationFields {
  return {
    sourceDocumentType: '',
    sourceDocumentReference: '',
    sourceDocumentDate: '',
    supplierNameNote: '',
    destinationSiteNote: [siteName, siteLocation].map((value) => value.trim()).filter(Boolean).join(' · '),
    lines: [newLine(1)],
  };
}

function fieldsFromPreparation(preparation: LocalMaterialReceiptPreparation): MaterialReceiptPreparationFields {
  return {
    sourceDocumentType: preparation.sourceDocumentType,
    sourceDocumentReference: preparation.sourceDocumentReference,
    sourceDocumentDate: preparation.sourceDocumentDate,
    supplierNameNote: preparation.supplierNameNote,
    destinationSiteNote: preparation.destinationSiteNote,
    lines: preparation.lines.map((line) => ({ ...line })),
  };
}

function preparationStatusLabel(status: MaterialReceiptPreparationStatus): string {
  return status === 'prepared' ? 'Prepared in this tab · not approved' : 'Draft · local';
}

function sourceDocumentLabel(type: MaterialReceiptPreparationFields['sourceDocumentType']): string {
  return type ? MATERIAL_RECEIPT_SOURCE_DOCUMENT_LABELS[type] : 'Unspecified source document';
}

export function MaterialReceiptPreparationSection({
  projectLocalId,
  businessId,
  projectName,
  projectCode,
  siteName,
  siteLocation,
  preparations,
  onSave,
  onDiscard,
}: MaterialReceiptPreparationSectionProps) {
  const [view, setView] = useState<SectionView>({ mode: 'list' });
  const [fields, setFields] = useState<MaterialReceiptPreparationFields>(() => emptyFields(siteName, siteLocation));
  const [errors, setErrors] = useState<MaterialReceiptPreparationErrors>({});
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const nextLineKey = useRef(2);

  const projectPreparations = preparations.filter((preparation) =>
    preparation.projectLocalId === projectLocalId && preparation.businessId === businessId,
  );
  const selectedPreparation = view.mode === 'detail' || view.mode === 'form'
    ? projectPreparations.find((preparation) => preparation.localId === view.localId)
    : undefined;

  function startNew() {
    saveLock.current = false;
    setSaving(false);
    nextLineKey.current = 2;
    setFields(emptyFields(siteName, siteLocation));
    setErrors({});
    setSaveError('');
    setView({ mode: 'form' });
  }

  function editPreparation(preparation: LocalMaterialReceiptPreparation) {
    saveLock.current = false;
    setSaving(false);
    const preparationFields = fieldsFromPreparation(preparation);
    nextLineKey.current = Math.max(0, ...preparationFields.lines.map((line) => line.lineLocalKey)) + 1;
    setFields(preparationFields);
    setErrors({});
    setSaveError('');
    setView({ mode: 'form', localId: preparation.localId });
  }

  function updateField(
    field: 'sourceDocumentType' | 'sourceDocumentReference' | 'sourceDocumentDate' | 'supplierNameNote' | 'destinationSiteNote',
    value: string,
  ) {
    setFields((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (field === 'supplierNameNote' || !current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function updateLine(
    lineLocalKey: number,
    field: MaterialReceiptPreparationLineField,
    value: string,
  ) {
    setFields((current) => ({
      ...current,
      lines: current.lines.map((line) => line.lineLocalKey === lineLocalKey ? { ...line, [field]: value } : line),
    }));
    setErrors((current) => {
      const lineErrors = current.lines?.[lineLocalKey];
      if (!lineErrors) return current;
      const nextLineErrors = { ...lineErrors };
      const fieldsToClear: MaterialReceiptPreparationLineField[] = [
        'quantityDelivered', 'quantityAccepted', 'quantityRejected',
      ].includes(field) ? ['quantityDelivered', 'quantityAccepted', 'quantityRejected'] : [field];
      for (const fieldToClear of fieldsToClear) delete nextLineErrors[fieldToClear];
      const nextLines = { ...current.lines, [lineLocalKey]: nextLineErrors };
      if (Object.keys(nextLineErrors).length === 0) delete nextLines[lineLocalKey];
      const { lines: previousLines, ...rest } = current;
      void previousLines;
      return Object.keys(nextLines).length === 0 ? rest : { ...rest, lines: nextLines };
    });
  }

  function savePreparation(status: MaterialReceiptPreparationStatus) {
    if (saveLock.current) return;
    saveLock.current = true;
    setSaving(true);
    setSaveError('');

    const validation = validateMaterialReceiptPreparation(fields);
    if (!validation.values) {
      setErrors(validation.errors);
      saveLock.current = false;
      setSaving(false);
      return;
    }

    const localId = onSave(validation.values, view.mode === 'form' ? view.localId : undefined, status);
    if (localId === null) {
      setSaveError('This local project context is no longer available. Return to the workspace and try again.');
      saveLock.current = false;
      setSaving(false);
      return;
    }

    setErrors({});
    setView({ mode: 'detail', localId });
    setSaving(false);
  }

  function discardPreparation(preparation: LocalMaterialReceiptPreparation) {
    onDiscard(preparation.localId);
    setSaveError('Local receipt preparation discarded. No inventory or accounting record was changed.');
    setView({ mode: 'list' });
  }

  return (
    <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5" aria-labelledby="construction-receipt-preparation-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="construction-receipt-preparation-title" className="text-lg font-semibold text-gray-900">Material receipt preparation</h3>
          <p className="mt-1 text-sm text-gray-600">Project: {projectName}{projectCode ? ` · ${projectCode}` : ''}</p>
        </div>
        {view.mode === 'list' && (
          <button
            type="button"
            onClick={startNew}
            className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800"
          >
            Prepare receipt note
          </button>
        )}
      </div>

      <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
        <strong>Preparation only — not a goods receipt.</strong> Source references and site details are free-text notes, not verified or linked Ledgr records.
        Saving here does not update stock, create a transfer, approve a receipt, or post accounting. Notes exist only in this page session.
      </div>

      {saveError && (
        <p role="status" aria-live="polite" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {saveError}
        </p>
      )}

      {view.mode === 'list' && (
        <div className="space-y-3">
          {projectPreparations.length === 0 ? (
            <p role="status" className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-5 text-sm text-gray-600">
              No material receipt preparations for this local project in this tab.
            </p>
          ) : (
            <ul className="space-y-2" aria-label="Local material receipt preparations">
              {projectPreparations.map((preparation) => (
                <li key={preparation.localId}>
                  <button
                    type="button"
                    onClick={() => { setSaveError(''); setView({ mode: 'detail', localId: preparation.localId }); }}
                    aria-label={`View receipt preparation ${preparation.sourceDocumentReference}`}
                    className="flex w-full flex-col gap-1 rounded-xl border border-gray-200 px-4 py-3 text-left hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="font-medium text-gray-900">
{sourceDocumentLabel(preparation.sourceDocumentType)} · {preparation.sourceDocumentReference}
                    </span>
                    <span className="text-xs text-gray-600">{preparationStatusLabel(preparation.status)} · {preparation.lines.length} line{preparation.lines.length === 1 ? '' : 's'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {view.mode === 'form' && (
        <form
          noValidate
          onSubmit={(event) => { event.preventDefault(); savePreparation('draft'); }}
          className="space-y-5 rounded-xl border border-gray-200 bg-gray-50 p-4"
        >
          <div>
            <button type="button" onClick={() => { setErrors({}); setView({ mode: 'list' }); }} className="text-sm font-medium text-gray-600 hover:text-gray-900">
              ← Back to receipt preparations
            </button>
            <h4 className="mt-2 font-semibold text-gray-900">{view.localId === undefined ? 'New receipt preparation' : 'Edit receipt preparation'}</h4>
            <p className="mt-1 text-xs leading-5 text-gray-600">Choose a source-document label and enter its reference. This form does not check the underlying document.</p>
          </div>

          {Object.keys(errors).length > 0 && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              Correct the highlighted fields before saving this local preparation.
            </p>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className={LABEL_CLASS} htmlFor="receipt-source-document-type">Source document type</label>
              <select
                id="receipt-source-document-type"
                value={fields.sourceDocumentType}
                onChange={(event) => updateField('sourceDocumentType', event.target.value as MaterialReceiptPreparationFields['sourceDocumentType'])}
                aria-invalid={errors.sourceDocumentType ? true : undefined}
                className={INPUT_CLASS}
              >
                <option value="">Choose a document type</option>
                {MATERIAL_RECEIPT_SOURCE_DOCUMENT_TYPES.map((type) => (
                  <option key={type} value={type}>{MATERIAL_RECEIPT_SOURCE_DOCUMENT_LABELS[type]}</option>
                ))}
              </select>
              {errors.sourceDocumentType && <p className={ERROR_CLASS}>{errors.sourceDocumentType}</p>}
            </div>

            <ReceiptTextField
              id="receipt-source-document-reference"
              label="Source document reference"
              value={fields.sourceDocumentReference}
              onChange={(value) => updateField('sourceDocumentReference', value)}
              error={errors.sourceDocumentReference}
              help="Free-text reference only; no purchase order, invoice, or delivery note is linked."
            />

            <ReceiptTextField
              id="receipt-source-document-date"
              label="Source document date"
              type="date"
              value={fields.sourceDocumentDate}
              onChange={(value) => updateField('sourceDocumentDate', value)}
              error={errors.sourceDocumentDate}
            />

            <ReceiptTextField
              id="receipt-supplier-name-note"
              label="Supplier name note"
              value={fields.supplierNameNote}
              onChange={(value) => updateField('supplierNameNote', value)}
              help="Optional note only; not linked to a supplier record."
            />

            <div className="md:col-span-2">
              <ReceiptTextField
                id="receipt-destination-site-note"
                label="Destination site or storage-point note"
                value={fields.destinationSiteNote}
                onChange={(value) => updateField('destinationSiteNote', value)}
                error={errors.destinationSiteNote}
                help="Prefilled from the local project brief when available; not a verified branch or inventory location."
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h5 className="font-semibold text-gray-900">Material lines</h5>
                <p className="text-xs text-gray-600">No item master, inventory balance, valuation, or tax record is loaded.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const lineLocalKey = nextLineKey.current;
                  nextLineKey.current += 1;
                  setFields((current) => ({ ...current, lines: [...current.lines, newLine(lineLocalKey)] }));
                  setErrors((current) => {
                    if (!current.form) return current;
                    const next = { ...current };
                    delete next.form;
                    return next;
                  });
                }}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100"
              >
                Add material line
              </button>
            </div>

            {errors.form && <p role="alert" className="text-sm text-red-700">{errors.form}</p>}

            {fields.lines.map((line, index) => {
              const lineErrors = errors.lines?.[line.lineLocalKey];
              const lineId = line.lineLocalKey;
              return (
                <fieldset key={lineId} className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
                  <legend className="px-1 text-sm font-semibold text-gray-800">Material line {index + 1}</legend>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <ReceiptTextField
                      id={`receipt-line-${lineId}-description`}
                      label="Material description"
                      value={line.materialDescription}
                      onChange={(value) => updateLine(lineId, 'materialDescription', value)}
                      error={lineErrors?.materialDescription}
                    />
                    <ReceiptTextField
                      id={`receipt-line-${lineId}-item-code`}
                      label="Item or code note"
                      value={line.itemCodeNote}
                      onChange={(value) => updateLine(lineId, 'itemCodeNote', value)}
                      help="Optional note; not checked against the item catalogue."
                    />
                    <ReceiptTextField
                      id={`receipt-line-${lineId}-unit`}
                      label="Unit note"
                      value={line.unitNote}
                      onChange={(value) => updateLine(lineId, 'unitNote', value)}
                      error={lineErrors?.unitNote}
                      help="Use the unit written on the source document."
                    />
                    <ReceiptTextField
                      id={`receipt-line-${lineId}-delivered`}
                      label="Delivered quantity"
                      type="number"
                      min="0"
                      step="any"
                      value={line.quantityDelivered}
                      onChange={(value) => updateLine(lineId, 'quantityDelivered', value)}
                      error={lineErrors?.quantityDelivered}
                    />
                    <ReceiptTextField
                      id={`receipt-line-${lineId}-accepted`}
                      label="Accepted quantity (optional)"
                      type="number"
                      min="0"
                      step="any"
                      value={line.quantityAccepted}
                      onChange={(value) => updateLine(lineId, 'quantityAccepted', value)}
                      error={lineErrors?.quantityAccepted}
                      help="Optional observation; blank means not assessed, not zero."
                    />
                    <ReceiptTextField
                      id={`receipt-line-${lineId}-rejected`}
                      label="Rejected quantity (optional)"
                      type="number"
                      min="0"
                      step="any"
                      value={line.quantityRejected}
                      onChange={(value) => updateLine(lineId, 'quantityRejected', value)}
                      error={lineErrors?.quantityRejected}
                      help="Optional observation; blank means not assessed, not zero."
                    />
                  </div>
                  <ReceiptTextField
                    id={`receipt-line-${lineId}-note`}
                    label="Line note"
                    value={line.lineNote}
                    onChange={(value) => updateLine(lineId, 'lineNote', value)}
                  />
                  <button
                    type="button"
                    onClick={() => setFields((current) => ({
                      ...current,
                      lines: current.lines.filter((candidate) => candidate.lineLocalKey !== lineId),
                    }))}
                    className="text-xs font-medium text-red-700 underline"
                  >
                    Remove material line {index + 1}
                  </button>
                </fieldset>
              );
            })}
          </div>

          <div className="flex flex-wrap gap-2 border-t border-gray-200 pt-4">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-50"
            >
              Save local receipt draft
            </button>
            <button
              type="button"
              onClick={() => savePreparation('prepared')}
              disabled={saving}
              className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
            >
              {saving ? 'Keeping preparation…' : 'Mark prepared in this tab'}
            </button>
            <button
              type="button"
              onClick={() => { setErrors({}); setSaveError(''); setView({ mode: 'list' }); }}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-white"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {view.mode === 'detail' && selectedPreparation && (
        <ReceiptPreparationDetails
          preparation={selectedPreparation}
          onEdit={() => editPreparation(selectedPreparation)}
          onDiscard={() => discardPreparation(selectedPreparation)}
        />
      )}
      {view.mode === 'detail' && !selectedPreparation && (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          This local receipt preparation is no longer available. Return to the list and try again.
          <button type="button" onClick={() => setView({ mode: 'list' })} className="ml-2 font-semibold underline">Back to receipt preparations</button>
        </p>
      )}
    </section>
  );
}

function ReceiptTextField({
  id,
  label,
  value,
  onChange,
  type = 'text',
  min,
  step,
  error,
  help,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'date' | 'number';
  min?: string;
  step?: string;
  error?: string;
  help?: string;
}) {
  const errorId = `${id}-error`;
  const helpId = `${id}-help`;
  return (
    <div>
      <label className={LABEL_CLASS} htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        min={min}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : help ? helpId : undefined}
        className={`${INPUT_CLASS} ${error ? 'border-red-400 focus:border-red-500 focus:ring-red-100' : ''}`}
      />
      {help && !error && <p id={helpId} className="mt-1 text-xs text-gray-500">{help}</p>}
      {error && <p id={errorId} className={ERROR_CLASS}>{error}</p>}
    </div>
  );
}

function ReceiptPreparationDetails({
  preparation,
  onEdit,
  onDiscard,
}: {
  preparation: LocalMaterialReceiptPreparation;
  onEdit: () => void;
  onDiscard: () => void;
}) {
  return (
    <div data-testid="material-receipt-preparation-detail" className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{preparationStatusLabel(preparation.status)}</p>
          <h4 className="mt-1 text-lg font-semibold text-gray-900">{sourceDocumentLabel(preparation.sourceDocumentType)} · {preparation.sourceDocumentReference}</h4>
          <p className="mt-1 text-sm text-gray-600">Destination note: {preparation.destinationSiteNote}</p>
        </div>
        <p className="text-xs text-gray-500">{preparation.sourceDocumentDate || 'Document date not added'}</p>
      </div>

      <p className="text-sm text-gray-700">
        <span className="font-semibold">Supplier note:</span> {preparation.supplierNameNote || 'Not added'}
      </p>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-[700px] w-full text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-2">Material note</th>
              <th className="px-3 py-2">Unit</th>
              <th className="px-3 py-2 text-right">Delivered</th>
              <th className="px-3 py-2 text-right">Accepted note</th>
              <th className="px-3 py-2 text-right">Rejected note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {preparation.lines.map((line) => (
              <tr key={line.lineLocalKey}>
                <td className="px-3 py-2">
                  <span className="font-medium text-gray-900">{line.materialDescription}</span>
                  {line.itemCodeNote && <span className="block text-xs text-gray-500">Code note: {line.itemCodeNote}</span>}
                  {line.lineNote && <span className="block text-xs text-gray-500">{line.lineNote}</span>}
                </td>
                <td className="px-3 py-2 text-gray-700">{line.unitNote}</td>
                <td className="px-3 py-2 text-right text-gray-700">{line.quantityDelivered}</td>
                <td className="px-3 py-2 text-right text-gray-700">{line.quantityAccepted || 'Not assessed'}</td>
                <td className="px-3 py-2 text-right text-gray-700">{line.quantityRejected || 'Not assessed'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div role="note" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        These values are preparation notes only. They are not receipt acceptance, source matching, stock movements, approvals, or accounting entries.
      </div>

      <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
        <button type="button" onClick={onEdit} className="rounded-lg bg-blue-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-800">Edit preparation</button>
        <button type="button" onClick={onDiscard} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50">Discard preparation</button>
      </div>
    </div>
  );
}
