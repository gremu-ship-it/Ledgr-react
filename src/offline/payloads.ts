import type { InsertDto } from '@/dal/types/database';
import type { QueueOperationType } from './db';

/**
 * Exact payload shapes for each queueable operation, built directly from
 * the verified `InsertDto<'table'>` types in the DAL. No invented fields —
 * each shape mirrors what the corresponding repository method actually
 * accepts.
 */

export interface IncomeQueuePayload {
  invoice: InsertDto<'invoices'>;
  lines: Omit<InsertDto<'invoice_lines'>, 'invoice_id' | 'business_id'>[];
}

export interface InvoiceQueuePayload {
  invoice: InsertDto<'invoices'>;
  lines: Omit<InsertDto<'invoice_lines'>, 'invoice_id' | 'business_id'>[];
}

export interface ExpenseQueuePayload {
  expense: InsertDto<'expenses'>;
  lines: Omit<InsertDto<'expense_lines'>, 'expense_id' | 'business_id'>[];
}

export interface InvoicePaymentQueuePayload {
  payment: InsertDto<'invoice_payments'>;
}

export interface ExpensePaymentQueuePayload {
  payment: InsertDto<'expense_payments'>;
}

export interface PayrollRunQueuePayload {
  run: InsertDto<'payroll_runs'>;
  lines: Omit<InsertDto<'payroll_employee_lines'>, 'payroll_run_id' >[];
}

export interface StockMovementQueuePayload {
  movement: InsertDto<'stock_movements'>;
}

/**
 * A complete POS till sale, queued when the till has no connection.
 *
 * Unlike the other types this is not a single repository call: a POS sale is
 * an invoice, its lines, one or more payment rows, stock movements with their
 * COGS entry, and a shift-totals delta. All of it is captured here at the
 * moment the receipt is handed to the customer, so the queued item is a
 * faithful record of the sale rather than a summary of it.
 *
 * Server-side ids are deliberately absent: the invoice is written with an
 * 'POS-OFFLINE-…' placeholder number and the walk-in sentinel contact, both
 * of which the sync handler replaces with real values (see
 * `commitPosSaleDocuments` in services/posService).
 */
export interface PosSaleQueuePayload {
  /** Invoice header. `invoice_number`/`contact_id` may still be placeholders. */
  invoice: InsertDto<'invoices'>;
  /** Invoice lines; the parent id is attached once the invoice exists. */
  lines: Omit<InsertDto<'invoice_lines'>, 'invoice_id' | 'business_id'>[];
  /** One row per payment taken at the till (cash, Airtel Money, …). */
  payments: Omit<InsertDto<'invoice_payments'>, 'invoice_id' | 'business_id'>[];
  /**
   * Customer as typed/selected at the till. Needed only when the queued
   * `contact_id` is unusable (walk-in, or a contact created while offline) —
   * the sync handler then resolves or creates the real contact from this.
   */
  customer: {
    name: string;
    phone?: string | null;
    email?: string | null;
  };
  /** Open shift this sale belongs to, for the drawer totals delta. */
  shiftId: string | null;
  cashSales: number;
  otherSales: number;
  /** Human reference the cashier printed and the customer walked away with. */
  receiptNumber: string;
  cashierId: string | null;
  cashierName: string;
  isCreditSale: boolean;
  /** Sale net payable, for the audit entry only. */
  total: number;
  itemCount: number;
  notes?: string;
  /**
   * Supervisor override tokens (owner decision 2026-09-26, migration
   * 20261013000000). Sent only to `post_pos_sale`, which consumes them; never
   * written to invoice columns. An offline sale whose price/discount needed an
   * override and has none is refused on sync (22023) — by design.
   */
  overrides?: { discountToken: string | null; lineTokens: (string | null)[] };
}

/** Discriminated union mapping each operation type to its exact payload shape. */
export type QueuePayloadFor<T extends QueueOperationType> = T extends 'income'
  ? IncomeQueuePayload
  : T extends 'invoice'
    ? InvoiceQueuePayload
    : T extends 'expense'
      ? ExpenseQueuePayload
      : T extends 'invoice_payment'
        ? InvoicePaymentQueuePayload
        : T extends 'expense_payment'
          ? ExpensePaymentQueuePayload
          : T extends 'payroll_run'
            ? PayrollRunQueuePayload
            : T extends 'stock_movement'
              ? StockMovementQueuePayload
              : T extends 'pos_sale'
                ? PosSaleQueuePayload
                : never;