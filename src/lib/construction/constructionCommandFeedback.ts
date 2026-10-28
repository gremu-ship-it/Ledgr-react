/**
 * Construction procurement — feedback layer.
 *
 * Pure presentation helpers that turn a database refusal into something a person
 * can act on. They are deliberately DUMB: each entry explains a refusal the
 * database already issues (the token list is exactly the set raised by
 * `20261021000000_construction_procurement_traceability.sql` and, for usable-material
 * returns, `20261026000000_construction_return_command.sql`). Nothing here
 * decides whether an operation is allowed, and nothing here restates a rule in a
 * way that could disagree with the server — if the server refuses and there is no
 * entry, the raw server message is shown verbatim.
 */

export interface ConstructionRefusalExplanation {
  /** Short, plain-language statement of what the server refused. */
  summary: string;
  /** What the person should do next, in their terms. */
  action: string;
}

/**
 * Documented refusals, by the token the server prefixes its message with.
 * `INS` groups refusals that exist to keep the interface honest rather than to
 * block a legitimate correction — the wording says so explicitly.
 */
export const CONSTRUCTION_REFUSAL_EXPLANATIONS: Record<string, ConstructionRefusalExplanation> = {
  // ── Authority ────────────────────────────────────────────────────────────
  'receipt-inspection-denied': {
    summary: 'Recording rejected, quarantined or disputed quantities needs the receipt-inspection capability.',
    action: 'Ask a colleague who holds “Inspect and classify receipts” to record this receipt, or to grant you the capability.',
  },
  'reclassification-exception-denied': {
    summary: 'Releasing quarantined or disputed material needs the exception authority as well as the inspection capability.',
    action: 'Ask an approver holding “Authorize exceptions and release holds” to release this quantity.',
  },
  'over-receipt-exception-denied': {
    summary: 'Receiving more than was ordered needs the exception authority.',
    action: 'Reduce the received quantity to the ordered quantity, or ask an approver to authorize the over-receipt.',
  },
  'over-receipt-exception-required': {
    summary: 'This receipt exceeds the ordered quantity.',
    action: 'Provide an authorized reason and evidence for the over-receipt, or reduce the received quantity.',
  },
  'quantity-exception-denied': {
    summary: 'Matching a bill quantity that differs from the received quantity needs the exception authority.',
    action: 'Match the exact quantity, or ask an approver to authorize the difference with a reason and evidence.',
  },
  'quantity-exception-required': {
    summary: 'The bill quantity differs from the receipt quantity.',
    action: 'Provide a written reason and an evidence reference to record this as an authorized exception.',
  },

  // ── Receipt classification and holds ─────────────────────────────────────
  'receipt-classification-incomplete': {
    summary: 'Received quantity must equal accepted + rejected + quarantined + disputed.',
    action: 'Account for every received unit before saving.',
  },
  'receipt-quantity-exceeded': {
    summary: 'The receipt quantity exceeds what is still outstanding on the purchase-order line.',
    action: 'Reduce the quantity, or record the extra quantity as an authorized over-receipt.',
  },
  'inspection-quantity-exceeded': {
    summary: 'The inspection covers more than was received on this line.',
    action: 'Reduce the inspected quantity to the received quantity.',
  },
  'release-quantity-exceeded': {
    summary: 'The released quantity is larger than the quarantined or disputed bucket holds.',
    action: 'Release no more than the bucket holds, or record the rest as a separate inspection outcome.',
  },
  'release-inspection-required': {
    summary: 'Releasing material into accepted stock requires an inspection of this receipt line.',
    action: 'Record the inspection first, then release the quantity.',
  },
  'release-inspection-failed': {
    summary: 'The cited inspection did not pass.',
    action: 'Only a passed inspection can release material into accepted stock.',
  },
  'release-inspection-short': {
    summary: 'The cited inspection covers less than the quantity being released.',
    action: 'Record an inspection that covers the full released quantity, or release less.',
  },
  'rejected-release-unsupported': {
    summary: 'Rejected material never entered stock and belongs to the supplier — it cannot be released into inventory.',
    action: 'Settle rejected material with the supplier; it is listed on the workspace overview as an outstanding claim.',
  },
  'accepted-release-unsupported': {
    summary: 'Moving accepted stock back out would be a write-down, which needs an approved net realisable value basis.',
    action: 'No write-down policy is approved. Use the open-item report to track the affected material.',
  },

  // ── Invoice identity and matching ────────────────────────────────────────
  'supplier-reference-missing': {
    summary: 'This bill has no supplier invoice reference recorded.',
    action: 'Add the reference printed on the supplier’s own invoice to the bill (Expenses → the bill), then register it again.',
  },
  'supplier-invoice-reference-duplicate': {
    summary: 'That supplier reference is already registered against another bill for the same supplier.',
    action: 'Open the existing registration, or record an evidenced exception naming the conflicting bill.',
  },
  'supplier-reference-not-registered': {
    summary: 'The supplier invoice reference must be registered before its lines can be matched to a receipt.',
    action: 'Register the bill’s supplier reference first.',
  },
  'supplier-mismatch': {
    summary: 'The bill’s supplier is not the supplier on the purchase order.',
    action: 'Match against a receipt raised from that supplier’s purchase order.',
  },
  'product-mismatch': {
    summary: 'The bill line product is not the product on the receipt line.',
    action: 'Match lines for the exact same product — no substitution is inferred.',
  },
  'bill-uom-inconsistent': {
    summary: 'One bill line cannot be matched in two different units.',
    action: 'Use the same unit for every match on that bill line.',
  },
  'bill-quantity-exceeded': {
    summary: 'The match exceeds what is still unmatched on the bill line.',
    action: 'Reduce the matched quantity.',
  },
  'cost-basis-quantity-exceeded': {
    summary: 'The cost basis exceeds the quantity that was matched on this receipt line.',
    action: 'Match more of the bill line first, or reduce the claimed quantity.',
  },
  'cost-basis-unmatched': {
    summary: 'The cost basis must come from a bill line already matched to this receipt line.',
    action: 'Match the bill line to the receipt line first.',
  },
  'bill-already-inventoried': {
    summary: 'This bill already moved stock through the ordinary purchase path, so it cannot be matched to a receipt.',
    action: 'Receipts are the only construction stock path. Use a bill that was declared a construction procurement bill instead of the ordinary purchase hook.',
  },

  // ── Cost, tax and currency ───────────────────────────────────────────────
  'cost-basis-uom-unsupported': {
    summary: 'The bill must state its price in the product’s base unit.',
    action: 'Record the bill line in the base unit, or ask the supplier for a price per base unit — the price is never converted by assumption.',
  },
  'cost-basis-currency-unsupported': {
    summary: 'The bill is in a currency the business cannot value into its own.',
    action: 'Check the business base currency and the bill currency.',
  },
  'cost-basis-discount-invalid': {
    summary: 'The stated discount is not a purchase discount for this line.',
    action: 'Correct the discount on the bill line.',
  },
  'cost-basis-discount-inconsistent': {
    summary: 'The bill line states a discount amount and a percentage that disagree.',
    action: 'Correct one of the two so they agree.',
  },
  'cost-basis-tax-missing': {
    summary: 'A standard-rated bill line records no tax amount.',
    action: 'Record the tax actually charged on the bill line, then claim the cost basis.',
  },
  'cost-basis-tax-inconsistent': {
    summary: 'The bill line tax code says no tax is due but a tax amount is recorded.',
    action: 'Correct the tax code or the tax amount on the bill line.',
  },
  'cost-basis-tax-unsupported': {
    summary: 'That tax code is not a purchase tax and cannot form part of inventory cost.',
    action: 'Use the tax code actually printed on the supplier invoice for the goods.',
  },
  'cost-basis-quantity-invalid': {
    summary: 'The bill line has no positive purchase value.',
    action: 'Correct the quantity and unit price on the bill line.',
  },
  'cost-basis-unit-cost-invalid': {
    summary: 'The derived unit cost is not a positive amount.',
    action: 'Check the bill line quantity, price, discount and tax.',
  },
  'cost-basis-currency-unknown': {
    summary: 'The business has no functional currency recorded.',
    action: 'Set the business base currency in settings.',
  },
  'bill-currency-mismatch': {
    summary: 'The bill currency is not the purchase-order currency.',
    action: 'Match against a bill raised in the same currency as the purchase order.',
  },
  'bill-fx-inconsistent': {
    summary: 'The exchange rate recorded on the bill does not agree with the bill’s own date and amounts.',
    action: 'Correct the rate and rate date on the bill, or ask the supplier to reissue it.',
  },
  'receipt-cost-basis-incomplete': {
    summary: 'An accepted quantity on this receipt has no evidenced cost basis yet.',
    action: 'Match the supplier bill line and prepare its cost basis for every accepted quantity before posting.',
  },
  'receipt-posting-not-approved': {
    summary: 'Receipt stock movements have no approved accounting policy for this business.',
    action: 'An approver must record the receipt posting policy before any movement can be posted. The policy is disabled by default.',
  },
  'receipt-gl-posting-not-approved': {
    summary: 'Posting journal entries from a goods receipt is not approved.',
    action: 'None available — general-ledger posting is outside the approved accounting design.',
  },
  'issue-posting-not-approved': {
    summary: 'Material issues have no approved movement policy for this business.',
    action: 'An approver must record the receipt posting policy before material can be issued to a site.',
  },
  'issue-gl-posting-not-approved': {
    summary: 'Posting journal entries from a material issue is not approved.',
    action: 'None available — general-ledger posting is outside the approved accounting design.',
  },
  'issue-cost-unknown': {
    summary: 'The stock pool has no weighted-average cost for this product at this location.',
    action: 'Receive and post the material at an evidenced cost before issuing it.',
  },
  'insufficient-stock': {
    summary: 'There is not enough stock at the site store for this issue.',
    action: 'Reduce the quantity, or receive more material at that location first.',
  },

  // ── Usable-material returns (Phase 1 of the returns design) ───────────────
  'over-return': {
    summary: 'This return is more than the quantity still returnable on that issue.',
    action: 'Reduce the quantity to the remaining returnable amount, or return against the correct issue.',
  },
  'traceable-to-issue-required': {
    summary: 'A return must name the material issue it came from.',
    action: 'Choose the original issue from the list; material that was never issued cannot be returned.',
  },
  'return-date-before-issue': {
    summary: 'The return date is before the date the material was issued.',
    action: 'Use a return date on or after the issue date.',
  },
  'return-condition-invalid': {
    summary: 'The material condition is missing or is not a recognised value.',
    action: 'Record the material as usable, or usable with restriction.',
  },
  'return-posting-not-approved': {
    summary: 'Material returns have no approved movement policy for this business.',
    action: 'Record the receipt-posting policy first; that policy is what enables site-store movements.',
  },
  'return-gl-posting-not-approved': {
    summary: 'Posting journal entries from a material return is not approved.',
    action: 'None available — general-ledger posting is outside the approved accounting design.',
  },
  'derived-field-not-accepted': {
    summary: 'The request tried to choose a site, location, project, product or cost.',
    action: 'None available — those values are always taken from the original issue.',
  },
  'uom-mismatch': {
    summary: 'The return unit does not match the unit the material was issued in.',
    action: 'Express the return quantity in the issue\u2019s own unit of measure.',
  },
  'issue-quantity-unknown': {
    summary: 'The original issue has no usable recorded quantity.',
    action: 'Record a corrected issue through the material-issue command before returning material.',
  },

  // ── Document identity and integrity ──────────────────────────────────────
  'supplier-delivery-note-duplicate': {
    summary: 'That delivery-note reference is already recorded for this supplier.',
    action: 'Open the existing delivery note, or record an evidenced exception naming it.',
  },
  'construction-append-only': {
    summary: 'Construction procurement records are append-only.',
    action: 'Record a new document that references the existing one instead of editing history.',
  },
};

export interface ConstructionFailure {
  /** SQLSTATE reported by the database, when present. */
  sqlState: string | null;
  /** Machine-readable token the server prefixed the message with, when present. */
  token: string | null;
  /** The server's own message, unaltered. */
  message: string;
  /** Explanation drawn from the documented refusals, when the token is known. */
  explanation: ConstructionRefusalExplanation | null;
  /** True when the caller simply lacked authority for the action. */
  isAuthorityDenial: boolean;
}

const AUTHORITY_TOKENS = new Set([
  'receipt-inspection-denied',
  'reclassification-exception-denied',
  'over-receipt-exception-denied',
  'quantity-exception-denied',
]);

/**
 * Normalise anything thrown by the repository into a displayable failure.
 * The raw server message is always preserved: when a refusal is not in the
 * table above, the exact server wording is what the user sees.
 */
export function describeConstructionFailure(error: unknown): ConstructionFailure {
  const message =
    error instanceof Error && error.message
      ? error.message
      : typeof error === 'string'
        ? error
        : 'The operation could not be completed.';
  const sqlState =
    error && typeof error === 'object' && 'sqlState' in error
      ? ((error as { sqlState?: string | null }).sqlState ?? null)
      : null;
  const token =
    error && typeof error === 'object' && 'token' in error
      ? ((error as { token?: string | null }).token ?? null)
      : extractTokenFromMessage(message);
  return {
    sqlState,
    token,
    message,
    explanation: token ? CONSTRUCTION_REFUSAL_EXPLANATIONS[token] ?? null : null,
    isAuthorityDenial: token ? AUTHORITY_TOKENS.has(token) : sqlState === '42501',
  };
}

/**
 * Extract the leading `token:` or `token ` prefix that the construction commands
 * put in front of their messages. Exported so the UI can display a stable token
 * next to free-form server text.
 */
export function extractTokenFromMessage(message: string): string | null {
  // Server tokens contain '-' and never whitespace except after the colon.
  const match = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)+)(?::|\s|$)/.exec(message.trim());
  return match ? match[1] : null;
}
