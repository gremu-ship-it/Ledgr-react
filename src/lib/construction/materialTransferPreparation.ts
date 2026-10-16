/**
 * Local-only store-to-site transfer preparation and observation notes.
 *
 * This contract contains no inventory mutation, location IDs, valuation,
 * accounting, or server authorization fields. Its stage labels are not a
 * transfer approval or a stock-ledger status.
 */
export const MATERIAL_TRANSFER_PREPARATION_STAGES = [
  'draft',
  'prepared',
  'dispatch_noted',
  'receipt_noted',
] as const;

export type MaterialTransferPreparationStage = (typeof MATERIAL_TRANSFER_PREPARATION_STAGES)[number];

export const MATERIAL_TRANSFER_STAGE_LABELS: Record<MaterialTransferPreparationStage, string> = {
  draft: 'Draft · local only',
  prepared: 'Prepared in this tab · not approved',
  dispatch_noted: 'Dispatch quantities noted · not posted',
  receipt_noted: 'Receipt quantities noted · not posted',
};

export interface MaterialTransferPreparationLineFields {
  /** UI-only row key; it is never sent to a repository or API. */
  lineLocalKey: number;
  materialDescription: string;
  itemCodeNote: string;
  unitNote: string;
  quantityRequested: string;
  quantityDispatched: string;
  quantityReceived: string;
  exceptionNote: string;
}

export interface MaterialTransferPreparationFields {
  transferReferenceNote: string;
  sourceDocumentReference: string;
  transferDate: string;
  sourceStoreNote: string;
  destinationSiteNote: string;
  dispatchDate: string;
  dispatchNote: string;
  receiptDate: string;
  receiptNote: string;
  lines: MaterialTransferPreparationLineFields[];
}

export interface LocalMaterialTransferPreparation extends MaterialTransferPreparationFields {
  /** Component-local key only. */
  localId: number;
  projectLocalId: number;
  businessId: string;
  stage: MaterialTransferPreparationStage;
  createdAt: string;
  updatedAt: string;
}

export type MaterialTransferPreparationLineField =
  | 'materialDescription'
  | 'itemCodeNote'
  | 'unitNote'
  | 'quantityRequested'
  | 'quantityDispatched'
  | 'quantityReceived'
  | 'exceptionNote';

export interface MaterialTransferPreparationErrors {
  sourceStoreNote?: string;
  destinationSiteNote?: string;
  transferDate?: string;
  dispatchDate?: string;
  receiptDate?: string;
  lines?: Record<number, Partial<Record<MaterialTransferPreparationLineField, string>>>;
  form?: string;
}

export interface MaterialTransferPreparationValidationResult {
  values: MaterialTransferPreparationFields | null;
  errors: MaterialTransferPreparationErrors;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECIMAL_PATTERN = /^(?:\d+(?:\.\d*)?|\.\d+)$/;
// Bound hostile or accidentally pasted text before parsing/scaling BigInts; this is not inventory precision policy.
const MAX_QUANTITY_NOTE_LENGTH = 256;

interface ParsedDecimal {
  coefficient: bigint;
  scale: number;
}

function isValidCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function parseQuantity(value: string): ParsedDecimal | null {
  const trimmed = value.trim();
  if (
    !trimmed
    || trimmed.length > MAX_QUANTITY_NOTE_LENGTH
    || !DECIMAL_PATTERN.test(trimmed)
    || !Number.isFinite(Number(trimmed))
  ) return null;
  const [wholePart = '', fractionPart = ''] = trimmed.split('.');
  const digits = `${wholePart || '0'}${fractionPart}`.replace(/^0+(?=\d)/, '');
  return { coefficient: BigInt(digits || '0'), scale: fractionPart.length };
}

function decimalAtScale(value: ParsedDecimal, scale: number): bigint {
  return value.coefficient * (10n ** BigInt(scale - value.scale));
}

function decimalExceeds(value: ParsedDecimal, limit: ParsedDecimal): boolean {
  const scale = Math.max(value.scale, limit.scale);
  return decimalAtScale(value, scale) > decimalAtScale(limit, scale);
}

/** Exact comparison for validated local quantity notes; it does not imply a stock adjustment. */
export function compareMaterialTransferQuantityNotes(left: string, right: string): -1 | 0 | 1 | null {
  const leftQuantity = parseQuantity(left);
  const rightQuantity = parseQuantity(right);
  if (leftQuantity === null || rightQuantity === null) return null;

  const scale = Math.max(leftQuantity.scale, rightQuantity.scale);
  const leftValue = decimalAtScale(leftQuantity, scale);
  const rightValue = decimalAtScale(rightQuantity, scale);
  if (leftValue < rightValue) return -1;
  if (leftValue > rightValue) return 1;
  return 0;
}

function isZero(value: ParsedDecimal): boolean {
  return value.coefficient === 0n;
}

function lineErrorsFor(
  errors: MaterialTransferPreparationErrors,
  lineKey: number,
): Partial<Record<MaterialTransferPreparationLineField, string>> {
  const current = errors.lines?.[lineKey] ?? {};
  errors.lines = { ...errors.lines, [lineKey]: current };
  return current;
}

/** Validate local preparation/observation notes without writing stock or approvals. */
export function validateMaterialTransferPreparation(
  fields: MaterialTransferPreparationFields,
  stage: MaterialTransferPreparationStage,
): MaterialTransferPreparationValidationResult {
  const errors: MaterialTransferPreparationErrors = {};
  const sourceStoreNote = fields.sourceStoreNote.trim();
  const destinationSiteNote = fields.destinationSiteNote.trim();
  const transferDate = fields.transferDate.trim();
  const dispatchDate = fields.dispatchDate.trim();
  const receiptDate = fields.receiptDate.trim();

  if (!MATERIAL_TRANSFER_PREPARATION_STAGES.includes(stage)) {
    errors.form = 'Choose a local preparation stage.';
  }
  if (!sourceStoreNote) errors.sourceStoreNote = 'Add a source-store note.';
  if (!destinationSiteNote) errors.destinationSiteNote = 'Add a destination-site note.';
  if (transferDate && !isValidCalendarDate(transferDate)) errors.transferDate = 'Enter a valid transfer date.';
  if (dispatchDate && !isValidCalendarDate(dispatchDate)) errors.dispatchDate = 'Enter a valid dispatch-note date.';
  if (receiptDate && !isValidCalendarDate(receiptDate)) errors.receiptDate = 'Enter a valid receipt-note date.';
  if (fields.lines.length === 0) errors.form = 'Add at least one material line.';

  let dispatchLineCount = 0;
  let receiptLineCount = 0;
  const normalizedLines = fields.lines.map((line) => {
    const lineErrors = lineErrorsFor(errors, line.lineLocalKey);
    const materialDescription = line.materialDescription.trim();
    const unitNote = line.unitNote.trim();
    const quantityRequestedText = line.quantityRequested.trim();
    const quantityDispatchedText = line.quantityDispatched.trim();
    const quantityReceivedText = line.quantityReceived.trim();

    if (!materialDescription) lineErrors.materialDescription = 'Describe the material.';
    if (!unitNote) lineErrors.unitNote = 'Add the unit shown on the transfer note.';

    const quantityRequested = parseQuantity(quantityRequestedText);
    if (quantityRequested === null || isZero(quantityRequested)) {
      lineErrors.quantityRequested = 'Enter a valid decimal quantity greater than zero (maximum 256 characters).';
    }

    const hasDispatch = quantityDispatchedText.length > 0;
    const quantityDispatched = hasDispatch ? parseQuantity(quantityDispatchedText) : null;
    if (hasDispatch && (quantityDispatched === null || isZero(quantityDispatched))) {
      lineErrors.quantityDispatched = 'Dispatch quantity must be a valid decimal amount greater than zero (maximum 256 characters).';
    }
    if (
      quantityRequested !== null
      && quantityDispatched !== null
      && decimalExceeds(quantityDispatched, quantityRequested)
    ) {
      lineErrors.quantityDispatched = 'Dispatch quantity cannot exceed the requested quantity.';
    }
    if (hasDispatch && quantityDispatched !== null && !isZero(quantityDispatched)) dispatchLineCount += 1;

    const hasReceipt = quantityReceivedText.length > 0;
    const quantityReceived = hasReceipt ? parseQuantity(quantityReceivedText) : null;
    if (hasReceipt && quantityReceived === null) {
      lineErrors.quantityReceived = 'Receipt quantity must be a valid non-negative decimal (maximum 256 characters).';
    }
    if (hasReceipt && !hasDispatch) {
      lineErrors.quantityReceived = 'Add a dispatch quantity note before a receipt quantity note.';
    }
    if (
      quantityDispatched !== null
      && quantityReceived !== null
      && decimalExceeds(quantityReceived, quantityDispatched)
    ) {
      lineErrors.quantityReceived = 'Receipt quantity cannot exceed the dispatch quantity.';
    }
    if (hasReceipt && quantityReceived !== null && hasDispatch && quantityDispatched !== null) receiptLineCount += 1;

    if (stage === 'receipt_noted' && hasDispatch && !hasReceipt) {
      lineErrors.quantityReceived = 'Enter the received quantity note for each dispatched line.';
    }

    return {
      ...line,
      materialDescription,
      itemCodeNote: line.itemCodeNote.trim(),
      unitNote,
      quantityRequested: quantityRequestedText,
      quantityDispatched: quantityDispatchedText,
      quantityReceived: quantityReceivedText,
      exceptionNote: line.exceptionNote.trim(),
    };
  });

  if (stage === 'dispatch_noted' && dispatchLineCount === 0) {
    errors.form = 'Add at least one positive dispatch quantity note before recording this stage.';
  }
  if (stage === 'receipt_noted') {
    if (dispatchLineCount === 0) errors.form = 'Add dispatch quantity notes before recording a receipt note.';
    else if (receiptLineCount === 0) errors.form = 'Add at least one received quantity note.';
  }

  if (errors.lines && Object.values(errors.lines).every((lineError) => Object.keys(lineError).length === 0)) {
    delete errors.lines;
  }
  if (Object.keys(errors).length > 0) return { values: null, errors };

  return {
    values: {
      transferReferenceNote: fields.transferReferenceNote.trim(),
      sourceDocumentReference: fields.sourceDocumentReference.trim(),
      transferDate,
      sourceStoreNote,
      destinationSiteNote,
      dispatchDate,
      dispatchNote: fields.dispatchNote.trim(),
      receiptDate,
      receiptNote: fields.receiptNote.trim(),
      lines: normalizedLines,
    },
    errors: {},
  };
}
