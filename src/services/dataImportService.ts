/**
 * dataImportService.ts
 * 
 * Comprehensive data import service for onboarding from external systems.
 * Supports CSV import for multiple entities with validation, mapping, and bulk insert.
 * 
 * Designed for new users migrating from QuickBooks, Xero, Sage, Excel, etc.
 */

import Papa from 'papaparse';
import { supabase } from '@/lib/supabase';

// ── Types ────────────────────────────────────────────────────────────────────

export type ImportEntityType = 
  | 'chart_of_accounts'
  | 'contacts'
  | 'products'
  | 'opening_balances'
  | 'trial_balance'
  | 'invoices'
  | 'bills'
  | 'fixed_assets'
  | 'inventory_opening'
  | 'bank_transactions'
  | 'employees';

export interface ImportTemplate {
  entityType: ImportEntityType;
  label: string;
  description: string;
  headers: string[];
  requiredHeaders: string[];
  exampleRows: Record<string, string>[];
  systemMappings?: Record<string, Record<string, string>>; // system -> { external header -> ledgr header }
}

export interface ParsedRow {
  rowNumber: number;
  data: Record<string, string>;
  errors: string[];
  warnings: string[];
  isValid: boolean;
}

export interface ImportPreview {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  headers: string[];
  rows: ParsedRow[];
  detectedSystem?: string;
}

export interface ImportResult {
  success: number;
  failed: number;
  errors: Array<{ row: number; message: string }>;
  insertedIds?: string[];
}

// ── Template Definitions ─────────────────────────────────────────────────────

export const IMPORT_TEMPLATES: Record<ImportEntityType, ImportTemplate> = {
  chart_of_accounts: {
    entityType: 'chart_of_accounts',
    label: 'Chart of Accounts',
    description: 'Import your account structure from another accounting system',
    headers: ['code', 'name', 'description', 'account_type', 'account_subtype', 'normal_balance', 'parent_code', 'opening_balance', 'currency'],
    requiredHeaders: ['code', 'name', 'account_type'],
    exampleRows: [
      { code: '1110', name: 'Cash on Hand', description: 'Physical cash', account_type: 'asset', account_subtype: 'current_asset', normal_balance: 'debit', parent_code: '1100', opening_balance: '50000', currency: 'MWK' },
      { code: '2111', name: 'Trade Creditors', description: 'Amounts owed to suppliers', account_type: 'liability', account_subtype: 'current_liability', normal_balance: 'credit', parent_code: '2110', opening_balance: '0', currency: 'MWK' },
    ],
    systemMappings: {
      quickbooks: { 'Account Name': 'name', 'Account Number': 'code', 'Type': 'account_type', 'Detail Type': 'account_subtype' },
      xero: { 'Code': 'code', 'Name': 'name', 'Type': 'account_type', 'Tax': 'account_subtype' },
    }
  },
  contacts: {
    entityType: 'contacts',
    label: 'Customers & Suppliers',
    description: 'Import contacts from your previous system',
    headers: ['name', 'contact_type', 'trading_name', 'email', 'phone', 'address_line1', 'city', 'country', 'tpin', 'vat_number', 'currency', 'credit_limit', 'credit_terms_days'],
    requiredHeaders: ['name', 'contact_type'],
    exampleRows: [
      { name: 'Acme Corp', contact_type: 'customer', trading_name: 'Acme', email: 'info@acme.com', phone: '+265 999 000 001', address_line1: 'Plot 123', city: 'Blantyre', country: 'Malawi', tpin: '12345678', vat_number: '', currency: 'MWK', credit_limit: '1000000', credit_terms_days: '30' },
      { name: 'Supplies Ltd', contact_type: 'supplier', trading_name: '', email: 'orders@supplies.com', phone: '+265 999 000 002', address_line1: 'Area 47', city: 'Lilongwe', country: 'Malawi', tpin: '', vat_number: '', currency: 'MWK', credit_limit: '', credit_terms_days: '14' },
    ],
    systemMappings: {
      quickbooks: { 'Display Name': 'name', 'Company Name': 'trading_name', 'Email': 'email', 'Phone': 'phone' },
      xero: { 'ContactName': 'name', 'EmailAddress': 'email', 'AccountNumber': 'code' },
    }
  },
  products: {
    entityType: 'products',
    label: 'Products & Services',
    description: 'Import your inventory items and services',
    headers: ['name', 'sku', 'description', 'product_type', 'unit_of_measure', 'sale_price', 'purchase_price', 'track_inventory', 'opening_quantity', 'opening_cost', 'category', 'sales_tax_code', 'purchase_tax_code'],
    requiredHeaders: ['name'],
    exampleRows: [
      { name: 'Maize Flour 50kg', sku: 'MF-50', description: 'Premium maize flour', product_type: 'inventory', unit_of_measure: 'bag', sale_price: '25000', purchase_price: '20000', track_inventory: 'true', opening_quantity: '100', opening_cost: '20000', category: 'Flour', sales_tax_code: 'vat_standard', purchase_tax_code: 'vat_standard' },
      { name: 'Consulting Service', sku: 'CONS-001', description: 'Business consulting', product_type: 'service', unit_of_measure: 'hour', sale_price: '50000', purchase_price: '', track_inventory: 'false', opening_quantity: '', opening_cost: '', category: 'Services', sales_tax_code: 'vat_standard', purchase_tax_code: 'vat_standard' },
    ],
    systemMappings: {
      quickbooks: { 'Product/Service Name': 'name', 'SKU': 'sku', 'Sales Price': 'sale_price', 'Cost': 'purchase_price' },
      xero: { 'Item Code': 'sku', 'Item Name': 'name', 'Sales Price': 'sale_price' },
    }
  },
  opening_balances: {
    entityType: 'opening_balances',
    label: 'Opening Balances',
    description: 'Set opening balances for your accounts as of migration date',
    headers: ['account_code', 'account_name', 'opening_balance', 'balance_type', 'as_of_date', 'description'],
    requiredHeaders: ['account_code', 'opening_balance'],
    exampleRows: [
      { account_code: '1110', account_name: 'Cash on Hand', opening_balance: '1500000', balance_type: 'debit', as_of_date: '2024-01-01', description: 'Opening cash' },
      { account_code: '3110', account_name: 'Share Capital', opening_balance: '5000000', balance_type: 'credit', as_of_date: '2024-01-01', description: 'Initial capital' },
    ]
  },
  trial_balance: {
    entityType: 'trial_balance',
    label: 'Trial Balance',
    description: 'Import trial balance from previous system to set opening balances',
    headers: ['account_code', 'account_name', 'debit', 'credit', 'account_type', 'description'],
    requiredHeaders: ['account_code', 'account_name'],
    exampleRows: [
      { account_code: '1110', account_name: 'Cash on Hand', debit: '1500000', credit: '', account_type: 'asset', description: '' },
      { account_code: '3110', account_name: 'Share Capital', debit: '', credit: '5000000', account_type: 'equity', description: '' },
    ],
    systemMappings: {
      quickbooks: { 'Account': 'account_name', 'Debit': 'debit', 'Credit': 'credit' },
      xero: { 'Account Code': 'account_code', 'Account': 'account_name', 'Debit': 'debit', 'Credit': 'credit' },
      sage: { 'Nominal Code': 'account_code', 'Nominal Name': 'account_name', 'Debit': 'debit', 'Credit': 'credit' },
    }
  },
  invoices: {
    entityType: 'invoices',
    label: 'Sales Invoices',
    description: 'Import historical sales invoices',
    headers: ['invoice_number', 'customer_name', 'issue_date', 'due_date', 'item_name', 'item_sku', 'quantity', 'unit_price', 'tax_code', 'description', 'currency'],
    requiredHeaders: ['invoice_number', 'customer_name', 'issue_date'],
    exampleRows: [
      { invoice_number: 'INV-001', customer_name: 'Acme Corp', issue_date: '2024-01-15', due_date: '2024-02-15', item_name: 'Maize Flour 50kg', item_sku: 'MF-50', quantity: '10', unit_price: '25000', tax_code: 'vat_standard', description: 'Monthly supply', currency: 'MWK' },
    ],
    systemMappings: {
      quickbooks: { 'Invoice No.': 'invoice_number', 'Customer': 'customer_name', 'Invoice Date': 'issue_date', 'Due Date': 'due_date' },
      xero: { 'InvoiceNumber': 'invoice_number', 'ContactName': 'customer_name', 'InvoiceDate': 'issue_date' },
    }
  },
  bills: {
    entityType: 'bills',
    label: 'Bills & Expenses',
    description: 'Import supplier bills and expenses',
    headers: ['bill_number', 'supplier_name', 'bill_date', 'due_date', 'category', 'amount', 'tax_code', 'description', 'currency', 'payment_method'],
    requiredHeaders: ['supplier_name', 'bill_date', 'amount'],
    exampleRows: [
      { bill_number: 'BILL-001', supplier_name: 'Supplies Ltd', bill_date: '2024-01-10', due_date: '2024-01-24', category: 'Office Supplies', amount: '150000', tax_code: 'vat_standard', description: 'Stationery', currency: 'MWK', payment_method: 'bank_transfer' },
    ]
  },
  fixed_assets: {
    entityType: 'fixed_assets',
    label: 'Fixed Assets',
    description: 'Import fixed asset register',
    headers: ['asset_number', 'name', 'category', 'acquisition_date', 'acquisition_cost', 'residual_value', 'useful_life_years', 'depreciation_method', 'accumulated_depreciation', 'location', 'serial_number'],
    requiredHeaders: ['asset_number', 'name', 'acquisition_cost'],
    exampleRows: [
      { asset_number: 'FA-001', name: 'Toyota Hilux', category: 'Motor Vehicles', acquisition_date: '2023-06-01', acquisition_cost: '25000000', residual_value: '5000000', useful_life_years: '5', depreciation_method: 'straight_line', accumulated_depreciation: '3000000', location: 'Head Office', serial_number: 'VIN123' },
    ],
    systemMappings: {
      quickbooks: { 'Asset Name': 'name', 'Purchase Date': 'acquisition_date', 'Cost': 'acquisition_cost' },
    }
  },
  inventory_opening: {
    entityType: 'inventory_opening',
    label: 'Inventory Opening Stock',
    description: 'Set opening stock quantities and values',
    headers: ['product_sku', 'product_name', 'location', 'quantity', 'average_cost', 'total_value', 'as_of_date'],
    requiredHeaders: ['product_sku', 'quantity', 'average_cost'],
    exampleRows: [
      { product_sku: 'MF-50', product_name: 'Maize Flour 50kg', location: 'Main Warehouse', quantity: '100', average_cost: '20000', total_value: '2000000', as_of_date: '2024-01-01' },
    ]
  },
  bank_transactions: {
    entityType: 'bank_transactions',
    label: 'Bank Transactions',
    description: 'Import historical bank transactions',
    headers: ['date', 'description', 'amount', 'type', 'reference', 'account_code', 'currency'],
    requiredHeaders: ['date', 'description', 'amount'],
    exampleRows: [
      { date: '2024-01-05', description: 'Payment from Acme Corp', amount: '250000', type: 'credit', reference: 'INV-001', account_code: '1121', currency: 'MWK' },
    ]
  },
  employees: {
    entityType: 'employees',
    label: 'Employees',
    description: 'Import employee data for payroll',
    headers: ['employee_number', 'first_name', 'last_name', 'email', 'phone', 'department', 'position', 'hire_date', 'basic_salary', 'bank_account', 'tpin', 'pension_number'],
    requiredHeaders: ['first_name', 'last_name'],
    exampleRows: [
      { employee_number: 'EMP-001', first_name: 'John', last_name: 'Banda', email: 'john@company.com', phone: '+265 999 000 001', department: 'Sales', position: 'Manager', hire_date: '2023-01-15', basic_salary: '500000', bank_account: '12345678', tpin: '12345678', pension_number: 'PEN001' },
    ]
  }
};

// ── CSV Parsing ────────────────────────────────────────────────────────────────

export function parseCSVFile(file: File): Promise<ImportPreview> {
  return new Promise((resolve, reject) => {
    // Papa.parse expects File | string; cast to any to satisfy TS overload which in @types/papaparse
    // uses a generic that sometimes resolves to unique symbol when File type is not matched.
    (Papa as unknown as { parse: (file: unknown, config: unknown) => void }).parse(file, {
      header: true,
      skipEmptyLines: true,
      trimHeaders: true,
      transformHeader: (header: string) => header.trim().toLowerCase(),
      complete: (results: Papa.ParseResult<Record<string, string>>) => {
        const headers = (results.meta.fields as string[] | undefined)?.map((h: string) => h.trim().toLowerCase()) || [];
        const rawRows = results.data as Record<string, string>[];
        
        const parsedRows: ParsedRow[] = rawRows.map((row, index) => {
          // Normalize keys to lowercase
          const normalizedRow: Record<string, string> = {};
          Object.keys(row).forEach(key => {
            normalizedRow[key.trim().toLowerCase()] = String(row[key] ?? '').trim();
          });

          return {
            rowNumber: index + 2, // +2 for 1-based + header
            data: normalizedRow,
            errors: [],
            warnings: [],
            isValid: true
          };
        });

        // Detect system based on headers
        const detectedSystem = detectExternalSystem(headers);

        resolve({
          totalRows: rawRows.length,
          validRows: parsedRows.filter(r => r.isValid).length,
          invalidRows: parsedRows.filter(r => !r.isValid).length,
          headers,
          rows: parsedRows,
          detectedSystem
        });
      },
      error: (error: Error) => reject(error)
    });
  });
}

function detectExternalSystem(headers: string[]): string | undefined {
  const headerStr = headers.join(' ').toLowerCase();
  
  if (headerStr.includes('quickbooks') || headers.some(h => ['account name', 'display name', 'product/service'].some(qb => h.includes(qb.toLowerCase())))) {
    return 'quickbooks';
  }
  if (headers.some(h => ['contactname', 'invoicenumber', 'account code'].some(x => h === x.toLowerCase()))) {
    return 'xero';
  }
  if (headers.some(h => h.includes('nominal') || h.includes('sage'))) {
    return 'sage';
  }
  if (headers.some(h => ['item code', 'item name'].some(x => h.includes(x.toLowerCase())))) {
    return 'xero';
  }
  return undefined;
}

// ── Validation ───────────────────────────────────────────────────────────────

export function validateRows(
  preview: ImportPreview,
  entityType: ImportEntityType,
  existingCodes?: Set<string>
): ImportPreview {
  const template = IMPORT_TEMPLATES[entityType];
  const required = template.requiredHeaders.map(h => h.toLowerCase());

  const validatedRows = preview.rows.map(row => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check required fields
    required.forEach(field => {
      if (!row.data[field] || row.data[field].trim() === '') {
        errors.push(`Missing required field: ${field}`);
      }
    });

    // Entity-specific validations
    switch (entityType) {
      case 'chart_of_accounts':
        validateAccountRow(row, errors, existingCodes);
        break;
      case 'contacts':
        validateContactRow(row, errors, warnings);
        break;
      case 'products':
        validateProductRow(row, errors);
        break;
      case 'fixed_assets':
        validateAssetRow(row, errors);
        break;
      case 'opening_balances':
      case 'trial_balance':
        validateOpeningBalanceRow(row, errors);
        break;
      default:
        break;
    }

    return {
      ...row,
      errors,
      warnings,
      isValid: errors.length === 0
    };
  });

  return {
    ...preview,
    rows: validatedRows,
    validRows: validatedRows.filter(r => r.isValid).length,
    invalidRows: validatedRows.filter(r => !r.isValid).length
  };
}

function validateAccountRow(row: ParsedRow, errors: string[], existingCodes?: Set<string>) {
  const code = row.data['code'];
  if (code) {
    if (existingCodes?.has(code)) {
      errors.push(`Account code ${code} already exists`);
    }
    if (!/^[A-Za-z0-9_-]+$/.test(code)) {
      errors.push(`Invalid code format: ${code} (only letters, numbers, dash, underscore)`);
    }
  }
  
  const type = row.data['account_type'];
  if (type && !['asset', 'liability', 'equity', 'income', 'expense'].includes(type.toLowerCase())) {
    errors.push(`Invalid account_type: ${type}`);
  }

  const balance = row.data['opening_balance'];
  if (balance && isNaN(Number(balance))) {
    errors.push(`Invalid opening_balance: ${balance} must be numeric`);
  }
}

function validateContactRow(row: ParsedRow, errors: string[], warnings: string[]) {
  const type = row.data['contact_type'];
  if (type && !['customer', 'supplier', 'both', 'employee'].includes(type.toLowerCase())) {
    errors.push(`Invalid contact_type: ${type}. Must be customer, supplier, both, or employee`);
  }

  const email = row.data['email'];
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    warnings.push(`Invalid email format: ${email}`);
  }
}

function validateProductRow(row: ParsedRow, errors: string[]) {
  const salePrice = row.data['sale_price'];
  const purchasePrice = row.data['purchase_price'];
  
  if (salePrice && isNaN(Number(salePrice))) {
    errors.push(`Invalid sale_price: ${salePrice}`);
  }
  if (purchasePrice && isNaN(Number(purchasePrice))) {
    errors.push(`Invalid purchase_price: ${purchasePrice}`);
  }

  const qty = row.data['opening_quantity'];
  if (qty && isNaN(Number(qty))) {
    errors.push(`Invalid opening_quantity: ${qty}`);
  }
}

function validateAssetRow(row: ParsedRow, errors: string[]) {
  const cost = row.data['acquisition_cost'];
  if (cost && isNaN(Number(cost))) {
    errors.push(`Invalid acquisition_cost: ${cost}`);
  } else if (cost && Number(cost) <= 0) {
    errors.push(`acquisition_cost must be greater than 0`);
  }

  const date = row.data['acquisition_date'];
  if (date && isNaN(Date.parse(date))) {
    errors.push(`Invalid acquisition_date: ${date}`);
  }
}

function validateOpeningBalanceRow(row: ParsedRow, errors: string[]) {
  const balance = row.data['opening_balance'] || row.data['debit'] || row.data['credit'];
  if (balance && isNaN(Number(balance.replace(/,/g, '')))) {
    errors.push(`Invalid balance amount: ${balance}`);
  }
}

// ── Import Execution ─────────────────────────────────────────────────────────

export async function importChartOfAccounts(
  businessId: string,
  rows: ParsedRow[]
): Promise<ImportResult> {
  const results: ImportResult = { success: 0, failed: 0, errors: [] };
  const toInsert: Record<string, unknown>[] = [];

  // Get existing accounts to check duplicates and resolve parent_code
  const { data: existingAccounts } = await supabase
    .from('accounts')
    .select('id, code')
    .eq('business_id', businessId)
    .is('deleted_at', null);

  const codeToId = new Map((existingAccounts || []).map(a => [a.code, a.id]));
  const existingCodes = new Set(codeToId.keys());

  for (const row of rows) {
    if (!row.isValid) {
      results.failed++;
      results.errors.push({ row: row.rowNumber, message: row.errors.join(', ') });
      continue;
    }

    const code = row.data['code']?.trim();
    if (existingCodes.has(code)) {
      results.failed++;
      results.errors.push({ row: row.rowNumber, message: `Account code ${code} already exists` });
      continue;
    }

    const accountType = row.data['account_type']?.toLowerCase() as "asset" | "liability" | "equity" | "income" | "expense";
    const accountSubtype = row.data['account_subtype']?.toLowerCase() || null;
    const normalBalance = row.data['normal_balance']?.toLowerCase() || 
      (['asset', 'expense'].includes(accountType) ? 'debit' : 'credit');

    toInsert.push({
      business_id: businessId,
      code,
      name: row.data['name']?.trim(),
      description: row.data['description']?.trim() || null,
      account_type: accountType,
      account_subtype: accountSubtype,
      normal_balance: normalBalance,
      is_group: row.data['is_group']?.toLowerCase() === 'true' || false,
      is_system: false,
      is_bank_account: row.data['is_bank_account']?.toLowerCase() === 'true' || false,
      is_active: true,
      currency: row.data['currency'] || 'MWK',
      opening_balance: parseFloat(row.data['opening_balance'] || '0') || 0,
      parent_id: row.data['parent_code'] ? codeToId.get(row.data['parent_code']) || null : null,
      tax_code: 'none'
    });
  }

  if (toInsert.length > 0) {
    // Simplified batch insert - parent resolution already done via codeToId lookup
    // For accounts whose parent_code couldn't be resolved, parent_id is null (top-level)
    const { data, error } = await supabase
      .from('accounts')
      .insert(toInsert as never)
      .select('id, code');

    if (error) {
      results.failed = toInsert.length;
      results.errors.push({ row: 0, message: error.message });
    } else if (data) {
      data.forEach((row: { code: string; id: string }) => codeToId.set(row.code, row.id));
      results.success = data.length;
    }
  }

  return results;
}

export async function importContacts(
  businessId: string,
  rows: ParsedRow[]
): Promise<ImportResult> {
  const results: ImportResult = { success: 0, failed: 0, errors: [] };
  const toInsert: Record<string, unknown>[] = [];

  for (const row of rows) {
    if (!row.isValid) {
      results.failed++;
      results.errors.push({ row: row.rowNumber, message: row.errors.join(', ') });
      continue;
    }

    const contactType = row.data['contact_type']?.toLowerCase() || 'customer';
    
    toInsert.push({
      business_id: businessId,
      name: row.data['name']?.trim(),
      contact_type: contactType,
      trading_name: row.data['trading_name']?.trim() || null,
      email: row.data['email']?.trim() || null,
      phone: row.data['phone']?.trim() || null,
      address_line1: row.data['address_line1']?.trim() || null,
      city: row.data['city']?.trim() || null,
      country: row.data['country']?.trim() || null,
      tpin: row.data['tpin']?.trim() || null,
      vat_number: row.data['vat_number']?.trim() || null,
      currency: row.data['currency'] || 'MWK',
      credit_limit: row.data['credit_limit'] ? parseFloat(row.data['credit_limit']) : null,
      credit_terms_days: row.data['credit_terms_days'] ? parseInt(row.data['credit_terms_days']) : 30,
      is_active: true
    });
  }

  if (toInsert.length > 0) {
    const { data, error } = await supabase
      .from('contacts')
      .insert(toInsert as never)
      .select('id');

    if (error) {
      return {
        success: 0,
        failed: toInsert.length,
        errors: [{ row: 0, message: error.message }]
      };
    }

    results.success = data?.length || 0;
  }

  return results;
}

export async function importProducts(
  businessId: string,
  rows: ParsedRow[]
): Promise<ImportResult> {
  const results: ImportResult = { success: 0, failed: 0, errors: [] };
  const toInsert: Record<string, unknown>[] = [];

  for (const row of rows) {
    if (!row.isValid) {
      results.failed++;
      results.errors.push({ row: row.rowNumber, message: row.errors.join(', ') });
      continue;
    }

    toInsert.push({
      business_id: businessId,
      name: row.data['name']?.trim(),
      sku: row.data['sku']?.trim() || null,
      description: row.data['description']?.trim() || null,
      unit_of_measure: row.data['unit_of_measure']?.trim() || 'each',
      sale_price: row.data['sale_price'] ? parseFloat(row.data['sale_price']) : 0,
      purchase_price: row.data['purchase_price'] ? parseFloat(row.data['purchase_price']) : null,
      track_inventory: row.data['track_inventory']?.toLowerCase() === 'true' || false,
      is_active: true,
      sales_tax_code: row.data['sales_tax_code'] || 'none',
      purchase_tax_code: row.data['purchase_tax_code'] || 'none'
    });
  }

  if (toInsert.length > 0) {
    const { data, error } = await supabase
      .from('products')
      .insert(toInsert as never)
      .select('id');

    if (error) {
      return {
        success: 0,
        failed: toInsert.length,
        errors: [{ row: 0, message: error.message }]
      };
    }

    results.success = data?.length || 0;
    // Opening stock can be imported separately via inventory_opening entity
    // to properly handle location_id and costing.
  }

  return results;
}

export async function importOpeningBalances(
  businessId: string,
  rows: ParsedRow[]
): Promise<ImportResult> {
  const results: ImportResult = { success: 0, failed: 0, errors: [] };

  // Get accounts by code
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, code')
    .eq('business_id', businessId)
    .is('deleted_at', null);

  const codeToId = new Map((accounts || []).map(a => [a.code, a.id]));

  for (const row of rows) {
    if (!row.isValid) {
      results.failed++;
      results.errors.push({ row: row.rowNumber, message: row.errors.join(', ') });
      continue;
    }

    const code = row.data['account_code']?.trim();
    const accountId = codeToId.get(code);

    if (!accountId) {
      results.failed++;
      results.errors.push({ row: row.rowNumber, message: `Account code ${code} not found` });
      continue;
    }

    const balanceStr = row.data['opening_balance'] || row.data['debit'] || row.data['credit'] || '0';
    const balance = parseFloat(balanceStr.replace(/,/g, '')) || 0;

    // For trial balance import, debit is positive, credit is negative or handled via type
    // For opening_balances import, we use the balance_type to determine sign
    let finalBalance = balance;
    const balanceType = row.data['balance_type']?.toLowerCase();
    const hasCredit = row.data['credit'] && parseFloat(row.data['credit'].replace(/,/g, '')) > 0;
    
    if (balanceType === 'credit' || hasCredit) {
      // For liability/equity/income, credit is natural positive, but opening_balance is stored as natural
      // So we keep positive
      finalBalance = Math.abs(balance);
    }

    const { error } = await supabase
      .from('accounts')
      .update({ opening_balance: finalBalance })
      .eq('id', accountId);

    if (error) {
      results.failed++;
      results.errors.push({ row: row.rowNumber, message: error.message });
    } else {
      results.success++;
    }
  }

  return results;
}

export interface AssetCategory {
  id: string;
  name: string;
  useful_life_years?: number | null;
  depreciation_method?: string | null;
  asset_account_id?: string | null;
  accumulated_dep_account_id?: string | null;
  dep_expense_account_id?: string | null;
}

export async function importFixedAssets(
  businessId: string,
  rows: ParsedRow[],
  categories: AssetCategory[]
): Promise<ImportResult> {
  const results: ImportResult = { success: 0, failed: 0, errors: [] };
  const toInsert: Record<string, unknown>[] = [];

  const categoryByName = new Map(categories.map(c => [c.name.toLowerCase(), c]));

  for (const row of rows) {
    if (!row.isValid) {
      results.failed++;
      results.errors.push({ row: row.rowNumber, message: row.errors.join(', ') });
      continue;
    }

    const categoryName = row.data['category']?.trim().toLowerCase();
    const category = categoryName ? categoryByName.get(categoryName) : null;

    const cost = parseFloat(row.data['acquisition_cost'] || '0');
    const accDep = parseFloat(row.data['accumulated_depreciation'] || '0');

    toInsert.push({
      business_id: businessId,
      asset_number: row.data['asset_number']?.trim(),
      name: row.data['name']?.trim(),
      category_id: category?.id || null,
      acquisition_date: row.data['acquisition_date'] || new Date().toISOString().slice(0, 10),
      acquisition_cost: cost,
      residual_value: parseFloat(row.data['residual_value'] || '0') || 0,
      useful_life_years: row.data['useful_life_years'] ? parseInt(row.data['useful_life_years']) : category?.useful_life_years || 5,
      depreciation_method: row.data['depreciation_method'] || category?.depreciation_method || 'straight_line',
      depreciation_start_date: row.data['acquisition_date'] || new Date().toISOString().slice(0, 10),
      accumulated_depreciation: accDep,
      net_book_value: cost - accDep,
      asset_account_id: category?.asset_account_id || null,
      accumulated_dep_account_id: category?.accumulated_dep_account_id || null,
      dep_expense_account_id: category?.dep_expense_account_id || null,
      location: row.data['location'] || null,
      serial_number: row.data['serial_number'] || null,
      status: 'active',
      is_active: true,
      is_depreciable: true
    });
  }

  if (toInsert.length > 0) {
    const { data, error } = await supabase
      .from('fixed_assets')
      .insert(toInsert as never)
      .select('id');

    if (error) {
      return {
        success: 0,
        failed: toInsert.length,
        errors: [{ row: 0, message: error.message }]
      };
    }

    results.success = data?.length || 0;
  }

  return results;
}

// ── Template Download ────────────────────────────────────────────────────────

export function downloadTemplate(entityType: ImportEntityType) {
  const template = IMPORT_TEMPLATES[entityType];
  const csvContent = [
    template.headers.join(','),
    ...template.exampleRows.map(row => 
      template.headers.map(h => `"${row[h] || ''}"`).join(',')
    )
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = `${entityType}_template.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadAllTemplates() {
  // Create a zip-like collection by downloading each template
  // For simplicity, we'll create a combined README and let user download individually
  // In a real implementation, you'd use JSZip to create a zip file
  Object.keys(IMPORT_TEMPLATES).forEach(entityType => {
    setTimeout(() => downloadTemplate(entityType as ImportEntityType), 100);
  });
}

// ── Generic Import Dispatcher ────────────────────────────────────────────────

export async function executeImport(
  businessId: string,
  entityType: ImportEntityType,
  rows: ParsedRow[],
  options?: { categories?: AssetCategory[] }
): Promise<ImportResult> {
  switch (entityType) {
    case 'chart_of_accounts':
      return importChartOfAccounts(businessId, rows);
    case 'contacts':
      return importContacts(businessId, rows);
    case 'products':
      return importProducts(businessId, rows);
    case 'opening_balances':
    case 'trial_balance':
      return importOpeningBalances(businessId, rows);
    case 'fixed_assets':
      return importFixedAssets(businessId, rows, options?.categories || []);
    default:
      return {
        success: 0,
        failed: rows.length,
        errors: [{ row: 0, message: `Import for ${entityType} not yet implemented` }]
      };
  }
}
