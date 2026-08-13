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
