/**
 * Supabase generated database types for Ledgr.
 * Verified against live schema DDL and enum table (document index 2 & 3).
 * All enum values match the exact live database members.
 */

// ---------------------------------------------------------------------------
// Enums — exact members from live DB enum table
// ---------------------------------------------------------------------------

/** DB: currency_code */
export type Currency = 'MWK' | 'USD' | 'EUR' | 'GBP' | 'ZAR' | 'ZMW' | 'TZS' | 'KES' | 'UGX';

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

/** DB: user_role — exact 4 members. 'admin' and 'staff' do NOT exist in the DB. */
export type BusinessUserRole = 'owner' | 'accountant' | 'auditor' | 'viewer';

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

/** DB: depreciation_method — exact 4 members. 'sum_of_years_digits' was missing. */
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

// ---------------------------------------------------------------------------
// Row / Insert / Update helpers
// ---------------------------------------------------------------------------

export interface Database {
  public: {
    Tables: {
      businesses: {
        Row: {
          id: string;
          name: string;
          trading_name: string | null;
          registration_number: string | null;
          tpin: string | null;
          vat_number: string | null;
          address_line1: string | null;
          address_line2: string | null;
          city: string | null;
          country: string | null;
          phone: string | null;
          email: string | null;
          website: string | null;
          logo_url: string | null;
          brand_color: string | null;
          base_currency: Currency;
          financial_year_start: string;
          vat_registered: boolean;
          vat_period: string | null;
          default_payment_method: PaymentMethod | null;
          invoice_prefix: string | null;
          invoice_next_number: number;
          expense_prefix: string | null;
          expense_next_number: number;
          payroll_prefix: string | null;
          payroll_next_number: number;
          timezone: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: Partial<Database['public']['Tables']['businesses']['Row']> &
          Pick<Database['public']['Tables']['businesses']['Row'],
            'name' | 'base_currency' | 'financial_year_start' | 'vat_registered' |
            'invoice_next_number' | 'expense_next_number' | 'payroll_next_number' |
            'timezone' | 'is_active'>;
        Update: Partial<Database['public']['Tables']['businesses']['Row']>;
      };

      user_profiles: {
        Row: {
          id: string;
          full_name: string;
          avatar_url: string | null;
          phone: string | null;
          preferred_currency: Currency | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['user_profiles']['Row']> &
          Pick<Database['public']['Tables']['user_profiles']['Row'], 'id' | 'full_name'>;
        Update: Partial<Database['public']['Tables']['user_profiles']['Row']>;
      };

      business_users: {
        Row: {
          id: string;
          business_id: string;
          user_id: string;
          role: BusinessUserRole;
          invited_by: string | null;
          invited_at: string | null;
          accepted_at: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['business_users']['Row']> &
          Pick<Database['public']['Tables']['business_users']['Row'],
            'business_id' | 'user_id' | 'role' | 'is_active'>;
        Update: Partial<Database['public']['Tables']['business_users']['Row']>;
      };

      branches: {
        Row: {
          id: string;
          business_id: string;
          name: string;
          code: string | null;
          location: string | null;
          manager_id: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: Partial<Database['public']['Tables']['branches']['Row']> &
          Pick<Database['public']['Tables']['branches']['Row'],
            'business_id' | 'name' | 'is_active'>;
        Update: Partial<Database['public']['Tables']['branches']['Row']>;
      };

      departments: {
        Row: {
          id: string;
          business_id: string;
          branch_id: string | null;
          name: string;
          code: string | null;
          cost_centre: string | null;
          head_user_id: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: Partial<Database['public']['Tables']['departments']['Row']> &
          Pick<Database['public']['Tables']['departments']['Row'],
            'business_id' | 'name' | 'is_active'>;
        Update: Partial<Database['public']['Tables']['departments']['Row']>;
      };

      accounts: {
        Row: {
          id: string;
          business_id: string;
          parent_id: string | null;
          code: string;
          name: string;
          description: string | null;
          account_type: AccountType;
          account_subtype: AccountSubtype | null;
          normal_balance: string;
          is_group: boolean;
          is_system: boolean;
          is_bank_account: boolean;
          bank_name: string | null;
          bank_account_number: string | null;
          bank_branch: string | null;
          mobile_money_type: string | null;
          mobile_money_number: string | null;
          currency: Currency;
          tax_code: TaxCode | null;
          branch_id: string | null;
          department_id: string | null;
          opening_balance: number;
          opening_balance_date: string | null;
          is_active: boolean;
          notes: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: Partial<Database['public']['Tables']['accounts']['Row']> &
          Pick<Database['public']['Tables']['accounts']['Row'],
            'business_id' | 'code' | 'name' | 'account_type' | 'normal_balance' |
            'is_group' | 'is_system' | 'is_bank_account' | 'currency' |
            'opening_balance' | 'is_active'>;
        Update: Partial<Database['public']['Tables']['accounts']['Row']>;
      };

      contacts: {
        Row: {
          id: string;
          business_id: string;
          contact_type: string;
          name: string;
          trading_name: string | null;
          tpin: string | null;
          vat_number: string | null;
          email: string | null;
          phone: string | null;
          mobile_money_number: string | null;
          mobile_money_type: string | null;
          address_line1: string | null;
          address_line2: string | null;
          city: string | null;
          country: string | null;
          credit_limit: number | null;
          credit_terms_days: number | null;
          currency: Currency | null;
          wht_exempt: boolean;
          wht_exemption_ref: string | null;
          ar_account_id: string | null;
          ap_account_id: string | null;
          notes: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: Partial<Database['public']['Tables']['contacts']['Row']> &
          Pick<Database['public']['Tables']['contacts']['Row'],
            'business_id' | 'contact_type' | 'name' | 'wht_exempt' | 'is_active'>;
        Update: Partial<Database['public']['Tables']['contacts']['Row']>;
      };

      invoices: {
        Row: {
          id: string;
          business_id: string;
          invoice_number: string;
          invoice_type: string;
          status: InvoiceStatus;
          contact_id: string;
          branch_id: string | null;
          department_id: string | null;
          issue_date: string;
          due_date: string | null;
          currency: Currency;
          exchange_rate: number;
          subtotal: number;
          discount_amount: number;
          discount_percent: number;
          taxable_amount: number;
          vat_amount: number;
          wht_amount: number;
          total_amount: number;
          amount_paid: number;
          amount_due: number | null;
          ar_account_id: string | null;
          revenue_account_id: string | null;
          journal_entry_id: string | null;
          po_number: string | null;
          notes: string | null;
          terms: string | null;
          credit_note_for: string | null;
          sent_at: string | null;
          viewed_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: Partial<Database['public']['Tables']['invoices']['Row']> &
          Pick<Database['public']['Tables']['invoices']['Row'],
            'business_id' | 'invoice_number' | 'invoice_type' | 'status' | 'contact_id' |
            'issue_date' | 'currency' | 'exchange_rate' | 'subtotal' | 'discount_amount' |
            'discount_percent' | 'taxable_amount' | 'vat_amount' | 'wht_amount' |
            'total_amount' | 'amount_paid'>;
        Update: Partial<Database['public']['Tables']['invoices']['Row']>;
      };

      invoice_lines: {
        Row: {
          id: string;
          invoice_id: string;
          business_id: string;
          line_number: number;
          product_id: string | null;
          description: string;
          quantity: number;
          unit_price: number;
          discount_percent: number;
          line_subtotal: number | null;
          tax_code: TaxCode;
          tax_rate: number;
          tax_amount: number;
          line_total: number;
          account_id: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['invoice_lines']['Row']> &
          Pick<Database['public']['Tables']['invoice_lines']['Row'],
            'invoice_id' | 'business_id' | 'line_number' | 'description' | 'quantity' |
            'unit_price' | 'discount_percent' | 'tax_code' | 'tax_rate' | 'tax_amount' |
            'line_total'>;
        Update: Partial<Database['public']['Tables']['invoice_lines']['Row']>;
      };

      invoice_payments: {
        Row: {
          id: string;
          business_id: string;
          invoice_id: string;
          payment_date: string;
          amount: number;
          currency: Currency;
          exchange_rate: number;
          payment_method: PaymentMethod;
          reference: string | null;
          bank_account_id: string | null;
          journal_entry_id: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['invoice_payments']['Row']> &
          Pick<Database['public']['Tables']['invoice_payments']['Row'],
            'business_id' | 'invoice_id' | 'payment_date' | 'amount' | 'currency' |
            'exchange_rate' | 'payment_method'>;
        Update: Partial<Database['public']['Tables']['invoice_payments']['Row']>;
      };

      expenses: {
        Row: {
          id: string;
          business_id: string;
          expense_number: string;
          expense_type: string;
          status: string;
          contact_id: string | null;
          branch_id: string | null;
          department_id: string | null;
          expense_date: string;
          due_date: string | null;
          currency: Currency;
          exchange_rate: number;
          subtotal: number;
          vat_amount: number;
          wht_amount: number;
          total_amount: number;
          amount_paid: number;
          ap_account_id: string | null;
          journal_entry_id: string | null;
          receipt_url: string | null;
          receipt_filename: string | null;
          receipt_size_bytes: number | null;
          receipt_mime_type: string | null;
          reference: string | null;
          notes: string | null;
          approved_by: string | null;
          approved_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: Partial<Database['public']['Tables']['expenses']['Row']> &
          Pick<Database['public']['Tables']['expenses']['Row'],
            'business_id' | 'expense_number' | 'expense_type' | 'status' | 'expense_date' |
            'currency' | 'exchange_rate' | 'subtotal' | 'vat_amount' | 'wht_amount' |
            'total_amount' | 'amount_paid'>;
        Update: Partial<Database['public']['Tables']['expenses']['Row']>;
      };

      expense_lines: {
        Row: {
          id: string;
          expense_id: string;
          business_id: string;
          line_number: number;
          description: string;
          quantity: number;
          unit_price: number;
          line_subtotal: number | null;
          tax_code: TaxCode;
          tax_rate: number;
          tax_amount: number;
          line_total: number;
          account_id: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['expense_lines']['Row']> &
          Pick<Database['public']['Tables']['expense_lines']['Row'],
            'expense_id' | 'business_id' | 'line_number' | 'description' | 'quantity' |
            'unit_price' | 'tax_code' | 'tax_rate' | 'tax_amount' | 'line_total'>;
        Update: Partial<Database['public']['Tables']['expense_lines']['Row']>;
      };

      expense_payments: {
        Row: {
          id: string;
          business_id: string;
          expense_id: string;
          payment_date: string;
          amount: number;
          currency: Currency;
          exchange_rate: number;
          payment_method: PaymentMethod;
          reference: string | null;
          bank_account_id: string | null;
          journal_entry_id: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['expense_payments']['Row']> &
          Pick<Database['public']['Tables']['expense_payments']['Row'],
            'business_id' | 'expense_id' | 'payment_date' | 'amount' | 'currency' |
            'exchange_rate' | 'payment_method'>;
        Update: Partial<Database['public']['Tables']['expense_payments']['Row']>;
      };

      products: {
        Row: {
          id: string;
          business_id: string;
          category_id: string | null;
          sku: string | null;
          name: string;
          description: string | null;
          product_type: string;
          unit_of_measure: string | null;
          sale_price: number;
          purchase_price: number;
          currency: Currency;
          sales_tax_code: TaxCode;
          purchase_tax_code: TaxCode;
          sales_account_id: string | null;
          cogs_account_id: string | null;
          inventory_account_id: string | null;
          purchase_account_id: string | null;
          track_inventory: boolean;
          reorder_level: number | null;
          reorder_quantity: number | null;
          barcode: string | null;
          image_url: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: Partial<Database['public']['Tables']['products']['Row']> &
          Pick<Database['public']['Tables']['products']['Row'],
            'business_id' | 'name' | 'product_type' | 'sale_price' | 'purchase_price' |
            'currency' | 'sales_tax_code' | 'purchase_tax_code' | 'track_inventory' | 'is_active'>;
        Update: Partial<Database['public']['Tables']['products']['Row']>;
      };

      product_categories: {
        Row: {
          id: string;
          business_id: string;
          name: string;
          parent_id: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['product_categories']['Row']> &
          Pick<Database['public']['Tables']['product_categories']['Row'], 'business_id' | 'name'>;
        Update: Partial<Database['public']['Tables']['product_categories']['Row']>;
      };

      inventory_locations: {
        Row: {
          id: string;
          business_id: string;
          branch_id: string | null;
          name: string;
          code: string | null;
          is_default: boolean;
          is_active: boolean;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['inventory_locations']['Row']> &
          Pick<Database['public']['Tables']['inventory_locations']['Row'],
            'business_id' | 'name' | 'is_default' | 'is_active'>;
        Update: Partial<Database['public']['Tables']['inventory_locations']['Row']>;
      };

      inventory_balances: {
        Row: {
          id: string;
          business_id: string;
          product_id: string;
          location_id: string;
          quantity_on_hand: number;
          quantity_reserved: number;
          quantity_available: number | null;
          average_cost: number;
          last_movement_at: string | null;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['inventory_balances']['Row']> &
          Pick<Database['public']['Tables']['inventory_balances']['Row'],
            'business_id' | 'product_id' | 'location_id' | 'quantity_on_hand' |
            'quantity_reserved' | 'average_cost'>;
        Update: Partial<Database['public']['Tables']['inventory_balances']['Row']>;
      };

      stock_movements: {
        Row: {
          id: string;
          business_id: string;
          product_id: string;
          location_id: string;
          movement_type: StockMovementType;
          movement_date: string;
          quantity: number;
          unit_cost: number;
          total_cost: number | null;
          reference: string | null;
          source_type: string | null;
          source_id: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['stock_movements']['Row']> &
          Pick<Database['public']['Tables']['stock_movements']['Row'],
            'business_id' | 'product_id' | 'location_id' | 'movement_type' |
            'movement_date' | 'quantity' | 'unit_cost'>;
        Update: Partial<Database['public']['Tables']['stock_movements']['Row']>;
      };

      payroll_runs: {
        Row: {
          id: string;
          business_id: string;
          run_number: string;
          payroll_period: string;
          period_start: string;
          period_end: string;
          pay_date: string;
          status: PayrollRunStatus;
          total_gross: number;
          total_paye: number;
          total_other_deductions: number;
          total_net: number;
          journal_entry_id: string | null;
          paye_return_ref: string | null;
          paye_filed_at: string | null;
          approved_by: string | null;
          approved_at: string | null;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['payroll_runs']['Row']> &
          Pick<Database['public']['Tables']['payroll_runs']['Row'],
            'business_id' | 'run_number' | 'payroll_period' | 'period_start' | 'period_end' |
            'pay_date' | 'status' | 'total_gross' | 'total_paye' | 'total_other_deductions' |
            'total_net'>;
        Update: Partial<Database['public']['Tables']['payroll_runs']['Row']>;
      };

      payroll_employee_lines: {
        Row: {
          id: string;
          payroll_run_id: string;
          business_id: string;
          employee_id: string;
          basic_salary: number;
          total_allowances: number;
          gross_pay: number;
          paye_taxable_income: number;
          paye_deduction: number;
          paye_bands_json: Record<string, unknown> | null;
          pension_employee: number;
          pension_employer: number;
          other_deductions: number;
          total_deductions: number;
          net_pay: number;
          payment_method: PaymentMethod;
          paid_at: string | null;
          payment_ref: string | null;
          payslip_generated: boolean;
          payslip_url: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['payroll_employee_lines']['Row']> &
          Pick<Database['public']['Tables']['payroll_employee_lines']['Row'],
            'payroll_run_id' | 'business_id' | 'employee_id' | 'basic_salary' |
            'total_allowances' | 'gross_pay' | 'paye_taxable_income' | 'paye_deduction' |
            'pension_employee' | 'pension_employer' | 'other_deductions' | 'total_deductions' |
            'net_pay' | 'payment_method' | 'payslip_generated'>;
        Update: Partial<Database['public']['Tables']['payroll_employee_lines']['Row']>;
      };

      employees: {
        Row: {
          id: string;
          business_id: string;
          branch_id: string | null;
          department_id: string | null;
          employee_number: string;
          first_name: string;
          last_name: string;
          national_id: string | null;
          tpin: string | null;
          date_of_birth: string | null;
          gender: string | null;
          employment_type: string;
          job_title: string | null;
          start_date: string;
          end_date: string | null;
          probation_end_date: string | null;
          pay_frequency: string;
          gross_salary: number;
          currency: Currency;
          paye_code: string | null;
          paye_tax_class: string | null;
          tax_exempt: boolean;
          payment_method: PaymentMethod;
          bank_name: string | null;
          bank_account_number: string | null;
          bank_branch: string | null;
          mobile_money_type: string | null;
          mobile_money_number: string | null;
          email: string | null;
          phone: string | null;
          salary_account_id: string | null;
          paye_liability_account_id: string | null;
          notes: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: Partial<Database['public']['Tables']['employees']['Row']> &
          Pick<Database['public']['Tables']['employees']['Row'],
            'business_id' | 'employee_number' | 'first_name' | 'last_name' |
            'employment_type' | 'start_date' | 'pay_frequency' | 'gross_salary' |
            'currency' | 'tax_exempt' | 'payment_method' | 'is_active'>;
        Update: Partial<Database['public']['Tables']['employees']['Row']>;
      };

      employee_allowances: {
        Row: {
          id: string;
          employee_id: string;
          business_id: string;
          name: string;
          amount: number;
          is_taxable: boolean;
          is_active: boolean;
          effective_from: string;
          effective_to: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['employee_allowances']['Row']> &
          Pick<Database['public']['Tables']['employee_allowances']['Row'],
            'employee_id' | 'business_id' | 'name' | 'amount' | 'is_taxable' |
            'is_active' | 'effective_from'>;
        Update: Partial<Database['public']['Tables']['employee_allowances']['Row']>;
      };

      employee_deductions: {
        Row: {
          id: string;
          employee_id: string;
          business_id: string;
          name: string;
          deduction_type: string;
          amount: number;
          percentage: number;
          pre_tax: boolean;
          is_active: boolean;
          effective_from: string;
          effective_to: string | null;
          liability_account_id: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['employee_deductions']['Row']> &
          Pick<Database['public']['Tables']['employee_deductions']['Row'],
            'employee_id' | 'business_id' | 'name' | 'deduction_type' | 'amount' |
            'percentage' | 'pre_tax' | 'is_active' | 'effective_from'>;
        Update: Partial<Database['public']['Tables']['employee_deductions']['Row']>;
      };

      tax_configurations: {
        Row: {
          id: string;
          business_id: string;
          tax_code: TaxCode;
          name: string;
          rate: number;
          description: string | null;
          tax_payable_account_id: string | null;
          tax_receivable_account_id: string | null;
          is_active: boolean;
          effective_from: string;
          effective_to: string | null;
          mra_reference: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['tax_configurations']['Row']> &
          Pick<Database['public']['Tables']['tax_configurations']['Row'],
            'business_id' | 'tax_code' | 'name' | 'rate' | 'is_active' | 'effective_from'>;
        Update: Partial<Database['public']['Tables']['tax_configurations']['Row']>;
      };

      paye_bands: {
        Row: {
          id: string;
          business_id: string;
          fiscal_year: string;
          band_from: number;
          band_to: number | null;
          rate: number;
          band_label: string | null;
          effective_from: string;
          effective_to: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['paye_bands']['Row']> &
          Pick<Database['public']['Tables']['paye_bands']['Row'],
            'business_id' | 'fiscal_year' | 'band_from' | 'rate' | 'effective_from'>;
        Update: Partial<Database['public']['Tables']['paye_bands']['Row']>;
      };

      asset_categories: {
        Row: {
          id: string;
          business_id: string;
          name: string;
          depreciation_method: DepreciationMethod;
          useful_life_years: number | null;
          residual_percent: number;
          mra_depreciation_rate: number | null;
          asset_account_id: string | null;
          accumulated_dep_account_id: string | null;
          dep_expense_account_id: string | null;
          is_active: boolean;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['asset_categories']['Row']> &
          Pick<Database['public']['Tables']['asset_categories']['Row'],
            'business_id' | 'name' | 'depreciation_method' | 'residual_percent' | 'is_active'>;
        Update: Partial<Database['public']['Tables']['asset_categories']['Row']>;
      };

      fixed_assets: {
        Row: {
          id: string;
          business_id: string;
          category_id: string;
          branch_id: string | null;
          department_id: string | null;
          asset_number: string;
          name: string;
          description: string | null;
          serial_number: string | null;
          location: string | null;
          status: AssetStatus;
          acquisition_date: string;
          acquisition_cost: number;
          residual_value: number;
          depreciable_amount: number | null;
          depreciation_method: DepreciationMethod;
          useful_life_years: number | null;
          useful_life_months: number | null;
          depreciation_rate: number | null;
          depreciation_start_date: string;
          accumulated_depreciation: number;
          net_book_value: number | null;
          last_depreciation_date: string | null;
          revalued_amount: number | null;
          revaluation_date: string | null;
          revaluation_surplus_account: string | null;
          disposal_date: string | null;
          disposal_proceeds: number | null;
          disposal_journal_id: string | null;
          asset_account_id: string | null;
          accumulated_dep_account_id: string | null;
          dep_expense_account_id: string | null;
          supplier_id: string | null;
          purchase_invoice_ref: string | null;
          purchase_journal_id: string | null;
          notes: string | null;
          image_url: string | null;
          warranty_expiry_date: string | null;
          insurance_policy_number: string | null;
          insurance_expiry_date: string | null;
          is_active: boolean;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          deleted_at: string | null;
        };
        Insert: Partial<Database['public']['Tables']['fixed_assets']['Row']> &
          Pick<Database['public']['Tables']['fixed_assets']['Row'],
            'business_id' | 'category_id' | 'asset_number' | 'name' | 'status' |
            'acquisition_date' | 'acquisition_cost' | 'residual_value' | 'depreciation_method' |
            'depreciation_start_date' | 'accumulated_depreciation' | 'is_active'>;
        Update: Partial<Database['public']['Tables']['fixed_assets']['Row']>;
      };

      depreciation_schedules: {
        Row: {
          id: string;
          business_id: string;
          asset_id: string;
          period_start: string;
          period_end: string;
          depreciation_charge: number;
          accumulated_to_date: number;
          net_book_value: number;
          journal_entry_id: string | null;
          posted: boolean;
          posted_by: string | null;
          posted_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['depreciation_schedules']['Row']> &
          Pick<Database['public']['Tables']['depreciation_schedules']['Row'],
            'business_id' | 'asset_id' | 'period_start' | 'period_end' |
            'depreciation_charge' | 'accumulated_to_date' | 'net_book_value' | 'posted'>;
        Update: Partial<Database['public']['Tables']['depreciation_schedules']['Row']>;
      };

      budgets: {
        Row: {
          id: string;
          business_id: string;
          name: string;
          fiscal_year: string;
          period_start: string;
          period_end: string;
          is_active: boolean;
          notes: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Partial<Database['public']['Tables']['budgets']['Row']> &
          Pick<Database['public']['Tables']['budgets']['Row'],
            'business_id' | 'name' | 'fiscal_year' | 'period_start' | 'period_end' | 'is_active'>;
        Update: Partial<Database['public']['Tables']['budgets']['Row']>;
      };

      budget_lines: {
        Row: {
          id: string;
          budget_id: string;
          business_id: string;
          account_id: string;
          branch_id: string | null;
          department_id: string | null;
          m01_amount: number;
          m02_amount: number;
          m03_amount: number;
          m04_amount: number;
          m05_amount: number;
          m06_amount: number;
          m07_amount: number;
          m08_amount: number;
          m09_amount: number;
          m10_amount: number;
          m11_amount: number;
          m12_amount: number;
          annual_total: number | null;
          notes: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['budget_lines']['Row']> &
          Pick<Database['public']['Tables']['budget_lines']['Row'],
            'budget_id' | 'business_id' | 'account_id' | 'm01_amount' | 'm02_amount' |
            'm03_amount' | 'm04_amount' | 'm05_amount' | 'm06_amount' | 'm07_amount' |
            'm08_amount' | 'm09_amount' | 'm10_amount' | 'm11_amount' | 'm12_amount'>;
        Update: Partial<Database['public']['Tables']['budget_lines']['Row']>;
      };

      accounting_periods: {
        Row: {
          id: string;
          business_id: string;
          name: string;
          period_start: string;
          period_end: string;
          is_closed: boolean;
          closed_by: string | null;
          closed_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['accounting_periods']['Row']> &
          Pick<Database['public']['Tables']['accounting_periods']['Row'],
            'business_id' | 'name' | 'period_start' | 'period_end' | 'is_closed'>;
        Update: Partial<Database['public']['Tables']['accounting_periods']['Row']>;
      };

      exchange_rates: {
        Row: {
          id: string;
          business_id: string;
          from_currency: Currency;
          to_currency: Currency;
          rate: number;
          rate_date: string;
          source: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['exchange_rates']['Row']> &
          Pick<Database['public']['Tables']['exchange_rates']['Row'],
            'business_id' | 'from_currency' | 'to_currency' | 'rate' | 'rate_date'>;
        Update: Partial<Database['public']['Tables']['exchange_rates']['Row']>;
      };

      bank_statements: {
        Row: {
          id: string;
          business_id: string;
          account_id: string;
          statement_date: string;
          opening_balance: number;
          closing_balance: number;
          source: string | null;
          uploaded_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['bank_statements']['Row']> &
          Pick<Database['public']['Tables']['bank_statements']['Row'],
            'business_id' | 'account_id' | 'statement_date' | 'opening_balance' | 'closing_balance'>;
        Update: Partial<Database['public']['Tables']['bank_statements']['Row']>;
      };

      bank_statement_lines: {
        Row: {
          id: string;
          statement_id: string;
          business_id: string;
          transaction_date: string;
          description: string;
          reference: string | null;
          debit_amount: number;
          credit_amount: number;
          balance: number | null;
          is_reconciled: boolean;
          journal_line_id: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['bank_statement_lines']['Row']> &
          Pick<Database['public']['Tables']['bank_statement_lines']['Row'],
            'statement_id' | 'business_id' | 'transaction_date' | 'description' |
            'debit_amount' | 'credit_amount' | 'is_reconciled'>;
        Update: Partial<Database['public']['Tables']['bank_statement_lines']['Row']>;
      };

      journal_entries: {
        Row: {
          id: string;
          business_id: string;
          entry_number: string;
          entry_date: string;
          description: string;
          reference: string | null;
          source_type: string | null;
          source_id: string | null;
          currency: Currency;
          exchange_rate: number;
          status: JournalEntryStatus;
          reversal_of: string | null;
          reversed_by: string | null;
          branch_id: string | null;
          department_id: string | null;
          period_id: string | null;
          posted_by: string | null;
          posted_at: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['journal_entries']['Row']> &
          Pick<Database['public']['Tables']['journal_entries']['Row'],
            'business_id' | 'entry_number' | 'entry_date' | 'description' |
            'currency' | 'exchange_rate' | 'status'>;
        Update: Partial<Database['public']['Tables']['journal_entries']['Row']>;
      };

      journal_lines: {
        Row: {
          id: string;
          journal_entry_id: string;
          business_id: string;
          account_id: string;
          line_number: number;
          description: string | null;
          is_debit: boolean;
          amount: number;
          amount_base: number;
          currency: Currency;
          exchange_rate: number;
          tax_code: TaxCode | null;
          tax_amount: number;
          branch_id: string | null;
          department_id: string | null;
          reconciled: boolean;
          reconciled_at: string | null;
          created_at: string;
        };
        Insert: Partial<Database['public']['Tables']['journal_lines']['Row']> &
          Pick<Database['public']['Tables']['journal_lines']['Row'],
            'journal_entry_id' | 'business_id' | 'account_id' | 'line_number' |
            'is_debit' | 'amount' | 'amount_base' | 'currency' | 'exchange_rate' |
            'tax_amount' | 'reconciled'>;
        Update: Partial<Database['public']['Tables']['journal_lines']['Row']>;
      };

      audit_log: {
        Row: {
          id: number;
          business_id: string;
          user_id: string | null;
          user_email: string | null;
          event_type: string;
          resource_type: string;
          resource_id: string | null;
          resource_ref: string | null;
          old_values: Record<string, unknown> | null;
          new_values: Record<string, unknown> | null;
          changed_fields: string[] | null;
          ip_address: string | null;
          user_agent: string | null;
          session_id: string | null;
          notes: string | null;
          occurred_at: string;
        };
        Insert: Partial<Database['public']['Tables']['audit_log']['Row']> &
          Pick<Database['public']['Tables']['audit_log']['Row'],
            'business_id' | 'event_type' | 'resource_type' | 'occurred_at'>;
        Update: Partial<Database['public']['Tables']['audit_log']['Row']>;
      };

      // -----------------------------------------------------------------------
      // Views (read-only)
      // -----------------------------------------------------------------------

      v_trial_balance: {
        Row: {
          business_id: string | null;
          code: string | null;
          name: string | null;
          account_type: AccountType | null;
          account_subtype: AccountSubtype | null;
          normal_balance: string | null;
          total_debits: number | null;
          total_credits: number | null;
          balance: number | null;
        };
        Insert: never;
        Update: never;
      };

      v_ar_ageing: {
        Row: {
          business_id: string | null;
          contact_id: string | null;
          contact_name: string | null;
          invoice_id: string | null;
          invoice_number: string | null;
          issue_date: string | null;
          due_date: string | null;
          total_amount: number | null;
          amount_paid: number | null;
          amount_due: number | null;
          days_overdue: number | null;
          ageing_bucket: string | null;
          currency: Currency | null;
        };
        Insert: never;
        Update: never;
      };

      v_reorder_alerts: {
        Row: {
          business_id: string | null;
          product_id: string | null;
          sku: string | null;
          product_name: string | null;
          location_name: string | null;
          quantity_on_hand: number | null;
          quantity_reserved: number | null;
          quantity_available: number | null;
          reorder_level: number | null;
          reorder_quantity: number | null;
          average_cost: number | null;
          estimated_reorder_cost: number | null;
        };
        Insert: never;
        Update: never;
      };

      v_asset_register: {
        Row: {
          business_id: string | null;
          asset_number: string | null;
          name: string | null;
          category: string | null;
          depreciation_method: DepreciationMethod | null;
          acquisition_date: string | null;
          acquisition_cost: number | null;
          residual_value: number | null;
          depreciable_amount: number | null;
          accumulated_depreciation: number | null;
          net_book_value: number | null;
          last_depreciation_date: string | null;
          status: AssetStatus | null;
          branch: string | null;
          department: string | null;
        };
        Insert: never;
        Update: never;
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: {
      currency: Currency;
      account_type: AccountType;
      account_subtype: AccountSubtype;
      tax_code: TaxCode;
      payment_method: PaymentMethod;
      business_user_role: BusinessUserRole;
      invoice_status: InvoiceStatus;
      depreciation_method: DepreciationMethod;
      asset_status: AssetStatus;
      stock_movement_type: StockMovementType;
      payroll_run_status: PayrollRunStatus;
      journal_entry_status: JournalEntryStatus;
    };
  };
}

export type Tables = Database['public']['Tables'];
export type TableName = keyof Tables;
export type Row<T extends TableName> = Tables[T]['Row'];
export type InsertDto<T extends TableName> = Tables[T]['Insert'];
export type UpdateDto<T extends TableName> = Tables[T]['Update'];