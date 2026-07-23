/**
 * Hand-maintained convenience layer on top of the Supabase-generated schema.
 *
 * This file is NEVER touched by `supabase gen types` — only database.generated.ts
 * is. Regenerate that file as often as you like; nothing here will be wiped out.
 *
 * Contains:
 *  - Friendly type aliases for enum values (Currency, AccountType, TaxCode, etc.)
 *  - Row/InsertDto/UpdateDto/TableName helpers for the repository layer
 *
 * If you add a new enum column to the schema, add its alias here after
 * regenerating database.generated.ts — this file won't pick it up automatically.
 */
import type { Database } from './database.generated'

// ---------------------------------------------------------------------------
// Enum convenience aliases — exact members from live DB enum table
// ---------------------------------------------------------------------------
/**
 * DB: was currency_code enum, now text FK -> currencies.code (150+ values).
 * This alias covers only the 8 "primary" currencies pinned in the UI
 * (see currencies.is_primary) for convenience in code that only ever
 * deals with those. For anything accepting an arbitrary currency, use
 * a plain string validated against currencies.code instead.
 */
export type PrimaryCurrency = 'MWK' | 'ZMW' | 'TZS' | 'MZN' | 'USD' | 'EUR' | 'GBP' | 'ZAR';
/** @deprecated Use PrimaryCurrency or a plain string. Kept for existing call sites. */
export type Currency = PrimaryCurrency | 'KES' | 'UGX';
/** DB: account_type */
export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
/** DB: account_subtype — exact 15 members */
export type AccountSubtype =
  | 'current_asset'
  | 'non_current_asset'
  | 'fixed_asset'
  | 'current_liability'
  | 'non_current_liability'
  | 'share_capital'
  | 'retained_earnings'
  | 'reserves'
  | 'revenue'
  | 'other_income'
  | 'cost_of_sales'
  | 'operating_expense'
  | 'finance_cost'
  | 'tax_expense'
  | 'depreciation_amortisation';
/**
 * DB: tax_code — exact 10 members.
 * Use lowercase underscore values; uppercase aliases (VAT, WHT, etc.) do NOT exist in the DB.
 */
export type TaxCode =
  | 'vat_standard'   // Standard-rated VAT — 17.5% in Malawi
  | 'vat_zero'       // Zero-rated VAT — 0%
  | 'vat_exempt'     // VAT-exempt supply
  | 'paye'           // Pay As You Earn
  | 'tpr_pension'    // TPR Pension — 10% employer / 5% employee
  | 'wht_15'         // Withholding Tax 15%
  | 'wht_20'         // Withholding Tax 20%
  | 'wht_10'         // Withholding Tax 10%
  | 'cit'            // Corporate Income Tax
  | 'fbt'            // Fringe Benefits Tax
  | 'none';          // No tax / not applicable (schema DEFAULT)
/** DB: payment_method */
export type PaymentMethod =
  | 'cash'
  | 'bank_transfer'
  | 'cheque'
  | 'airtel_money'
  | 'tnm_mpamba'
  | 'card'
  | 'other';
/** DB: user_role — exact 6 members. */
export type BusinessUserRole = 'owner' | 'admin' | 'accountant' | 'payroll_manager' | 'supervisor' | 'data_entry' | 'inventory_manager' | 'sales_clerk' | 'auditor' | 'viewer';
/**
 * DB: invoice_status — exact 7 members.
 * 'partial' → 'partially_paid', 'viewed' does NOT exist, 'credit_note' is a status value.
 */
export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'partially_paid'
  | 'paid'
  | 'overdue'
  | 'void'
  | 'credit_note';
/** DB: depreciation_method — exact 4 members. */
export type DepreciationMethod =
  | 'straight_line'
  | 'reducing_balance'
  | 'units_of_production'
  | 'sum_of_years_digits';
/**
 * DB: asset_status — exact 5 members.
 * 'written_off' and 'under_maintenance' do NOT exist.
 * Correct values: 'fully_depreciated', 'impaired', 'under_construction'.
 */
export type AssetStatus =
  | 'active'
  | 'disposed'
  | 'fully_depreciated'
  | 'impaired'
  | 'under_construction';
/**
 * DB: stock_movement_type — exact 10 members.
 * 'adjustment' and 'transfer' do NOT exist.
 * Correct values use directional suffixes: _in / _out.
 */
export type StockMovementType =
  | 'purchase'
  | 'sale'
  | 'adjustment_in'
  | 'adjustment_out'
  | 'transfer_in'
  | 'transfer_out'
  | 'return_in'
  | 'return_out'
  | 'opening_balance'
  | 'write_off';
/**
 * DB: payroll_status — exact 4 members.
 * 'cancelled' does NOT exist; correct value is 'void'.
 */
export type PayrollRunStatus = 'draft' | 'approved' | 'paid' | 'void';
/** DB: journal_status */
export type JournalEntryStatus = 'draft' | 'posted' | 'reversed';
/**
 * DB: loans.status — text column, documented allowed values.
 * Mirrors the convention used by other status unions in this file.
 */
export type LoanStatus = 'active' | 'paid_off' | 'defaulted' | 'cancelled';
/** DB: share_transactions.transaction_type — text column. */
export type ShareTransactionType = 'issue' | 'buyback';

// ---------------------------------------------------------------------------
// Row / InsertDto / UpdateDto helpers
// ---------------------------------------------------------------------------
type PublicTables = Database['public']['Tables']
type PublicViews = Database['public']['Views']

/** Writable tables only — views have no Insert/Update. */
export type TableName = keyof PublicTables
/** Read-only views (v_ar_ageing, v_asset_register, v_reorder_alerts, v_trial_balance). */
export type ViewName = keyof PublicViews

/** Row works for both tables and views, since views are read-only but still queryable. */
export type Row<T extends TableName | ViewName> = T extends TableName
  ? PublicTables[T]['Row']
  : T extends ViewName
    ? PublicViews[T]['Row']
    : never

/** Insert/Update only make sense for tables — views can't be written to. */
export type InsertDto<T extends TableName> = PublicTables[T]['Insert']
export type UpdateDto<T extends TableName> = PublicTables[T]['Update']

// Re-export Database itself so existing `import { Database } from '.../database'`
// call sites keep working without changing their import path.
export type { Database } from './database.generated'