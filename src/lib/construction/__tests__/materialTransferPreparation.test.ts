import { describe, expect, it } from 'vitest';
import {
  compareMaterialTransferQuantityNotes,
  validateMaterialTransferPreparation,
  type MaterialTransferPreparationFields,
  type MaterialTransferPreparationStage,
} from '../materialTransferPreparation';

function transfer(overrides: Partial<MaterialTransferPreparationFields> = {}): MaterialTransferPreparationFields {
  return {
    transferReferenceNote: 'TR-NOTE-01',
    sourceDocumentReference: 'REQ-NOTE-8',
    transferDate: '2026-10-14',
    sourceStoreNote: 'Main store note',
    destinationSiteNote: 'North site · Blantyre',
    dispatchDate: '',
    dispatchNote: '',
    receiptDate: '',
    receiptNote: '',
    lines: [{
      lineLocalKey: 1,
      materialDescription: 'Cement',
      itemCodeNote: 'CEM-01',
      unitNote: 'bag',
      quantityRequested: '10',
      quantityDispatched: '',
      quantityReceived: '',
      exceptionNote: '',
    }],
    ...overrides,
  };
}

function line(overrides: Partial<MaterialTransferPreparationFields['lines'][number]> = {}) {
  return { ...transfer().lines[0], ...overrides };
}

function validate(
  fields: MaterialTransferPreparationFields = transfer(),
  stage: MaterialTransferPreparationStage = 'prepared',
) {
  return validateMaterialTransferPreparation(fields, stage);
}

describe('local store-to-site transfer preparation validation', () => {
  it('accepts a prepared local note without inventing inventory, authorization, or accounting fields', () => {
    const result = validate();

    expect(result.errors).toEqual({});
    expect(result.values).toMatchObject({
      transferReferenceNote: 'TR-NOTE-01',
      sourceStoreNote: 'Main store note',
      destinationSiteNote: 'North site · Blantyre',
      lines: [{
        materialDescription: 'Cement',
        unitNote: 'bag',
        quantityRequested: '10',
        quantityDispatched: '',
        quantityReceived: '',
      }],
    });
    expect(result.values).not.toHaveProperty('stockMovement');
    expect(result.values).not.toHaveProperty('inventoryLocationId');
    expect(result.values).not.toHaveProperty('approval');
    expect(result.values).not.toHaveProperty('journalEntry');
  });

  it('requires source and destination notes and at least one material line', () => {
    const result = validate(transfer({
      sourceStoreNote: ' ',
      destinationSiteNote: '',
      lines: [],
    }));

    expect(result.values).toBeNull();
    expect(result.errors.sourceStoreNote).toBeTruthy();
    expect(result.errors.destinationSiteNote).toBeTruthy();
    expect(result.errors.form).toContain('at least one material line');
  });

  it('requires a description, unit note, and positive requested quantity on every line', () => {
    const result = validate(transfer({
      lines: [line({
        materialDescription: ' ',
        unitNote: '',
        quantityRequested: '0',
      })],
    }));

    expect(result.values).toBeNull();
    expect(result.errors.lines?.[1]?.materialDescription).toBeTruthy();
    expect(result.errors.lines?.[1]?.unitNote).toBeTruthy();
    expect(result.errors.lines?.[1]?.quantityRequested).toBeTruthy();
  });

  it.each(['0', '-1', 'Infinity', '1e6', '12x', '9'.repeat(400)])(
    'rejects invalid requested quantities: %s',
    (quantityRequested) => {
      const result = validate(transfer({ lines: [line({ quantityRequested })] }));

      expect(result.values).toBeNull();
      expect(result.errors.lines?.[1]?.quantityRequested).toContain('greater than zero');
    },
  );

  it('requires at least one positive dispatch observation at the dispatch stage', () => {
    const noDispatch = validate(transfer(), 'dispatch_noted');
    expect(noDispatch.values).toBeNull();
    expect(noDispatch.errors.form).toContain('at least one positive dispatch quantity note');

    const zeroDispatch = validate(transfer({
      lines: [line({ quantityDispatched: '0' })],
    }), 'dispatch_noted');
    expect(zeroDispatch.values).toBeNull();
    expect(zeroDispatch.errors.lines?.[1]?.quantityDispatched).toContain('greater than zero');
  });

  it('rejects dispatch quantities above the requested amount using exact decimal comparison', () => {
    const result = validate(transfer({
      lines: [line({ quantityRequested: '0.3', quantityDispatched: '0.3000000000000000001' })],
    }), 'dispatch_noted');

    expect(result.values).toBeNull();
    expect(result.errors.lines?.[1]?.quantityDispatched).toContain('cannot exceed the requested quantity');
  });

  it('accepts mathematically equal decimal quantities without a floating-point false positive', () => {
    const result = validate(transfer({
      lines: [line({ quantityRequested: '0.3', quantityDispatched: '0.3000' })],
    }), 'dispatch_noted');

    expect(result.errors).toEqual({});
    expect(result.values?.lines[0].quantityDispatched).toBe('0.3000');
  });

  it('compares receipt observations exactly and rejects excessively long quantity notes safely', () => {
    expect(compareMaterialTransferQuantityNotes('0.3', '0.3000000000000000001')).toBe(-1);
    expect(compareMaterialTransferQuantityNotes('0.300', '0.3')).toBe(0);
    expect(compareMaterialTransferQuantityNotes('not a number', '1')).toBeNull();

    const veryLongFraction = `0.${'0'.repeat(300)}1`;
    const result = validate(transfer({ lines: [line({ quantityRequested: veryLongFraction })] }));
    expect(result.values).toBeNull();
    expect(result.errors.lines?.[1]?.quantityRequested).toContain('greater than zero');
  });

  it('does not allow a receipt quantity without a dispatch note', () => {
    const result = validate(transfer({
      lines: [line({ quantityReceived: '0' })],
    }));

    expect(result.values).toBeNull();
    expect(result.errors.lines?.[1]?.quantityReceived).toContain('dispatch quantity note');
  });

  it.each(['-1', 'Infinity', '1e3', '1'.repeat(400)])(
    'rejects invalid received quantities: %s',
    (quantityReceived) => {
      const result = validate(transfer({
        lines: [line({ quantityDispatched: '5', quantityReceived })],
      }), 'dispatch_noted');

      expect(result.values).toBeNull();
      expect(result.errors.lines?.[1]?.quantityReceived).toContain('valid non-negative decimal');
    },
  );

  it('rejects receipts above dispatch and requires observations for every dispatched line', () => {
    const exceeds = validate(transfer({
      lines: [line({ quantityDispatched: '4', quantityReceived: '4.01' })],
    }), 'receipt_noted');
    expect(exceeds.values).toBeNull();
    expect(exceeds.errors.lines?.[1]?.quantityReceived).toContain('cannot exceed the dispatch quantity');

    const incomplete = validate(transfer({
      lines: [line({ quantityDispatched: '4', quantityReceived: '' })],
    }), 'receipt_noted');
    expect(incomplete.values).toBeNull();
    expect(incomplete.errors.lines?.[1]?.quantityReceived).toContain('for each dispatched line');
  });

  it('accepts a zero received quantity as an explicit observation and does not infer an adjustment', () => {
    const result = validate(transfer({
      lines: [line({ quantityDispatched: '4', quantityReceived: '0' })],
      receiptDate: '2026-10-15',
    }), 'receipt_noted');

    expect(result.errors).toEqual({});
    expect(result.values?.lines[0].quantityReceived).toBe('0');
    expect(result.values).not.toHaveProperty('shortageAdjustment');
  });

  it('validates optional note dates as real calendar dates', () => {
    const result = validate(transfer({ transferDate: '2026-02-29' }));

    expect(result.values).toBeNull();
    expect(result.errors.transferDate).toBe('Enter a valid transfer date.');
  });

  it('trims free-text notes while leaving the input object unchanged', () => {
    const fields = transfer({
      transferReferenceNote: '  TR-01  ',
      sourceStoreNote: '  Store  ',
      destinationSiteNote: '  Site  ',
      lines: [line({
        materialDescription: '  Cement  ',
        itemCodeNote: '  CEM  ',
        unitNote: '  bag  ',
        exceptionNote: '  Torn bag  ',
      })],
    });
    const original = structuredClone(fields);
    const result = validate(fields);

    expect(result.errors).toEqual({});
    expect(result.values?.transferReferenceNote).toBe('TR-01');
    expect(result.values?.sourceStoreNote).toBe('Store');
    expect(result.values?.destinationSiteNote).toBe('Site');
    expect(result.values?.lines[0]).toMatchObject({
      materialDescription: 'Cement',
      itemCodeNote: 'CEM',
      unitNote: 'bag',
      exceptionNote: 'Torn bag',
    });
    expect(fields).toEqual(original);
  });
});
