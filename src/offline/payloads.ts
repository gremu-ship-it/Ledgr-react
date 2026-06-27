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
              : never;