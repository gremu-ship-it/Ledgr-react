/**
 * seedChartOfAccounts.ts
 *
 * Two COA templates:
 *   - 'ifrs'  — IFRS layout
 *   - 'gaap'  — Malawi local GAAP / MRA-aligned (default)
 *
 * Numbering:
 *   1000s  Current Assets        1500s  Non-Current Assets
 *   2000s  Current Liabilities   2500s  Non-Current Liabilities
 *   3000s  Equity                4000s  Revenue / Income
 *   5000s  Cost of Sales         6000s  Operating Expenses
 *   7000s  Finance Costs & Tax
 *
 * Journal service hardcoded codes preserved exactly:
 *   1110  Cash on Hand           1131  Trade Debtors
 *   1135  VAT Receivable         2111  Trade Creditors
 *   2121  VAT Payable            2122  PAYE Payable
 *   2131  Salaries & Wages Payable
 *   4112  Service Revenue        6110  Basic Salaries
 *
 * Template switching: `switchCoaTemplate()` adds accounts exclusive to the
 * target template and deactivates (never deletes) accounts exclusive to the
 * template being left. Deactivation is safe for template-restricted rows
 * because none of them are `is_system: true` — see the `templates` field
 * on individual AccountSeed entries below.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/dal/types/database';

export type CoaTemplate = 'ifrs' | 'gaap';

export type AccountType =
  | 'asset' | 'liability' | 'equity'
  | 'income' | 'expense';

export type AccountSubtype =
  | 'current_asset' | 'non_current_asset' | 'fixed_asset'
  | 'current_liability' | 'non_current_liability'
  | 'share_capital' | 'retained_earnings' | 'reserves'
  | 'revenue' | 'other_income' | 'cost_of_sales'
  | 'operating_expense'
  | 'depreciation_amortisation' | 'finance_cost' | 'tax_expense'
  | null;

export type TaxCode =
  | 'vat_standard' | 'vat_zero' | 'vat_exempt'
  | 'paye' | 'wht_10' | 'wht_15' | 'wht_20'
  | 'cit' | 'fbt' | 'none';

export interface AccountSeed {
  code:            string;
  name:            string;
  description?:    string;
  account_type:    AccountType;
  account_subtype: AccountSubtype;
  normal_balance:  'debit' | 'credit';
  is_group:        boolean;
  is_system:       boolean;
  is_bank_account: boolean;
  tax_code?:       TaxCode;
  parent_code?:    string;
  templates?:      CoaTemplate[];
}

// ── Validation helpers (used by COA management UI) ────────────────────────────

export function isDebitNature(type: AccountType): boolean {
  return type === 'asset' || type === 'expense';
}

export function isPostable(account: { is_group: boolean }): boolean {
  return !account.is_group;
}

export function validateDebitCredit(
  accountType: AccountType,
  isDebit: boolean,
): { valid: boolean; warning: string | null } {
  const natural = isDebitNature(accountType);
  if (isDebit !== natural) {
    return {
      valid: true,
      warning: `Against natural balance for a ${accountType} account — confirm this is intentional.`,
    };
  }
  return { valid: true, warning: null };
}

// ── COA definition ────────────────────────────────────────────────────────────

const COA: AccountSeed[] = [

  // ══════════════════════════════════════════════════
  // 1000s  CURRENT ASSETS
  // ══════════════════════════════════════════════════
  { code:'1000', name:'Assets',         account_type:'asset', account_subtype:null,            normal_balance:'debit',  is_group:true,  is_system:true,  is_bank_account:false },
  { code:'1100', name:'Current Assets', account_type:'asset', account_subtype:'current_asset', normal_balance:'debit',  is_group:true,  is_system:true,  is_bank_account:false, parent_code:'1000' },

  // Cash & Bank
  { code:'1110', name:'Cash on Hand',                  account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:false, is_system:true,  is_bank_account:false, parent_code:'1100', description:'Physical cash at business premises' },
  { code:'1115', name:'Petty Cash',                    account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1100' },
  { code:'1120', name:'Bank Accounts',                 account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:true,  is_system:false, is_bank_account:false, parent_code:'1100' },
  { code:'1121', name:'National Bank — Current Account', account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:true, parent_code:'1120' },
  { code:'1122', name:'Standard Bank — Current Account', account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:true, parent_code:'1120' },
  { code:'1123', name:'FDH Bank — Current Account',    account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:true, parent_code:'1120' },
  { code:'1124', name:'NBS Bank — Current Account',    account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:true, parent_code:'1120' },

  // Mobile Money
  { code:'1125', name:'Mobile Money — Airtel Money',   account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1100', description:'Airtel Money float balance' },
  { code:'1126', name:'Mobile Money — TNM Mpamba',     account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1100', description:'TNM Mpamba float balance' },

  // Receivables
  { code:'1130', name:'Accounts Receivable',           account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:true,  is_system:false, is_bank_account:false, parent_code:'1100' },
  { code:'1131', name:'Trade Debtors',                 account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:false, is_system:true,  is_bank_account:false, parent_code:'1130', description:'Amounts owed by customers' },
  { code:'1132', name:'Other Debtors',                 account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1130' },
  { code:'1133', name:'Staff Advances & Loans',        account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1130' },
  { code:'1134', name:'Provision for Bad Debts',       account_type:'asset', account_subtype:'current_asset', normal_balance:'credit',is_group:false, is_system:false, is_bank_account:false, parent_code:'1130', description:'Contra-asset — allowance for doubtful debts' },

  // Tax Receivables
  { code:'1135', name:'VAT Receivable (Input Tax)',    account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:false, is_system:true,  is_bank_account:false, parent_code:'1100', description:'Input VAT claimable from MRA', tax_code:'vat_standard' },
  { code:'1136', name:'WHT Receivable',                account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1100', description:'Withholding tax certificates receivable — rate varies by transaction (10/15/20%)' },
  { code:'1137', name:'Income Tax Receivable',         account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1100', description:'Tax overpaid — refund due from MRA', tax_code:'cit' },

  // Inventory
  { code:'1140', name:'Inventory',                     account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:true,  is_system:false, is_bank_account:false, parent_code:'1100' },
  { code:'1141', name:'Trading Stock',                 account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1140', description:'Goods purchased for resale' },
  { code:'1142', name:'Finished Goods',                account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1140' },
  { code:'1143', name:'Raw Materials',                 account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1140', description:'Raw materials for manufacturing' },
  { code:'1144', name:'Work in Progress',              account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1140' },
  { code:'1145', name:'Agricultural Produce',          account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1140', description:'Maize, tobacco and other farm produce held for sale' },

  // Prepaid & Other
  { code:'1150', name:'Prepaid Expenses',              account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1100', description:'Expenses paid in advance' },
  { code:'1155', name:'Security Deposits',             account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1100' },
  { code:'1160', name:'Short-term Investments',        account_type:'asset', account_subtype:'current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1100' },

  // ══════════════════════════════════════════════════
  // 1500s  NON-CURRENT ASSETS
  // ══════════════════════════════════════════════════
  { code:'1500', name:'Non-Current Assets', account_type:'asset', account_subtype:'non_current_asset', normal_balance:'debit', is_group:true, is_system:false, is_bank_account:false, parent_code:'1000' },

  // PPE — fixed_asset subtype
  { code:'1510', name:'Property, Plant & Equipment',   account_type:'asset', account_subtype:'fixed_asset', normal_balance:'debit', is_group:true,  is_system:false, is_bank_account:false, parent_code:'1500' },
  { code:'1511', name:'Land',                          account_type:'asset', account_subtype:'fixed_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1510', description:'Land — not depreciated' },
  { code:'1512', name:'Buildings',                     account_type:'asset', account_subtype:'fixed_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1510' },
  { code:'1513', name:'Motor Vehicles',                account_type:'asset', account_subtype:'fixed_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1510' },
  { code:'1514', name:'Plant & Machinery',             account_type:'asset', account_subtype:'fixed_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1510' },
  { code:'1515', name:'Furniture & Fittings',          account_type:'asset', account_subtype:'fixed_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1510' },
  { code:'1516', name:'Computer Equipment',            account_type:'asset', account_subtype:'fixed_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1510' },
  { code:'1517', name:'Office Equipment',              account_type:'asset', account_subtype:'fixed_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1510' },

  // Accumulated Depreciation — fixed_asset subtype (contra)
  { code:'1520', name:'Accumulated Depreciation',      account_type:'asset', account_subtype:'fixed_asset', normal_balance:'credit',is_group:true,  is_system:false, is_bank_account:false, parent_code:'1500', description:'Contra-asset — total depreciation to date' },
  { code:'1521', name:'Accum. Depr. — Buildings',      account_type:'asset', account_subtype:'fixed_asset', normal_balance:'credit',is_group:false, is_system:false, is_bank_account:false, parent_code:'1520' },
  { code:'1522', name:'Accum. Depr. — Motor Vehicles', account_type:'asset', account_subtype:'fixed_asset', normal_balance:'credit',is_group:false, is_system:false, is_bank_account:false, parent_code:'1520' },
  { code:'1523', name:'Accum. Depr. — Plant & Machinery', account_type:'asset', account_subtype:'fixed_asset', normal_balance:'credit',is_group:false, is_system:false, is_bank_account:false, parent_code:'1520' },
  { code:'1524', name:'Accum. Depr. — Furniture & Fittings', account_type:'asset', account_subtype:'fixed_asset', normal_balance:'credit',is_group:false, is_system:false, is_bank_account:false, parent_code:'1520' },
  { code:'1525', name:'Accum. Depr. — Computer Equipment', account_type:'asset', account_subtype:'fixed_asset', normal_balance:'credit',is_group:false, is_system:false, is_bank_account:false, parent_code:'1520' },

  // Intangibles — stays non_current_asset
  { code:'1530', name:'Intangible Assets',             account_type:'asset', account_subtype:'non_current_asset', normal_balance:'debit', is_group:true,  is_system:false, is_bank_account:false, parent_code:'1500' },
  { code:'1531', name:'Goodwill',                      account_type:'asset', account_subtype:'non_current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1530' },
  { code:'1532', name:'Software & Licences',           account_type:'asset', account_subtype:'non_current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1530' },
  { code:'1533', name:'Accum. Amortisation — Intangibles', account_type:'asset', account_subtype:'non_current_asset', normal_balance:'credit',is_group:false, is_system:false, is_bank_account:false, parent_code:'1530' },
  { code:'1540', name:'Long-term Investments',         account_type:'asset', account_subtype:'non_current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1500' },
  { code:'1545', name:'Right-of-Use Assets',           account_type:'asset', account_subtype:'fixed_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1500', description:'IFRS 16 right-of-use assets', templates:['ifrs'] },
  { code:'1546', name:'Accum. Depr. — Right-of-Use',  account_type:'asset', account_subtype:'fixed_asset', normal_balance:'credit',is_group:false, is_system:false, is_bank_account:false, parent_code:'1520', templates:['ifrs'] },
  { code:'1550', name:'Deferred Tax Asset',            account_type:'asset', account_subtype:'non_current_asset', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'1500' },

  // ══════════════════════════════════════════════════
  // 2000s  CURRENT LIABILITIES
  // ══════════════════════════════════════════════════
  { code:'2000', name:'Liabilities',          account_type:'liability', account_subtype:null,                   normal_balance:'credit', is_group:true, is_system:true,  is_bank_account:false },
  { code:'2100', name:'Current Liabilities',  account_type:'liability', account_subtype:'current_liability',    normal_balance:'credit', is_group:true, is_system:true,  is_bank_account:false, parent_code:'2000' },

  // Accounts Payable
  { code:'2110', name:'Accounts Payable',              account_type:'liability', account_subtype:'current_liability', normal_balance:'credit', is_group:true,  is_system:false, is_bank_account:false, parent_code:'2100' },
  { code:'2111', name:'Trade Creditors',               account_type:'liability', account_subtype:'current_liability', normal_balance:'credit', is_group:false, is_system:true,  is_bank_account:false, parent_code:'2110', description:'Amounts owed to suppliers' },
  { code:'2112', name:'Accrued Liabilities',           account_type:'liability', account_subtype:'current_liability', normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'2110', description:'Expenses incurred but not yet invoiced' },
  { code:'2113', name:'Customer Deposits & Advances',  account_type:'liability', account_subtype:'current_liability', normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'2110' },

  // Tax Payables
  { code:'2120', name:'Tax Payables',                  account_type:'liability', account_subtype:'current_liability', normal_balance:'credit', is_group:true,  is_system:true,  is_bank_account:false, parent_code:'2100' },
  { code:'2121', name:'VAT Payable (Output Tax)',       account_type:'liability', account_subtype:'current_liability', normal_balance:'credit', is_group:false, is_system:true,  is_bank_account:false, parent_code:'2120', description:'Output VAT collected, payable to MRA', tax_code:'vat_standard' },
  { code:'2122', name:'PAYE Payable',                  account_type:'liability', account_subtype:'current_liability', normal_balance:'credit', is_group:false, is_system:true,  is_bank_account:false, parent_code:'2120', description:'PAYE deducted from employees, payable to MRA', tax_code:'paye' },
  { code:'2123', name:'WHT Payable',                   account_type:'liability', account_subtype:'current_liability', normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'2120', description:'Withholding tax deducted on payments — rate varies by transaction (10/15/20%)' },
  { code:'2124', name:'Income Tax Payable',            account_type:'liability', account_subtype:'current_liability', normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'2120', tax_code:'cit' },
  { code:'2125', name:'VAT Clearing',                  account_type:'liability', account_subtype:'current_liability', normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'2120', description:'Net VAT position before MRA filing', tax_code:'vat_standard' },

  // Payroll Payables
  { code:'2130', name:'Payroll Payables',              account_type:'liability', account_subtype:'current_liability', normal_balance:'credit', is_group:true,  is_system:false, is_bank_account:false, parent_code:'2100' },
  { code:'2131', name:'Salaries & Wages Payable',      account_type:'liability', account_subtype:'current_liability', normal_balance:'credit', is_group:false, is_system:true,  is_bank_account:false, parent_code:'2130', description:'Net salaries owed to employees' },
  { code:'2132', name:'Pension Payable',               account_type:'liability', account_subtype:'current_liability', normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'2130' },
  { code:'2140', name:'Short-term Loans',              account_type:'liability', account_subtype:'current_liability', normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'2100', description:'Bank overdrafts and loans due within 12 months' },
  { code:'2145', name:'Lease Liabilities — Current',   account_type:'liability', account_subtype:'current_liability', normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'2100', templates:['ifrs'] },
  { code:'2150', name:'Dividends Payable',             account_type:'liability', account_subtype:'current_liability', normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'2100' },

  // ══════════════════════════════════════════════════
  // 2500s  NON-CURRENT LIABILITIES
  // ══════════════════════════════════════════════════
  { code:'2500', name:'Non-Current Liabilities',       account_type:'liability', account_subtype:'non_current_liability', normal_balance:'credit', is_group:true,  is_system:false, is_bank_account:false, parent_code:'2000' },
  { code:'2510', name:'Long-term Debt',                account_type:'liability', account_subtype:'non_current_liability', normal_balance:'credit', is_group:true,  is_system:false, is_bank_account:false, parent_code:'2500' },
  { code:'2511', name:'Bank Loans — Long-term',        account_type:'liability', account_subtype:'non_current_liability', normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'2510' },
  { code:'2512', name:'Hire Purchase Payable',         account_type:'liability', account_subtype:'non_current_liability', normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'2510' },
  { code:'2515', name:'Lease Liabilities — Long-term', account_type:'liability', account_subtype:'non_current_liability', normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'2500', templates:['ifrs'] },
  { code:'2520', name:'Deferred Tax Liability',        account_type:'liability', account_subtype:'non_current_liability', normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'2500' },
  { code:'2530', name:'Retirement Benefit Obligation', account_type:'liability', account_subtype:'non_current_liability', normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'2500' },

  // ══════════════════════════════════════════════════
  // 3000s  EQUITY
  // ══════════════════════════════════════════════════
  { code:'3000', name:'Equity',                        account_type:'equity', account_subtype:null,               normal_balance:'credit', is_group:true,  is_system:true,  is_bank_account:false },
  { code:'3100', name:'Share Capital',                 account_type:'equity', account_subtype:'share_capital',    normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'3000' },
  { code:'3105', name:'Share Premium',                 account_type:'equity', account_subtype:'share_capital',    normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'3000', templates:['ifrs'] },
  { code:'3110', name:"Owner's Capital",               account_type:'equity', account_subtype:'share_capital',    normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'3000', description:'Capital contributed by owner (sole trader / partnership)' },
  { code:'3120', name:'Retained Earnings',             account_type:'equity', account_subtype:'retained_earnings', normal_balance:'credit', is_group:false, is_system:true,  is_bank_account:false, parent_code:'3000', description:'Accumulated profits retained in the business' },
  { code:'3130', name:'Current Year Profit / Loss',    account_type:'equity', account_subtype:'retained_earnings', normal_balance:'credit', is_group:false, is_system:true,  is_bank_account:false, parent_code:'3000', description:'Net profit or loss for the current financial year' },
  { code:'3140', name:'Drawings / Dividends Paid',     account_type:'equity', account_subtype:'retained_earnings', normal_balance:'debit',  is_group:false, is_system:false, is_bank_account:false, parent_code:'3000' },
  { code:'3150', name:'Revaluation Reserve',           account_type:'equity', account_subtype:'reserves',         normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'3000' },

  // ══════════════════════════════════════════════════
  // 4000s  REVENUE / INCOME
  // ══════════════════════════════════════════════════
  { code:'4000', name:'Income',                        account_type:'income', account_subtype:'revenue',      normal_balance:'credit', is_group:true,  is_system:true,  is_bank_account:false },
  { code:'4100', name:'Sales Revenue',                 account_type:'income', account_subtype:'revenue',      normal_balance:'credit', is_group:true,  is_system:false, is_bank_account:false, parent_code:'4000' },
  { code:'4110', name:'Sales — Goods',                 account_type:'income', account_subtype:'revenue',      normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'4100', description:'Revenue from sale of trading stock and finished goods' },
  { code:'4111', name:'Sales — Agricultural Produce',  account_type:'income', account_subtype:'revenue',      normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'4100', description:'Revenue from sale of maize, tobacco and other farm produce' },
  { code:'4112', name:'Service Revenue',               account_type:'income', account_subtype:'revenue',      normal_balance:'credit', is_group:false, is_system:true,  is_bank_account:false, parent_code:'4100', description:'Revenue from professional and consulting services' },
  { code:'4113', name:'Manufacturing Revenue',         account_type:'income', account_subtype:'revenue',      normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'4100' },
  { code:'4114', name:'Contract Revenue',              account_type:'income', account_subtype:'revenue',      normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'4100' },
  { code:'4120', name:'Sales Returns & Allowances',    account_type:'income', account_subtype:'revenue',      normal_balance:'debit',  is_group:false, is_system:false, is_bank_account:false, parent_code:'4100', description:'Contra-revenue — goods returned by customers' },
  { code:'4130', name:'Sales Discounts',               account_type:'income', account_subtype:'revenue',      normal_balance:'debit',  is_group:false, is_system:false, is_bank_account:false, parent_code:'4100' },
  { code:'4200', name:'Other Income',                  account_type:'income', account_subtype:'other_income', normal_balance:'credit', is_group:true,  is_system:false, is_bank_account:false, parent_code:'4000' },
  { code:'4210', name:'Interest Income',               account_type:'income', account_subtype:'other_income', normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'4200' },
  { code:'4220', name:'Rental Income',                 account_type:'income', account_subtype:'other_income', normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'4200' },
  { code:'4230', name:'FX Gains',                      account_type:'income', account_subtype:'other_income', normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'4200', description:'Foreign exchange gains on currency transactions' },
  { code:'4240', name:'Gain on Disposal of Assets',    account_type:'income', account_subtype:'other_income', normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'4200' },
  { code:'4250', name:'Miscellaneous Income',          account_type:'income', account_subtype:'other_income', normal_balance:'credit', is_group:false, is_system:false, is_bank_account:false, parent_code:'4200' },

  // ══════════════════════════════════════════════════
  // 5000s  COST OF SALES
  // ══════════════════════════════════════════════════
  { code:'5000', name:'Cost of Sales',                 account_type:'expense', account_subtype:'cost_of_sales', normal_balance:'debit', is_group:true,  is_system:true,  is_bank_account:false },
  { code:'5100', name:'Cost of Goods Sold',            account_type:'expense', account_subtype:'cost_of_sales', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'5000', description:'Cost of trading stock sold' },
  { code:'5110', name:'Cost of Agricultural Produce',  account_type:'expense', account_subtype:'cost_of_sales', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'5000' },
  { code:'5120', name:'Direct Materials',              account_type:'expense', account_subtype:'cost_of_sales', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'5000', description:'Raw materials consumed in production' },
  { code:'5130', name:'Direct Labour',                 account_type:'expense', account_subtype:'cost_of_sales', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'5000' },
  { code:'5140', name:'Manufacturing Overhead',        account_type:'expense', account_subtype:'cost_of_sales', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'5000' },
  { code:'5150', name:'Direct Service Costs',          account_type:'expense', account_subtype:'cost_of_sales', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'5000', description:'Subcontractors and direct costs of delivering services' },
  { code:'5160', name:'Freight & Delivery Inwards',    account_type:'expense', account_subtype:'cost_of_sales', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'5000' },
  { code:'5170', name:'Purchase Returns & Allowances', account_type:'expense', account_subtype:'cost_of_sales', normal_balance:'credit',is_group:false, is_system:false, is_bank_account:false, parent_code:'5000' },

  // ══════════════════════════════════════════════════
  // 6000s  OPERATING EXPENSES
  // ══════════════════════════════════════════════════
  { code:'6000', name:'Operating Expenses',            account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:true, is_system:true, is_bank_account:false },

  // Payroll (6110 = journal service hardcode)
  { code:'6100', name:'Payroll & Staff Costs',         account_type:'expense', account_subtype:'operating_expense',   normal_balance:'debit', is_group:true,  is_system:false, is_bank_account:false, parent_code:'6000' },
  { code:'6110', name:'Basic Salaries',                account_type:'expense', account_subtype:'operating_expense',   normal_balance:'debit', is_group:false, is_system:true,  is_bank_account:false, parent_code:'6100', description:'Gross salaries and wages — all staff' },
  { code:'6111', name:'Overtime & Allowances',         account_type:'expense', account_subtype:'operating_expense',   normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6100' },
  { code:'6112', name:'Employer Pension Contributions',account_type:'expense', account_subtype:'operating_expense',   normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6100' },
  { code:'6113', name:'Staff Welfare & Benefits',      account_type:'expense', account_subtype:'operating_expense',   normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6100' },
  { code:'6114', name:'Casual Labour',                 account_type:'expense', account_subtype:'operating_expense',   normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6100' },
  { code:'6115', name:'Recruitment Costs',             account_type:'expense', account_subtype:'operating_expense',   normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6100' },
  { code:'6116', name:'Fringe Benefit Tax',            account_type:'expense', account_subtype:'operating_expense',   normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6100', description:'FBT on non-cash employee benefits', tax_code:'fbt' },

  // Rent & Utilities
  { code:'6200', name:'Rent & Utilities',              account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:true,  is_system:false, is_bank_account:false, parent_code:'6000' },
  { code:'6201', name:'Rent & Rates',                  account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6200' },
  { code:'6202', name:'Electricity & Water',           account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6200' },
  { code:'6203', name:'Telephone & Internet',          account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6200' },

  // General Admin
  { code:'6300', name:'General Administration',        account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:true,  is_system:false, is_bank_account:false, parent_code:'6000' },
  { code:'6301', name:'Office Supplies & Stationery',  account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6300' },
  { code:'6302', name:'Insurance',                     account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6300' },
  { code:'6303', name:'Security Services',             account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6300' },
  { code:'6304', name:'Licences & Permits',            account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6300' },
  { code:'6305', name:'Subscriptions & Memberships',   account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6300' },
  { code:'6306', name:'Printing & Photocopying',       account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6300' },

  // Motor Vehicle & Travel
  { code:'6400', name:'Motor Vehicle & Travel',        account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:true,  is_system:false, is_bank_account:false, parent_code:'6000' },
  { code:'6401', name:'Fuel & Oil',                    account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6400' },
  { code:'6402', name:'Vehicle Maintenance & Repairs', account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6400' },
  { code:'6403', name:'Travel & Accommodation',        account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6400' },
  { code:'6404', name:'Staff Transport',               account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6400' },

  // Marketing
  { code:'6500', name:'Marketing & Sales',             account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:true,  is_system:false, is_bank_account:false, parent_code:'6000' },
  { code:'6501', name:'Advertising & Promotions',      account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6500' },
  { code:'6502', name:'Sales Commissions',             account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6500' },
  { code:'6503', name:'Entertainment & Client Gifts',  account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6500' },
  { code:'6504', name:'Market Fees & Levies',          account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6500' },

  // Professional Fees
  { code:'6600', name:'Professional & Legal Fees',     account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:true,  is_system:false, is_bank_account:false, parent_code:'6000' },
  { code:'6601', name:'Accounting & Audit Fees',       account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6600' },
  { code:'6602', name:'Legal Fees',                    account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6600' },
  { code:'6603', name:'Consulting Fees',               account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6600' },

  // Repairs & Maintenance
  { code:'6700', name:'Repairs & Maintenance',         account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:true,  is_system:false, is_bank_account:false, parent_code:'6000' },
  { code:'6701', name:'Building Repairs',              account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6700' },
  { code:'6702', name:'Equipment Repairs',             account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6700' },
  { code:'6703', name:'IT & Software Maintenance',     account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6700' },

  // Depreciation
  { code:'6800', name:'Depreciation',                  account_type:'expense', account_subtype:'depreciation_amortisation',      normal_balance:'debit', is_group:true,  is_system:false, is_bank_account:false, parent_code:'6000' },
  { code:'6801', name:'Depreciation — Buildings',      account_type:'expense', account_subtype:'depreciation_amortisation',      normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6800' },
  { code:'6802', name:'Depreciation — Motor Vehicles', account_type:'expense', account_subtype:'depreciation_amortisation',      normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6800' },
  { code:'6803', name:'Depreciation — Plant & Machinery', account_type:'expense', account_subtype:'depreciation_amortisation',   normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6800' },
  { code:'6804', name:'Depreciation — Furniture & Fittings', account_type:'expense', account_subtype:'depreciation_amortisation',normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6800' },
  { code:'6805', name:'Depreciation — Computer Equipment', account_type:'expense', account_subtype:'depreciation_amortisation',  normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6800' },
  { code:'6806', name:'Amortisation — Intangibles',    account_type:'expense', account_subtype:'depreciation_amortisation',      normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6800' },

  // Misc
  { code:'6900', name:'Miscellaneous Expenses',        account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:true,  is_system:false, is_bank_account:false, parent_code:'6000' },
  { code:'6901', name:'Training & Development',        account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6900' },
  { code:'6902', name:'Bad Debts Written Off',         account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6900' },
  { code:'6903', name:'Donations & Charitable Contributions', account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6900' },
  { code:'6904', name:'Sundry Expenses',               account_type:'expense', account_subtype:'operating_expense', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'6900' },

  // ══════════════════════════════════════════════════
  // 7000s  FINANCE COSTS & TAX
  // ══════════════════════════════════════════════════
  { code:'7000', name:'Finance Costs',                 account_type:'expense', account_subtype:'finance_cost', normal_balance:'debit', is_group:true,  is_system:false, is_bank_account:false },
  { code:'7100', name:'Interest Expense',              account_type:'expense', account_subtype:'finance_cost', normal_balance:'debit', is_group:true,  is_system:false, is_bank_account:false, parent_code:'7000' },
  { code:'7101', name:'Interest on Loans',             account_type:'expense', account_subtype:'finance_cost', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'7100' },
  { code:'7102', name:'Bank Overdraft Interest',       account_type:'expense', account_subtype:'finance_cost', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'7100' },
  { code:'7103', name:'Hire Purchase Interest',        account_type:'expense', account_subtype:'finance_cost', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'7100' },
  { code:'7200', name:'Bank Charges',                  account_type:'expense', account_subtype:'finance_cost', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'7000' },
  { code:'7300', name:'FX Losses',                     account_type:'expense', account_subtype:'finance_cost', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'7000', description:'Foreign exchange losses on currency transactions' },
  { code:'7400', name:'Loss on Disposal of Assets',    account_type:'expense', account_subtype:'finance_cost', normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'7000' },
  { code:'7500', name:'Income Tax Expense',            account_type:'expense', account_subtype:'tax_expense',  normal_balance:'debit', is_group:false, is_system:false, is_bank_account:false, parent_code:'7000', description:'Corporate income tax charge for the period', tax_code:'cit' },
];

// ── Template helper ───────────────────────────────────────────────────────────

export function getCoaTemplate(template: CoaTemplate): AccountSeed[] {
  return COA.filter((a) => !a.templates || a.templates.includes(template));
}

// ── Seeder ────────────────────────────────────────────────────────────────────

export async function seedChartOfAccounts(
  supabase: SupabaseClient<Database>,
  businessId: string,
  template: CoaTemplate = 'gaap',
): Promise<{ inserted: number; skipped: number }> {

  const coa = getCoaTemplate(template);

  const { data: existingRaw, error: fetchErr } = await supabase
    .from('accounts').select('id, code').eq('business_id', businessId);
  if (fetchErr) throw new Error(`Fetch failed: ${fetchErr.message}`);

  const existing = existingRaw as { id: string; code: string }[] | null;
  const codeToId = new Map<string, string>(
    (existing ?? []).map((a) => [a.code, a.id]),
  );

  const toInsert = coa.filter((a) => !codeToId.has(a.code));
  if (toInsert.length === 0) return { inserted: 0, skipped: coa.length };

  let remaining = [...toInsert];
  let inserted  = 0;
  let attempts  = 0;

  while (remaining.length > 0 && attempts < 15) {
    attempts++;
    const batch: typeof remaining    = [];
    const deferred: typeof remaining = [];

    for (const acct of remaining) {
      if (acct.parent_code && !codeToId.has(acct.parent_code)) {
        deferred.push(acct);
      } else {
        batch.push(acct);
      }
    }

    if (batch.length === 0) break;

    const rows = batch.map((a) => ({
      business_id:     businessId,
      code:            a.code,
      name:            a.name,
      description:     a.description ?? null,
      account_type:    a.account_type,
      account_subtype: a.account_subtype ?? null,
      normal_balance:  a.normal_balance,
      is_group:        a.is_group,
      is_system:       a.is_system,
      is_bank_account: a.is_bank_account,
      tax_code:        a.tax_code ?? 'none',
      currency:        'MWK' as const,
      opening_balance: 0,
      is_active:       true,
      parent_id:       a.parent_code ? (codeToId.get(a.parent_code) ?? null) : null,
    }));

    const { data: createdRaw, error: insertErr } = await supabase
      .from('accounts').insert(rows as any).select('id, code');
    if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);

    const created = createdRaw as { id: string; code: string }[] | null;
    for (const row of created ?? []) codeToId.set(row.code, row.id);
    inserted  += (created ?? []).length;
    remaining  = deferred;
  }

  return { inserted, skipped: coa.length - inserted };
}

// ── Convenience wrapper ───────────────────────────────────────────────────────

export async function ensureChartOfAccounts(
  supabase: SupabaseClient<Database>,
  businessId: string,
  template: CoaTemplate = 'gaap',
): Promise<{ inserted: number; wasEmpty: boolean }> {
  const { count } = await supabase
    .from('accounts')
    .select('*', { count: 'exact', head: true })
    .eq('business_id', businessId);

  const wasEmpty = (count ?? 0) === 0;
  const { inserted } = await seedChartOfAccounts(supabase, businessId, template);

  if (wasEmpty) {
    await (supabase.from('businesses') as any)
      .update({ coa_template: template })
      .eq('id', businessId);
  }

  return { inserted, wasEmpty };
}

// ── Template switching ────────────────────────────────────────────────────────
//
// Adds accounts exclusive to `newTemplate` (via seedChartOfAccounts) and
// deactivates — never deletes — accounts exclusive to whichever template
// the business is leaving. Deactivation only touches rows where
// `templates` restricts them away from the new template; every such row
// in the COA above is `is_system: false`, so this never disables a
// hardcoded/system account relied on by journalService.ts.
//
// Existing transactions posted to a deactivated account are preserved;
// the account simply stops appearing as selectable in new entries.

export async function switchCoaTemplate(
  supabase: SupabaseClient<Database>,
  businessId: string,
  newTemplate: CoaTemplate,
): Promise<{ added: number; deactivated: number; previousTemplate: CoaTemplate }> {

  const { data: biz, error: bizErr } = await supabase
    .from('businesses')
    .select('coa_template')
    .eq('id', businessId)
    .single();
  if (bizErr) throw new Error(`Failed to read business template: ${bizErr.message}`);

  const previousTemplate = ((biz as any)?.coa_template ?? 'gaap') as CoaTemplate;
  if (previousTemplate === newTemplate) {
    return { added: 0, deactivated: 0, previousTemplate };
  }

  // Add whatever the new template needs that isn't there yet.
  const { inserted: added } = await seedChartOfAccounts(supabase, businessId, newTemplate);

  // Deactivate accounts exclusive to the template being left.
  const toDeactivate = COA.filter(
    (a) => a.templates
      && a.templates.includes(previousTemplate)
      && !a.templates.includes(newTemplate),
  );
  const codesToDeactivate = toDeactivate.map((a) => a.code);

  let deactivated = 0;
  if (codesToDeactivate.length > 0) {
    const { data, error } = await (supabase.from('accounts') as any)
      .update({ is_active: false })
      .eq('business_id', businessId)
      .in('code', codesToDeactivate)
      .select('id');
    if (error) throw new Error(`Failed to deactivate old-template accounts: ${error.message}`);
    deactivated = (data ?? []).length;
  }

  const { error: updateErr } = await (supabase.from('businesses') as any)
    .update({ coa_template: newTemplate })
    .eq('id', businessId);
  if (updateErr) throw new Error(`Failed to update business template: ${updateErr.message}`);

  return { added, deactivated, previousTemplate };
}