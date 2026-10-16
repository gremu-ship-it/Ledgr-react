/**
 * Local-only material receipt preparation.
 *
 * This contract deliberately contains no inventory mutation, valuation, tax,
 * or journal fields. A prepared note is not an official receipt and is not
 * linked to a Ledgr purchase document, item, site, or inventory location.
 */
export const MATERIAL_RECEIPT_SOURCE_DOCUMENT_TYPES = [
  'purchase_order',
  'supplier_delivery_note',
  'supplier_invoice',
  'other',
] as const;

export type MaterialReceiptSourceDocumentType = (typeof MATERIAL_RECEIPT_SOURCE_DOCUMENT_TYPES)[number];
export type MaterialReceiptPreparationStatus = 'draft' | 'prepared';

export const MATERIAL_RECEIPT_SOURCE_DOCUMENT_LABELS: Record<MaterialReceiptSourceDocumentType, string> = {
  purchase_order: 'Purchase order',
  supplier_delivery_note: 'Supplier delivery note',
  supplier_invoice: 'Supplier invoice',
  other: 'Other source document',
};

export interface MaterialReceiptPreparationLineFields {
  /** UI-only row key; it is never sent to a repository or API. */
  lineLocalKey: number;
  materialDescription: string;
  itemCodeNote: string;
  unitNote: string;
  quantityDelivered: string;
  quantityAccepted: string;
  quantityRejected: string;
  lineNote: string;
}

export interface MaterialReceiptPreparationFields {
  sourceDocumentType: MaterialReceiptSourceDocumentType | '';
  sourceDocumentReference: string;
  sourceDocumentDate: string;
  supplierNameNote: string;
  destinationSiteNote: string;
  lines: MaterialReceiptPreparationLineFields[];
}

export interface LocalMaterialReceiptPreparation extends MaterialReceiptPreparationFields {
  /** Component-local key only. */
  localId: number;
  projectLocalId: number;
  businessId: string;
  status: MaterialReceiptPreparationStatus;
  createdAt: string;
  updatedAt: string;
}

export type MaterialReceiptPreparationLineField =
  | 'materialDescription'
  | 'itemCodeNote'
  | 'unitNote'
  | 'quantityDelivered'
  | 'quantityAccepted'
  | 'quantityRejected'
  | 'lineNote';

export interface MaterialReceiptPreparationErrors {
  sourceDocumentType?: string;
  sourceDocumentReference?: string;
  sourceDocumentDate?: string;
  destinationSiteNote?: string;
  lines?: Record<number, Partial<Record<MaterialReceiptPreparationLineField, string>>>;
  form?: string;
}

export interface MaterialReceiptPreparationValidationResult {
  values: MaterialReceiptPreparationFields | null;
  errors: MaterialReceiptPreparationErrors;
}

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECIMAL_PATTERN = /^(?:\d+(?:\.\d*)?|\.\d+)$/;

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

interface ParsedDecimal {
  coefficient: bigint;
  scale: number;
}

function parseQuantity(value: string): ParsedDecimal | null {
  const trimmed = value.trim();
  if (!trimmed || !DECIMAL_PATTERN.test(trimmed) || !Number.isFinite(Number(trimmed))) return null;
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

function sumExceeds(left: ParsedDecimal, right: ParsedDecimal, limit: ParsedDecimal): boolean {
  const scale = Math.max(left.scale, right.scale, limit.scale);
  return decimalAtScale(left, scale) + decimalAtScale(right, scale) > decimalAtScale(limit, scale);
}

function lineErrorsFor(
  errors: MaterialReceiptPreparationErrors,
  lineKey: number,
): Partial<Record<MaterialReceiptPreparationLineField, string>> {
  const current = errors.lines?.[lineKey] ?? {};
  errors.lines = { ...errors.lines, [lineKey]: current };
  return current;
}

/** Validate a receipt-preparation note without writing or posting inventory. */
export function validateMaterialReceiptPreparation(
  fields: MaterialReceiptPreparationFields,
): MaterialReceiptPreparationValidationResult {
  const errors: MaterialReceiptPreparationErrors = {};
  const sourceDocumentReference = fields.sourceDocumentReference.trim();
  const destinationSiteNote = fields.destinationSiteNote.trim();
  const sourceDocumentDate = fields.sourceDocumentDate.trim();

  if (!MATERIAL_RECEIPT_SOURCE_DOCUMENT_TYPES.includes(fields.sourceDocumentType as MaterialReceiptSourceDocumentType)) {
    errors.sourceDocumentType = 'Choose the source document type being referenced.';
  }
  if (!sourceDocumentReference) {
    errors.sourceDocumentReference = 'Add the reference shown on the source document.';
  }
  if (sourceDocumentDate && !isValidCalendarDate(sourceDocumentDate)) {
    errors.sourceDocumentDate = 'Enter a valid source document date.';
  }
  if (!destinationSiteNote) {
    errors.destinationSiteNote = 'Add a destination site or storage-point note.';
  }
  if (fields.lines.length === 0) {
    errors.form = 'Add at least one material line before preparing this note.';
  }

  const normalizedLines = fields.lines.map((line) => {
    const lineErrors = lineErrorsFor(errors, line.lineLocalKey);
    const materialDescription = line.materialDescription.trim();
    const unitNote = line.unitNote.trim();
    const quantityDeliveredText = line.quantityDelivered.trim();
    const quantityAcceptedText = line.quantityAccepted.trim();
    const quantityRejectedText = line.quantityRejected.trim();

    if (!materialDescription) lineErrors.materialDescription = 'Describe the material.';
    if (!unitNote) lineErrors.unitNote = 'Add the unit shown on the source document.';

    const quantityDelivered = parseQuantity(quantityDeliveredText);
    if (quantityDelivered === null || quantityDelivered.coefficient === 0n) {
      lineErrors.quantityDelivered = 'Enter a finite delivered quantity greater than zero.';
    }

    const hasAccepted = quantityAcceptedText.length > 0;
    const hasRejected = quantityRejectedText.length > 0;
    const quantityAccepted = hasAccepted ? parseQuantity(quantityAcceptedText) : null;
    const quantityRejected = hasRejected ? parseQuantity(quantityRejectedText) : null;

    if (hasAccepted && quantityAccepted === null) {
      lineErrors.quantityAccepted = 'Accepted quantity must be a finite non-negative decimal.';
    }
    if (hasRejected && quantityRejected === null) {
      lineErrors.quantityRejected = 'Rejected quantity must be a finite non-negative decimal.';
    }
    if (quantityDelivered !== null && quantityAccepted !== null && decimalExceeds(quantityAccepted, quantityDelivered)) {
      lineErrors.quantityAccepted = 'Accepted quantity cannot exceed delivered quantity.';
    }
    if (quantityDelivered !== null && quantityRejected !== null && decimalExceeds(quantityRejected, quantityDelivered)) {
      lineErrors.quantityRejected = 'Rejected quantity cannot exceed delivered quantity.';
    }
    if (
      quantityDelivered !== null
      && quantityAccepted !== null
      && quantityRejected !== null
      && sumExceeds(quantityAccepted, quantityRejected, quantityDelivered)
    ) {
      lineErrors.quantityRejected = 'Accepted plus rejected quantity cannot exceed delivered quantity.';
    }

    return {
      ...line,
      materialDescription,
      itemCodeNote: line.itemCodeNote.trim(),
      unitNote,
      quantityDelivered: quantityDeliveredText,
      quantityAccepted: quantityAcceptedText,
      quantityRejected: quantityRejectedText,
      lineNote: line.lineNote.trim(),
    };
  });

  if (errors.lines && Object.values(errors.lines).every((lineError) => Object.keys(lineError).length === 0)) {
    delete errors.lines;
  }

  if (Object.keys(errors).length > 0) return { values: null, errors };

  return {
    values: {
      sourceDocumentType: fields.sourceDocumentType,
      sourceDocumentReference,
      sourceDocumentDate,
      supplierNameNote: fields.supplierNameNote.trim(),
      destinationSiteNote,
      lines: normalizedLines,
    },
    errors: {},
  };
}
