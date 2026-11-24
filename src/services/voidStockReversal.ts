import { createLogger } from '@/lib/logger';
import { deriveClientKey } from '@/lib/clientKeys';
import { roundMoney } from './inventoryValuation';

const log = createLogger('voidStockReversal');

/**
 * Stock unwind for a voided document.
 *
 * Deliberately a LEAF module: it imports nothing from the journal repository or
 * the inventory journal service. `JournalRepository` calls it from `reverse()`,
 * and `JournalRepository` is imported eagerly by the repository registry — so
 * anything this module pulls in that transitively imports the registry creates
 * a cycle where `JournalRepository` is still `undefined` when the registry runs
 * its constructors ("JournalRepository is not a constructor"). Keeping the
 * logic here also means the reverse path stays testable without booting the
 * whole Supabase client chain.
 */

export interface StockReversalResult {
  /** Receipt movements that had to be given back. */
  movementsReversed: number;
  /** Net quantity given back (always positive). */
  quantityReversed: number;
  /** GL value given back, in the business's functional currency. */
  valueReversed: number;
  /** `true` when the movement rows were written; `false` when nothing was left to reverse. */
  recorded: boolean;
}

/**
 * Gives back the stock a document brought in, when that document is voided.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE BUG THIS FIXES
 * ─────────────────────────────────────────────────────────────────────────
 * Voiding an expense reverses its journal entry, which credits the inventory
 * account (DR Cash-Clearing / CR 1141) — but nothing ever removed the
 * `stock_movements` row the expense created on the way in. The ledger said
 * the stock was gone; `inventory_balances` still held it. From then on every
 * stock figure (and every COGS valuation computed from the weighted average)
 * was overstated by the voided purchase, and the warehouse reconciliation
 * panel had to be used to paper over it by hand.
 *
 * Production evidence: EXP-0478 brought in 1,100 bags at Head Office, was
 * voided the same week, and the receipt stayed behind — it had to be cleaned
 * up manually with an `adjustment_out` four days later.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT IT DOES
 * ─────────────────────────────────────────────────────────────────────────
 * Reads the `purchase` movements the document created (source_type
 * `expense`, source_id = the document id) and writes the mirror
 * `adjustment_out` movement for each, at the same location and unit cost, so
 * the subledger nets to zero. Writes are keyed by the source movement id, so
 * a retried void cannot give the stock back twice.
 *
 * Deliberately does NOT post a journal entry: the caller reverses the
 * document's own entry, and that reversal is what moves the inventory
 * account in the GL. Posting a second inventory movement here would double
 * count the correction.
 *
 * Best-effort by design. A void must never fail because stock could not be
 * unwound — the surrounding flow has already voided the document, and
 * throwing here would leave the caller reporting an error for work that
 * actually committed. Failures are logged and reported through the return
 * value so the caller can warn the user.
 *
 * @param reason Written to the movement notes so the audit trail says why.
 */
export async function reverseStockBroughtInByDocument(params: {
  businessId: string;
  /** The document's id (the value stored on `stock_movements.source_id`). */
  sourceId: string;
  /** `stock_movements.source_type` the document wrote. Defaults to 'expense'. */
  sourceType?: string;
  /** Date for the reversing movements. Defaults to today. */
  reversalDate?: string;
  /** Document number, carried onto the reversing movement for traceability. */
  reference?: string | null;
  reason: string;
  createdBy?: string | null;
}): Promise<StockReversalResult> {
  const {
    businessId,
    sourceId,
    sourceType = 'expense',
    reversalDate = new Date().toISOString().slice(0, 10),
    reference = null,
    reason,
    createdBy = null,
  } = params;

  const empty: StockReversalResult = {
    movementsReversed: 0,
    quantityReversed: 0,
    valueReversed: 0,
    recorded: false,
  };

  if (!businessId || !sourceId) return empty;

  try {
    // Resolved at call time, never at module load: `@/lib/repositories`
    // constructs every repository (including the journal one that calls this),
    // so a static import here would close a cycle and leave `JournalRepository`
    // undefined inside its own registry ("not a constructor").
    const { repos } = await import('@/lib/repositories');
    const received = await repos.inventory.findMovementsForSource(businessId, sourceType, sourceId);
    // Only stock a document BROUGHT IN can be given back. Sale/issue/transfer
    // movements move stock the other way and are not this function's job.
    const inbound = received.filter(
      (m) => m.movement_type === 'purchase' && Number(m.quantity) > 0,
    );
    if (inbound.length === 0) return empty;

    const movements = inbound.map((movement) => {
      const quantity = Number(movement.quantity);
      const unitCost = Number(movement.unit_cost ?? 0);
      // One reversing movement per receipt movement: retrying the void resolves
      // to the same key and is ignored rather than doubled. Computed here (not
      // inline) because `client_key` must be a bare uuid-returning expression —
      // a compound string in a uuid column fails the insert with 22P02.
      const reversalKey = deriveClientKey(`expense-void-stock-reversal:${movement.id}`, 0);
      return {
        business_id: businessId,
        product_id: movement.product_id,
        location_id: movement.location_id,
        movement_type: 'adjustment_out' as const,
        movement_date: reversalDate,
        // Stock leaves the location it arrived at — never the default branch
        // location, which may be a different branch entirely.
        quantity: -Math.abs(quantity),
        unit_cost: unitCost,
        source_type: sourceType,
        source_id: sourceId,
        reference,
        notes: `Reversal — ${reason}`.slice(0, 500),
        created_by: createdBy,
        client_key: reversalKey,
      };
    });

    const written = await repos.inventory.recordMovements(movements);
    // recordMovements drops rows that are already present (by client_key), so
    // an already-corrected document reports zero rather than double counting.
    const quantityReversed = written.reduce((sum, m) => sum + Math.abs(Number(m.quantity)), 0);
    const valueReversed = roundMoney(
      written.reduce((sum, m) => sum + Math.abs(Number(m.quantity)) * Number(m.unit_cost ?? 0), 0),
    );

    if (written.length > 0) {
      log.info('Reversed stock brought in by a voided document', {
        businessId,
        sourceType,
        sourceId,
        movementsReversed: written.length,
        quantityReversed,
        valueReversed,
        reason,
      });
    }

    return {
      movementsReversed: written.length,
      quantityReversed,
      valueReversed,
      recorded: written.length > 0,
    };
  } catch (err) {
    log.error(
      'Could not reverse the stock a voided document brought in. ' +
      'The document and its ledger entry are void; correct the stock with ' +
      'Warehouse → stock adjustment (adjustment_out) for the quantity below.',
      err as Error,
      { businessId, sourceType, sourceId, reason },
    );
    return empty;
  }
}

