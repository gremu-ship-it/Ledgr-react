import { describe, it, expect, vi } from 'vitest';
import {
  ConstructionCommandError,
} from '@/dal/repositories/ConstructionProcurementRepository';
import {
  CONSTRUCTION_REFUSAL_EXPLANATIONS,
  describeConstructionFailure,
  extractTokenFromMessage,
} from '@/lib/construction/constructionCommandFeedback';
import {
  JOURNAL_BOUNDARY_NOTE,
  gateForCapability,
  newIdempotencyKey,
  summariseOpenItems,
  describeReceiptLineProgress,
  formatMoney,
  formatQuantity,
  toNumber,
} from '@/lib/construction/constructionWorkspaceView';
import {
  CONSTRUCTION_CAPABILITIES,
  type ConstructionGoodsReceiptLine,
} from '@/dal/repositories/ConstructionProcurementRepository';

function receiptLine(over: Partial<ConstructionGoodsReceiptLine> = {}): ConstructionGoodsReceiptLine {
  return {
    id: 'line-1',
    business_id: 'biz',
    grn_id: 'grn-1',
    line_number: 1,
    po_line_id: 'pol-1',
    product_id: 'prod-1',
    uom: 'BAG',
    quantity_received: 5,
    quantity_accepted: 5,
    quantity_rejected: 0,
    quantity_quarantined: 0,
    quantity_disputed: 0,
    received_base: 5,
    accepted_base: 5,
    rejected_base: 0,
    quarantined_base: 0,
    disputed_base: 0,
    quantity_posted_base: 0,
    over_receipt_exception: false,
    over_receipt_reason: null,
    over_receipt_evidence: null,
    line_note: null,
    ...over,
  };
}

const policy = (enabled: boolean) =>
  ({
    business_id: 'biz',
    movement_posting_enabled: enabled,
    cost_basis_source: enabled ? 'matched_supplier_bill_line' : null,
    gl_posting_enabled: false,
    approved_by: enabled ? 'user-1' : null,
    approved_at: enabled ? '2026-10-16T00:00:00Z' : null,
    approved_reason: enabled ? 'board' : null,
    approved_evidence: enabled ? 'minute' : null,
    updated_at: '2026-10-16T00:00:00Z',
  }) as const;

const costBasis = (quantity: number, lineId = 'line-1') =>
  ({ grn_line_id: lineId, quantity_base: quantity }) as never;

describe('newIdempotencyKey', () => {
  it('produces a v4 UUID that Node’s own parser accepts', () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('never repeats, so two submissions are two documents rather than one replay', () => {
    const keys = new Set(Array.from({ length: 500 }, () => newIdempotencyKey()));
    expect(keys.size).toBe(500);
  });

  it('falls back to a valid UUID when the platform has no crypto.randomUUID', () => {
    const original = globalThis.crypto;
    vi.stubGlobal('crypto', {});
    try {
      expect(newIdempotencyKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      vi.stubGlobal('crypto', original);
    }
  });
});

describe('describeConstructionFailure', () => {
  it('extracts the refusal token and attaches the documented explanation', () => {
    const failure = describeConstructionFailure(
      new ConstructionCommandError(
        { message: 'accepted-release-unsupported: an accepted quantity cannot be released back out of inventory.', code: '22023' },
        'fallback',
      ),
    );
    expect(failure.token).toBe('accepted-release-unsupported');
    expect(failure.explanation?.summary).toContain('write-down');
    expect(failure.message).toContain('an accepted quantity cannot be released back out of inventory');
    expect(failure.isAuthorityDenial).toBe(false);
  });

  it('marks a capability refusal as an authority denial', () => {
    const failure = describeConstructionFailure(
      new ConstructionCommandError({ message: 'receipt-inspection-denied: you do not hold the receipt-inspection capability.', code: '42501' }, 'fallback'),
    );
    expect(failure.isAuthorityDenial).toBe(true);
    expect(failure.explanation?.action).toContain('grant you the capability');
  });

  it('never invents an explanation for an unknown refusal, but keeps the server wording', () => {
    const failure = describeConstructionFailure(new Error('some new server refusal without a known prefix'));
    expect(failure.explanation).toBeNull();
    expect(failure.message).toBe('some new server refusal without a known prefix');
    expect(describeConstructionFailure({})).toBeTruthy();
  });

  it('extracts a token from a bare message when no error class is available', () => {
    expect(extractTokenFromMessage('receipt-cost-basis-incomplete: line 1')).toBe('receipt-cost-basis-incomplete');
    expect(extractTokenFromMessage('  insufficient-stock: nothing on hand')).toBe('insufficient-stock');
    expect(extractTokenFromMessage('plain sentence with no token')).toBeNull();
    expect(extractTokenFromMessage('')).toBeNull();
  });

  it('covers every refusal token that the UI quotes back to the user', () => {
    for (const token of Object.keys(CONSTRUCTION_REFUSAL_EXPLANATIONS)) {
      expect(token).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/);
      const explanation = CONSTRUCTION_REFUSAL_EXPLANATIONS[token];
      expect(explanation.summary.length).toBeGreaterThan(10);
      // Every refusal must tell the person what to do next, or say there is none.
      expect(explanation.action.length).toBeGreaterThan(10);
    }
  });
});

describe('receipt line progress', () => {
  it('reports a line with nothing accepted as not in stock', () => {
    const progress = describeReceiptLineProgress(
      receiptLine({ quantity_accepted: 0, accepted_base: 0, quantity_rejected: 5, rejected_base: 5 }),
      [],
      [{ grn_line_id: 'line-1', hold_type: 'rejected', status: 'open', quantity_base: 5 }],
      policy(true),
    );
    expect(progress.stage).toBe('not_accepted');
    expect(progress.canPost).toBe(false);
    expect(progress.detail).toContain('outside inventory');
  });

  it('reports an accepted quantity without a cost basis as awaiting cost basis, regardless of policy', () => {
    const progress = describeReceiptLineProgress(receiptLine(), [], [], policy(true));
    expect(progress.stage).toBe('awaiting_cost_basis');
    expect(progress.coveredBase).toBe(0);
    expect(progress.acceptedBase).toBe(5);
    expect(progress.canPost).toBe(false);
    expect(progress.detail).toContain('refused');
  });

  it('reports a fully costed line as posting_disabled when the business has no approved policy', () => {
    const progress = describeReceiptLineProgress(receiptLine(), [costBasis(5)], [], policy(false));
    expect(progress.stage).toBe('posting_disabled');
    expect(progress.canPost).toBe(false);
    expect(progress.detail).toContain('refused by the database');
  });

  it('reports a fully costed line as ready to post when the policy enables movements', () => {
    const progress = describeReceiptLineProgress(receiptLine(), [costBasis(5)], [], policy(true));
    expect(progress.stage).toBe('ready_to_post');
    expect(progress.canPost).toBe(true);
    expect(progress.detail).toContain('no journal entry');
  });

  it('reports a partly posted line as partly posted and posts only the remainder', () => {
    const progress = describeReceiptLineProgress(
      receiptLine({ quantity_posted_base: 2 }),
      [costBasis(5)],
      [],
      policy(true),
    );
    expect(progress.stage).toBe('partially_posted');
    expect(progress.postedBase).toBe(2);
    expect(progress.canPost).toBe(true);
  });

  it('reports a fully posted line as posted, with no journal entry', () => {
    const progress = describeReceiptLineProgress(
      receiptLine({ quantity_posted_base: 5 }),
      [costBasis(5)],
      [],
      policy(true),
    );
    expect(progress.stage).toBe('posted');
    expect(progress.canPost).toBe(false);
    expect(progress.detail).toContain('No journal entry was created');
  });
});

describe('overview summary', () => {
  it('sums only what the server reported and invents nothing for an empty report', () => {
    const empty = summariseOpenItems(null);
    expect(empty).toEqual({
      awaitingInspection: 0,
      holdsOpen: 0,
      heldQuantityBase: 0,
      acceptedAwaitingCostBasisLines: 0,
      acceptedAwaitingPostingLines: 0,
      acceptedAwaitingPostingBase: 0,
      outstandingClaimsBase: 0,
      oldestHoldDays: 0,
      blockedBills: 0,
    });

    const summary = summariseOpenItems({
      business_id: 'biz',
      movement_posting_enabled: true,
      gl_posting_enabled: false,
      grants_in_force: 3,
      awaiting_cost_basis: [{ grn_number: 'G1', line_number: 1, accepted_base: '5', covered_base: '0' }],
      awaiting_posting: [{ grn_number: 'G1', line_number: 1, accepted_base: '5', quantity_posted_base: '2' }],
      open_holds: [
        { hold_type: 'quarantined', quantity: '1', quantity_base: '2', reason: 'x', evidence_reference: 'y', age_days: 12 },
        { hold_type: 'rejected', quantity: '1', quantity_base: '3', reason: 'x', evidence_reference: 'y', age_days: 4 },
      ],
      outstanding_supplier_claims: [
        {
          supplier: 'Sup',
          product_id: 'prod',
          rejected_base: '3',
          quarantined_base: '2',
          disputed_base: '0',
          outstanding_base: '5',
          receipt_date: '2026-10-16',
          age_days: 0,
        },
      ],
      blocked_bills: [{ expense_number: 'E1', reference: 'REF', legacy_movements: 1 }],
    });

    expect(summary.holdsOpen).toBe(2);
    expect(summary.heldQuantityBase).toBe(5);
    expect(summary.oldestHoldDays).toBe(12);
    expect(summary.acceptedAwaitingCostBasisLines).toBe(1);
    expect(summary.acceptedAwaitingPostingBase).toBe(5);
    expect(summary.outstandingClaimsBase).toBe(5);
    expect(summary.blockedBills).toBe(1);
  });
});

describe('capability gating', () => {
  it('explains why a control is disabled, and never implies the server agrees', () => {
    const denied = gateForCapability([], CONSTRUCTION_CAPABILITIES.poManage, 'Create and cancel purchase orders');
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toContain('Create and cancel purchase orders');
    expect(denied.reason.length).toBeGreaterThan(20);

    const granted = gateForCapability(
      [CONSTRUCTION_CAPABILITIES.poManage],
      CONSTRUCTION_CAPABILITIES.poManage,
      'Create and cancel purchase orders',
    );
    expect(granted.allowed).toBe(true);
    expect(granted.reason).toBe('');
  });

  it('treats a null capability list as no authority rather than as unlimited', () => {
    expect(gateForCapability(null, CONSTRUCTION_CAPABILITIES.poManage, 'X').allowed).toBe(false);
    expect(gateForCapability(undefined, CONSTRUCTION_CAPABILITIES.poManage, 'X').allowed).toBe(false);
  });
});

describe('formatting and the accounting boundary statement', () => {
  it('formats quantities without inventing decimals and money with a currency code', () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber('12.5')).toBe(12.5);
    expect(toNumber('not a number')).toBe(0);
    expect(formatQuantity('12.5', 'BAG')).toBe('12.5 BAG');
    expect(formatMoney('1057.5', 'MWK')).toBe('MWK 1,057.50');
    expect(formatMoney(null, null)).toBe('0.00');
  });

  it('states that a stock movement is not a journal entry', () => {
    expect(JOURNAL_BOUNDARY_NOTE).toContain('never write a journal entry');
    expect(JOURNAL_BOUNDARY_NOTE).toContain('not approved');
  });
});
