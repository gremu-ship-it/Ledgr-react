/**
 * Construction procurement — workspace view model.
 *
 * Pure helpers that turn server data into display state. Nothing here decides
 * what is ALLOWED: capabilities come from the server, receipt progress is derived
 * from server-held quantities, and every derived value is presentational.
 *
 * The progress vocabulary exists so the interface states the accounting boundary
 * unambiguously — a delivery note is evidence with no stock effect, a receipt
 * moves stock only when an approved policy allows it, and a stock movement is not
 * a journal entry.
 */

import type {
  ConstructionGoodsReceiptLine,
  ConstructionOpenItems,
  ConstructionReceiptCostBasis,
  ConstructionReceiptPostingPolicy,
} from '@/dal/repositories/ConstructionProcurementRepository';

/** Generates the client replay key used by every mutating command. */
/**
 * Mirrors `public._ledgr_construction_normalize_reference`:
 * `upper(regexp_replace(btrim(coalesce(p_text, '')), '\s+', ' ', 'g'))`.
 *
 * Used ONLY to point an operator at the registration that actually conflicts —
 * "INV 001/2026" and "  inv   001/2026 " are the same reference to the database.
 * The database recomputes and enforces this for every command, so this is a
 * presentation aid and never an authority. Note the deliberate non-normalisation:
 * punctuation is NOT stripped, so `INV001/2026` is a DIFFERENT reference from
 * `INV 001/2026` — matching the server, which proves exactly that case.
 */
export function normalizeReference(text: string | null | undefined): string {
  return (text ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

export function newIdempotencyKey(): string {
  const cryptoObj = typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') return cryptoObj.randomUUID();
  // RFC 4122 v4 fallback for environments without crypto.randomUUID.
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Base-unit quantity, trimmed of trailing zeros (quantities are not money). */
export function formatQuantity(value: number | string | null | undefined, unit?: string): string {
  const parsed = toNumber(value);
  const text = parsed.toLocaleString('en-US', { maximumFractionDigits: 6 });
  return unit ? `${text} ${unit}` : text;
}

export function formatMoney(value: number | string | null | undefined, currency: string | null | undefined): string {
  const parsed = toNumber(value);
  const code = (currency ?? '').trim().toUpperCase();
  const text = parsed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
  return code ? `${code} ${text}` : text;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  return value.slice(0, 10);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toISOString().slice(0, 16).replace('T', ' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// The accounting boundary, stated once and reused
// ─────────────────────────────────────────────────────────────────────────────

export const JOURNAL_BOUNDARY_NOTE =
  'Receipts and material issues never write a journal entry. General-ledger posting is not approved, and this workspace has no control that could post one.';

export const DELIVERY_NOTE_NOTE =
  'A delivery note is evidence only — it changes no stock quantity and no value. Stock is affected only by a goods receipt posted under an approved policy.';

// ─────────────────────────────────────────────────────────────────────────────
// Receipt line progress (derived strictly from server-held quantities)
// ─────────────────────────────────────────────────────────────────────────────

export type ReceiptLineStage =
  | 'not_accepted'
  | 'held'
  | 'awaiting_cost_basis'
  | 'ready_to_post'
  | 'posting_disabled'
  | 'partially_posted'
  | 'posted';

export interface ReceiptLineProgress {
  stage: ReceiptLineStage;
  label: string;
  detail: string;
  acceptedBase: number;
  coveredBase: number;
  postedBase: number;
  holdBase: number;
  /** True when the accepted quantity can still be posted. */
  canPost: boolean;
}

export function describeReceiptLineProgress(
  line: ConstructionGoodsReceiptLine,
  costBases: ConstructionReceiptCostBasis[],
  holds: Array<{ grn_line_id: string; hold_type: string; status: string; quantity_base: number | string }>,
  policy: ConstructionReceiptPostingPolicy | null,
): ReceiptLineProgress {
  const acceptedBase = toNumber(line.accepted_base);
  const postedBase = toNumber(line.quantity_posted_base);
  const coveredBase = costBases
    .filter((basis) => basis.grn_line_id === line.id)
    .reduce((total, basis) => total + toNumber(basis.quantity_base), 0);
  const holdBase = holds
    .filter((hold) => hold.grn_line_id === line.id && hold.status === 'open')
    .reduce((total, hold) => total + toNumber(hold.quantity_base), 0);
  const postingEnabled = policy?.movement_posting_enabled === true;

  const base = { acceptedBase, coveredBase, postedBase, holdBase, canPost: false } satisfies Omit<ReceiptLineProgress, 'stage' | 'label' | 'detail'>;

  if (acceptedBase === 0) {
    return {
      ...base,
      stage: 'not_accepted',
      label: 'Not in stock',
      detail: 'Nothing on this line was accepted, so no quantity can reach stock. Held quantities stay outside inventory.',
    };
  }
  if (postedBase >= acceptedBase) {
    return {
      ...base,
      stage: 'posted',
      label: 'Posted to stock',
      detail: 'The accepted quantity has been posted through the shared stock balance writer. No journal entry was created.',
    };
  }
  if (coveredBase < acceptedBase) {
    return {
      ...base,
      stage: 'awaiting_cost_basis',
      label: 'Awaiting an evidenced cost basis',
      detail: `Matched and evidenced cost covers ${formatQuantity(coveredBase)} of the accepted ${formatQuantity(acceptedBase)}. Posting is refused until every accepted unit has a cost basis.`,
    };
  }
  if (!postingEnabled) {
    return {
      ...base,
      stage: 'posting_disabled',
      label: 'Cost prepared — posting disabled',
      detail: 'The cost basis is complete, but this business has no approved receipt posting policy, so the stock movement is refused by the database.',
    };
  }
  if (postedBase > 0) {
    return {
      ...base,
      stage: 'partially_posted',
      label: 'Partly posted',
      detail: `${formatQuantity(postedBase)} of ${formatQuantity(acceptedBase)} has reached stock; posting again will post only the remaining quantity.`,
      canPost: true,
    };
  }
  return {
    ...base,
    stage: 'ready_to_post',
    label: 'Ready to post',
    detail: 'The cost basis is complete and the approved policy allows a stock movement. Posting writes one stock movement and no journal entry.',
    canPost: true,
  };
}

const STAGE_STYLES: Record<ReceiptLineStage, string> = {
  not_accepted: 'bg-slate-100 text-slate-700',
  held: 'bg-amber-50 text-amber-800',
  awaiting_cost_basis: 'bg-amber-50 text-amber-800',
  ready_to_post: 'bg-blue-50 text-blue-700',
  posting_disabled: 'bg-slate-100 text-slate-700',
  partially_posted: 'bg-blue-50 text-blue-700',
  posted: 'bg-emerald-50 text-emerald-700',
};

export function receiptStageClassName(stage: ReceiptLineStage): string {
  return STAGE_STYLES[stage];
}

/** True when the line still carries an open hold (a reason a quantity is not in stock). */
export function hasOpenHold(
  lineId: string,
  holds: Array<{ grn_line_id: string; status: string }>,
): boolean {
  return holds.some((hold) => hold.grn_line_id === lineId && hold.status === 'open');
}

// ─────────────────────────────────────────────────────────────────────────────
// Overview KPIs (from the server's own open-item report)
// ─────────────────────────────────────────────────────────────────────────────

export interface ConstructionOverviewNumbers {
  awaitingInspection: number;
  holdsOpen: number;
  heldQuantityBase: number;
  acceptedAwaitingCostBasisLines: number;
  acceptedAwaitingPostingLines: number;
  acceptedAwaitingPostingBase: number;
  outstandingClaimsBase: number;
  oldestHoldDays: number;
  blockedBills: number;
}

/**
 * Summarise the server's open-item report. Every figure is a sum of server-held
 * rows; no threshold, ageing bucket or priority is invented here.
 */
export function summariseOpenItems(items: ConstructionOpenItems | null | undefined): ConstructionOverviewNumbers {
  if (!items) {
    return {
      awaitingInspection: 0,
      holdsOpen: 0,
      heldQuantityBase: 0,
      acceptedAwaitingCostBasisLines: 0,
      acceptedAwaitingPostingLines: 0,
      acceptedAwaitingPostingBase: 0,
      outstandingClaimsBase: 0,
      oldestHoldDays: 0,
      blockedBills: 0,
    };
  }
  return {
    awaitingInspection: items.open_holds.length,
    holdsOpen: items.open_holds.length,
    heldQuantityBase: items.open_holds.reduce((total, hold) => total + toNumber(hold.quantity_base), 0),
    acceptedAwaitingCostBasisLines: items.awaiting_cost_basis.length,
    acceptedAwaitingPostingLines: items.awaiting_posting.length,
    acceptedAwaitingPostingBase: items.awaiting_posting.reduce((total, row) => total + toNumber(row.accepted_base), 0),
    outstandingClaimsBase: items.outstanding_supplier_claims.reduce((total, claim) => total + toNumber(claim.outstanding_base), 0),
    oldestHoldDays: items.open_holds.reduce((oldest, hold) => Math.max(oldest, toNumber(hold.age_days)), 0),
    blockedBills: items.blocked_bills.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Capability gating (display only — the server re-checks every command)
// ─────────────────────────────────────────────────────────────────────────────

export interface CapabilityGateState {
  allowed: boolean;
  /** Why the control is disabled. Never empty when `allowed` is false. */
  reason: string;
}

/**
 * Decide whether a control should be enabled for the signed-in person.
 * This is an affordance, not an authorisation: the database refuses the command
 * regardless of what this returns.
 */
export function gateForCapability(
  capabilities: readonly string[] | null | undefined,
  capability: string,
  label: string,
): CapabilityGateState {
  const allowed = Array.isArray(capabilities) && capabilities.includes(capability);
  return {
    allowed,
    reason: allowed ? '' : `Your account does not hold “${label}” for this business, so this action is disabled. An approver can grant it in the workspace setup screen.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Search / filtering
// ─────────────────────────────────────────────────────────────────────────────

export function matchesSearch(haystack: Array<string | null | undefined>, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return haystack.some((value) => (value ?? '').toLowerCase().includes(needle));
}

/** Sort helper: newest first for timestamps held as ISO strings. */
export function byNewest(a: string | null | undefined, b: string | null | undefined): number {
  return (b ?? '').localeCompare(a ?? '');
}
