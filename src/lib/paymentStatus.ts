/**
 * Pure, dependency-free payment-status derivation shared by the invoice
 * repository and the journal reversal path, so the two can never drift.
 *
 * Extracted from InvoiceRepository.getPaymentStatus (2026-08-13) during the
 * payment-reversal remediation. Keeping it a leaf module means the reversal
 * logic is unit-testable without pulling in the Supabase client chain.
 */

export type InvoiceStatus = 'sent' | 'partially_paid' | 'paid';

/**
 * Derive an invoice's payment status from its total and paid amounts.
 *
 * - `amountPaid <= 0`          → `sent`           (nothing paid yet)
 * - `amountPaid >= totalAmount` → `paid`          (settled in full)
 * - otherwise                  → `partially_paid`
 *
 * `void` / `credit_note` are lifecycle states set by other flows and are
 * deliberately NOT returned here — this function only ever describes how far
 * a live (non-cancelled) document has been paid.
 */
export function paymentStatusFromAmounts(
  totalAmount: number,
  amountPaid: number,
): InvoiceStatus {
  if (amountPaid <= 0) return 'sent';
  return amountPaid >= totalAmount ? 'paid' : 'partially_paid';
}

/** Expense statuses a payment can move a bill into. */
export type ExpensePaymentStatus = 'approved' | 'paid';

/**
 * Derive an expense's status from its total and paid amounts after a payment.
 *
 * - any balance still owed → `approved`  (an outstanding, live payable)
 * - fully settled         → `paid`
 *
 * WHY NOT `partially_paid`
 * The invoice vocabulary suggests it, but `expenses_status_check` only allows
 * `draft | approved | paid | void` (verified against the live database), so
 * writing `partially_paid` raises a constraint violation and the payment path
 * would fail *after* the money had already moved. The expenses design already
 * tracks part settlement through `amount_paid` instead of status, and every
 * payables surface reads the balance from amounts — so a part-paid bill stays
 * `approved` with a visible remaining balance, which is exactly what the AP
 * summary needs.
 *
 * `draft` / `void` are lifecycle states owned by other flows and are never
 * returned here — a payment only ever describes how far a live bill is paid.
 */
export function expenseStatusFromAmounts(
  totalAmount: number,
  amountPaid: number,
): ExpensePaymentStatus {
  return amountPaid >= totalAmount - 0.005 ? 'paid' : 'approved';
}
