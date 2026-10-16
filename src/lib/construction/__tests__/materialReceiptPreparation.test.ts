import { describe, expect, it } from 'vitest';
import {
  validateMaterialReceiptPreparation,
  type MaterialReceiptPreparationFields,
} from '../materialReceiptPreparation';

function receipt(overrides: Partial<MaterialReceiptPreparationFields> = {}): MaterialReceiptPreparationFields {
  return {
    sourceDocumentType: 'supplier_delivery_note',
    sourceDocumentReference: 'DN-0057',
    sourceDocumentDate: '2026-10-14',
    supplierNameNote: 'Supplier note',
    destinationSiteNote: 'North site · Blantyre',
    lines: [{
      lineLocalKey: 1,
      materialDescription: 'Cement',
      itemCodeNote: 'CEM-01',
      unitNote: 'bag',
      quantityDelivered: '10',
      quantityAccepted: '8',
      quantityRejected: '2',
      lineNote: '',
    }],
    ...overrides,
  };
}

describe('local material receipt preparation validation', () => {
  it('accepts a source-referenced preparation and preserves quantity notes without valuation fields', () => {
    const result = validateMaterialReceiptPreparation(receipt());

    expect(result.errors).toEqual({});
    expect(result.values).toMatchObject({
      sourceDocumentType: 'supplier_delivery_note',
      sourceDocumentReference: 'DN-0057',
      destinationSiteNote: 'North site · Blantyre',
      lines: [{
        materialDescription: 'Cement',
        unitNote: 'bag',
        quantityDelivered: '10',
        quantityAccepted: '8',
        quantityRejected: '2',
      }],
    });
    expect(result.values).not.toHaveProperty('unitCost');
    expect(result.values).not.toHaveProperty('accountId');
    expect(result.values).not.toHaveProperty('journalEntry');
  });

  it('requires a source-document type, reference, destination note, and at least one line', () => {
    const result = validateMaterialReceiptPreparation(receipt({
      sourceDocumentType: '',
      sourceDocumentReference: '   ',
      destinationSiteNote: '',
      lines: [],
    }));

    expect(result.values).toBeNull();
    expect(result.errors.sourceDocumentType).toBeTruthy();
    expect(result.errors.sourceDocumentReference).toBeTruthy();
    expect(result.errors.destinationSiteNote).toBeTruthy();
    expect(result.errors.form).toContain('at least one material line');
  });

  it('requires the material description and a unit note for each line', () => {
    const result = validateMaterialReceiptPreparation(receipt({
      lines: [{
        lineLocalKey: 1,
        materialDescription: ' ',
        itemCodeNote: '',
        unitNote: '',
        quantityDelivered: '2',
        quantityAccepted: '',
        quantityRejected: '',
        lineNote: '',
      }],
    }));

    expect(result.values).toBeNull();
    expect(result.errors.lines?.[1]?.materialDescription).toBeTruthy();
    expect(result.errors.lines?.[1]?.unitNote).toBeTruthy();
  });

  it.each(['0', '-1', 'Infinity', '1e6', '12x', '9'.repeat(400)])('rejects invalid delivered quantities: %s', (quantityDelivered) => {
    const result = validateMaterialReceiptPreparation(receipt({
      lines: [{ ...receipt().lines[0], quantityDelivered }],
    }));

    expect(result.values).toBeNull();
    expect(result.errors.lines?.[1]?.quantityDelivered).toBe('Enter a finite delivered quantity greater than zero.');
  });

  it.each([
    ['accepted', 'quantityAccepted', '-1'],
    ['accepted', 'quantityAccepted', 'Infinity'],
    ['rejected', 'quantityRejected', '1e3'],
  ] as const)('rejects an invalid %s quantity (%s)', (_label, field, value) => {
    const line = { ...receipt().lines[0], [field]: value };
    const result = validateMaterialReceiptPreparation(receipt({ lines: [line] }));

    expect(result.values).toBeNull();
    expect(result.errors.lines?.[1]?.[field]).toBeTruthy();
  });

  it('keeps an unentered inspection quantity unassessed rather than converting it to zero', () => {
    const result = validateMaterialReceiptPreparation(receipt({
      lines: [{ ...receipt().lines[0], quantityAccepted: '7', quantityRejected: '' }],
    }));

    expect(result.errors).toEqual({});
    expect(result.values?.lines[0].quantityAccepted).toBe('7');
    expect(result.values?.lines[0].quantityRejected).toBe('');
  });

  it('rejects accepted plus rejected quantities above the delivered amount', () => {
    const result = validateMaterialReceiptPreparation(receipt({
      lines: [{ ...receipt().lines[0], quantityAccepted: '8', quantityRejected: '3' }],
    }));

    expect(result.values).toBeNull();
    expect(result.errors.lines?.[1]?.quantityRejected).toContain('cannot exceed delivered');
  });

  it('compares decimal inspection quantities without binary floating-point false positives', () => {
    const result = validateMaterialReceiptPreparation(receipt({
      lines: [{ ...receipt().lines[0], quantityDelivered: '0.3', quantityAccepted: '0.1', quantityRejected: '0.2' }],
    }));

    expect(result.errors).toEqual({});
    expect(result.values?.lines[0].quantityDelivered).toBe('0.3');
  });

  it('allows delivered quantities to remain unassessed and validates calendar dates', () => {
    const valid = validateMaterialReceiptPreparation(receipt({
      sourceDocumentDate: '',
      lines: [{ ...receipt().lines[0], quantityAccepted: '', quantityRejected: '' }],
    }));
    expect(valid.errors).toEqual({});
    expect(valid.values?.lines[0].quantityAccepted).toBe('');

    const invalidDate = validateMaterialReceiptPreparation(receipt({ sourceDocumentDate: '2026-02-29' }));
    expect(invalidDate.values).toBeNull();
    expect(invalidDate.errors.sourceDocumentDate).toBe('Enter a valid source document date.');
  });

  it('trims free-text source, destination, supplier, and material notes', () => {
    const result = validateMaterialReceiptPreparation(receipt({
      sourceDocumentReference: '  DN-9  ',
      supplierNameNote: '  Supplier note  ',
      destinationSiteNote: '  Site note  ',
      lines: [{
        ...receipt().lines[0],
        materialDescription: '  Sand  ',
        itemCodeNote: '  SND-01  ',
        unitNote: '  tonne  ',
        lineNote: '  Bags torn  ',
      }],
    }));

    expect(result.errors).toEqual({});
    expect(result.values).toMatchObject({
      sourceDocumentReference: 'DN-9',
      supplierNameNote: 'Supplier note',
      destinationSiteNote: 'Site note',
      lines: [{ materialDescription: 'Sand', itemCodeNote: 'SND-01', unitNote: 'tonne', lineNote: 'Bags torn' }],
    });
  });
});
