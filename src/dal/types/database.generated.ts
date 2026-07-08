export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accounting_periods: {
        Row: {
          business_id: string
          closed_at: string | null
          closed_by: string | null
          created_at: string
          id: string
          is_closed: boolean
          name: string
          period_end: string
          period_start: string
          updated_at: string
        }
        Insert: {
          business_id: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          is_closed?: boolean
          name: string
          period_end: string
          period_start: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          id?: string
          is_closed?: boolean
          name?: string
          period_end?: string
          period_start?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_periods_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          account_subtype: Database["public"]["Enums"]["account_subtype"] | null
          account_type: Database["public"]["Enums"]["account_type"]
          bank_account_number: string | null
          bank_branch: string | null
          bank_name: string | null
          branch_id: string | null
          business_id: string
          code: string
          created_at: string
          currency: string
          deleted_at: string | null
          department_id: string | null
          description: string | null
          id: string
          is_active: boolean
          is_bank_account: boolean
          is_group: boolean
          is_system: boolean
          mobile_money_number: string | null
          mobile_money_type: string | null
          name: string
          normal_balance: string
          notes: string | null
          opening_balance: number
          opening_balance_date: string | null
          parent_id: string | null
          tax_code: Database["public"]["Enums"]["tax_code"] | null
          updated_at: string
        }
        Insert: {
          account_subtype?:
            | Database["public"]["Enums"]["account_subtype"]
            | null
          account_type: Database["public"]["Enums"]["account_type"]
          bank_account_number?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          branch_id?: string | null
          business_id: string
          code: string
          created_at?: string
          currency?: string
          deleted_at?: string | null
          department_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_bank_account?: boolean
          is_group?: boolean
          is_system?: boolean
          mobile_money_number?: string | null
          mobile_money_type?: string | null
          name: string
          normal_balance: string
          notes?: string | null
          opening_balance?: number
          opening_balance_date?: string | null
          parent_id?: string | null
          tax_code?: Database["public"]["Enums"]["tax_code"] | null
          updated_at?: string
        }
        Update: {
          account_subtype?:
            | Database["public"]["Enums"]["account_subtype"]
            | null
          account_type?: Database["public"]["Enums"]["account_type"]
          bank_account_number?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          branch_id?: string | null
          business_id?: string
          code?: string
          created_at?: string
          currency?: string
          deleted_at?: string | null
          department_id?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          is_bank_account?: boolean
          is_group?: boolean
          is_system?: boolean
          mobile_money_number?: string | null
          mobile_money_type?: string | null
          name?: string
          normal_balance?: string
          notes?: string | null
          opening_balance?: number
          opening_balance_date?: string | null
          parent_id?: string | null
          tax_code?: Database["public"]["Enums"]["tax_code"] | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "accounts_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_categories: {
        Row: {
          accumulated_dep_account_id: string | null
          asset_account_id: string | null
          business_id: string
          created_at: string
          dep_expense_account_id: string | null
          depreciation_method: Database["public"]["Enums"]["depreciation_method"]
          id: string
          is_active: boolean
          mra_depreciation_rate: number | null
          name: string
          residual_percent: number
          useful_life_years: number | null
        }
        Insert: {
          accumulated_dep_account_id?: string | null
          asset_account_id?: string | null
          business_id: string
          created_at?: string
          dep_expense_account_id?: string | null
          depreciation_method?: Database["public"]["Enums"]["depreciation_method"]
          id?: string
          is_active?: boolean
          mra_depreciation_rate?: number | null
          name: string
          residual_percent?: number
          useful_life_years?: number | null
        }
        Update: {
          accumulated_dep_account_id?: string | null
          asset_account_id?: string | null
          business_id?: string
          created_at?: string
          dep_expense_account_id?: string | null
          depreciation_method?: Database["public"]["Enums"]["depreciation_method"]
          id?: string
          is_active?: boolean
          mra_depreciation_rate?: number | null
          name?: string
          residual_percent?: number
          useful_life_years?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "asset_categories_accumulated_dep_account_id_fkey"
            columns: ["accumulated_dep_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_categories_asset_account_id_fkey"
            columns: ["asset_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_categories_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_categories_dep_expense_account_id_fkey"
            columns: ["dep_expense_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          business_id: string
          changed_fields: string[] | null
          entry_hash: string | null
          event_type: string
          id: number
          ip_address: unknown
          new_values: Json | null
          notes: string | null
          occurred_at: string
          old_values: Json | null
          prev_hash: string | null
          resource_id: string | null
          resource_ref: string | null
          resource_type: string
          session_id: string | null
          user_agent: string | null
          user_email: string | null
          user_id: string | null
        }
        Insert: {
          business_id: string
          changed_fields?: string[] | null
          entry_hash?: string | null
          event_type: string
          id?: number
          ip_address?: unknown
          new_values?: Json | null
          notes?: string | null
          occurred_at?: string
          old_values?: Json | null
          prev_hash?: string | null
          resource_id?: string | null
          resource_ref?: string | null
          resource_type: string
          session_id?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Update: {
          business_id?: string
          changed_fields?: string[] | null
          entry_hash?: string | null
          event_type?: string
          id?: number
          ip_address?: unknown
          new_values?: Json | null
          notes?: string | null
          occurred_at?: string
          old_values?: Json | null
          prev_hash?: string | null
          resource_id?: string | null
          resource_ref?: string | null
          resource_type?: string
          session_id?: string | null
          user_agent?: string | null
          user_email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      bank_statement_lines: {
        Row: {
          balance: number | null
          business_id: string
          created_at: string
          credit_amount: number
          debit_amount: number
          description: string
          id: string
          is_reconciled: boolean
          journal_line_id: string | null
          reference: string | null
          statement_id: string
          transaction_date: string
        }
        Insert: {
          balance?: number | null
          business_id: string
          created_at?: string
          credit_amount?: number
          debit_amount?: number
          description: string
          id?: string
          is_reconciled?: boolean
          journal_line_id?: string | null
          reference?: string | null
          statement_id: string
          transaction_date: string
        }
        Update: {
          balance?: number | null
          business_id?: string
          created_at?: string
          credit_amount?: number
          debit_amount?: number
          description?: string
          id?: string
          is_reconciled?: boolean
          journal_line_id?: string | null
          reference?: string | null
          statement_id?: string
          transaction_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_journal_line_id_fkey"
            columns: ["journal_line_id"]
            isOneToOne: false
            referencedRelation: "journal_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_statement_id_fkey"
            columns: ["statement_id"]
            isOneToOne: false
            referencedRelation: "bank_statements"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statements: {
        Row: {
          account_id: string
          business_id: string
          closing_balance: number
          created_at: string
          id: string
          opening_balance: number
          source: string | null
          statement_date: string
          uploaded_by: string | null
        }
        Insert: {
          account_id: string
          business_id: string
          closing_balance?: number
          created_at?: string
          id?: string
          opening_balance?: number
          source?: string | null
          statement_date: string
          uploaded_by?: string | null
        }
        Update: {
          account_id?: string
          business_id?: string
          closing_balance?: number
          created_at?: string
          id?: string
          opening_balance?: number
          source?: string | null
          statement_date?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_statements_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statements_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      branches: {
        Row: {
          business_id: string
          code: string | null
          created_at: string
          deleted_at: string | null
          id: string
          is_active: boolean
          location: string | null
          manager_id: string | null
          name: string
          updated_at: string
        }
        Insert: {
          business_id: string
          code?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          location?: string | null
          manager_id?: string | null
          name: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          code?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          location?: string | null
          manager_id?: string | null
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "branches_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      budget_lines: {
        Row: {
          account_id: string
          annual_total: number | null
          branch_id: string | null
          budget_id: string
          business_id: string
          created_at: string
          department_id: string | null
          id: string
          m01_amount: number
          m02_amount: number
          m03_amount: number
          m04_amount: number
          m05_amount: number
          m06_amount: number
          m07_amount: number
          m08_amount: number
          m09_amount: number
          m10_amount: number
          m11_amount: number
          m12_amount: number
          notes: string | null
        }
        Insert: {
          account_id: string
          annual_total?: number | null
          branch_id?: string | null
          budget_id: string
          business_id: string
          created_at?: string
          department_id?: string | null
          id?: string
          m01_amount?: number
          m02_amount?: number
          m03_amount?: number
          m04_amount?: number
          m05_amount?: number
          m06_amount?: number
          m07_amount?: number
          m08_amount?: number
          m09_amount?: number
          m10_amount?: number
          m11_amount?: number
          m12_amount?: number
          notes?: string | null
        }
        Update: {
          account_id?: string
          annual_total?: number | null
          branch_id?: string | null
          budget_id?: string
          business_id?: string
          created_at?: string
          department_id?: string | null
          id?: string
          m01_amount?: number
          m02_amount?: number
          m03_amount?: number
          m04_amount?: number
          m05_amount?: number
          m06_amount?: number
          m07_amount?: number
          m08_amount?: number
          m09_amount?: number
          m10_amount?: number
          m11_amount?: number
          m12_amount?: number
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "budget_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_budget_id_fkey"
            columns: ["budget_id"]
            isOneToOne: false
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      budgets: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          fiscal_year: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          period_end: string
          period_start: string
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          fiscal_year: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          period_end: string
          period_start: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          fiscal_year?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          period_end?: string
          period_start?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "budgets_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_users: {
        Row: {
          accepted_at: string | null
          branch_id: string | null
          business_id: string
          created_at: string
          id: string
          invitation_expires_at: string | null
          invitation_token: string | null
          invited_at: string | null
          invited_by: string | null
          is_active: boolean
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          branch_id?: string | null
          business_id: string
          created_at?: string
          id?: string
          invitation_expires_at?: string | null
          invitation_token?: string | null
          invited_at?: string | null
          invited_by?: string | null
          is_active?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          branch_id?: string | null
          business_id?: string
          created_at?: string
          id?: string
          invitation_expires_at?: string | null
          invitation_token?: string | null
          invited_at?: string | null
          invited_by?: string | null
          is_active?: boolean
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_users_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_users_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      businesses: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          base_currency: string
          brand_color: string | null
          city: string | null
          coa_template: string
          country: string | null
          created_at: string
          default_payment_method:
            | Database["public"]["Enums"]["payment_method"]
            | null
          deleted_at: string | null
          email: string | null
          expense_next_number: number
          expense_prefix: string | null
          financial_year_start: string
          id: string
          invoice_next_number: number
          invoice_prefix: string | null
          is_active: boolean
          logo_url: string | null
          name: string
          payroll_next_number: number
          payroll_prefix: string | null
          phone: string | null
          registration_number: string | null
          timezone: string
          tpin: string | null
          trading_name: string | null
          updated_at: string
          vat_number: string | null
          vat_period: string | null
          vat_registered: boolean
          website: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          base_currency?: string
          brand_color?: string | null
          city?: string | null
          coa_template?: string
          country?: string | null
          created_at?: string
          default_payment_method?:
            | Database["public"]["Enums"]["payment_method"]
            | null
          deleted_at?: string | null
          email?: string | null
          expense_next_number?: number
          expense_prefix?: string | null
          financial_year_start?: string
          id?: string
          invoice_next_number?: number
          invoice_prefix?: string | null
          is_active?: boolean
          logo_url?: string | null
          name: string
          payroll_next_number?: number
          payroll_prefix?: string | null
          phone?: string | null
          registration_number?: string | null
          timezone?: string
          tpin?: string | null
          trading_name?: string | null
          updated_at?: string
          vat_number?: string | null
          vat_period?: string | null
          vat_registered?: boolean
          website?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          base_currency?: string
          brand_color?: string | null
          city?: string | null
          coa_template?: string
          country?: string | null
          created_at?: string
          default_payment_method?:
            | Database["public"]["Enums"]["payment_method"]
            | null
          deleted_at?: string | null
          email?: string | null
          expense_next_number?: number
          expense_prefix?: string | null
          financial_year_start?: string
          id?: string
          invoice_next_number?: number
          invoice_prefix?: string | null
          is_active?: boolean
          logo_url?: string | null
          name?: string
          payroll_next_number?: number
          payroll_prefix?: string | null
          phone?: string | null
          registration_number?: string | null
          timezone?: string
          tpin?: string | null
          trading_name?: string | null
          updated_at?: string
          vat_number?: string | null
          vat_period?: string | null
          vat_registered?: boolean
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "businesses_base_currency_fkey"
            columns: ["base_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      contacts: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          ap_account_id: string | null
          ar_account_id: string | null
          business_id: string
          city: string | null
          contact_type: string
          country: string | null
          created_at: string
          credit_limit: number | null
          credit_terms_days: number | null
          currency: Database["public"]["Enums"]["currency_code"] | null
          deleted_at: string | null
          email: string | null
          id: string
          is_active: boolean
          mobile_money_number: string | null
          mobile_money_type: string | null
          name: string
          notes: string | null
          phone: string | null
          tpin: string | null
          trading_name: string | null
          updated_at: string
          vat_number: string | null
          wht_exempt: boolean
          wht_exemption_ref: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          ap_account_id?: string | null
          ar_account_id?: string | null
          business_id: string
          city?: string | null
          contact_type: string
          country?: string | null
          created_at?: string
          credit_limit?: number | null
          credit_terms_days?: number | null
          currency?: Database["public"]["Enums"]["currency_code"] | null
          deleted_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          mobile_money_number?: string | null
          mobile_money_type?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          tpin?: string | null
          trading_name?: string | null
          updated_at?: string
          vat_number?: string | null
          wht_exempt?: boolean
          wht_exemption_ref?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          ap_account_id?: string | null
          ar_account_id?: string | null
          business_id?: string
          city?: string | null
          contact_type?: string
          country?: string | null
          created_at?: string
          credit_limit?: number | null
          credit_terms_days?: number | null
          currency?: Database["public"]["Enums"]["currency_code"] | null
          deleted_at?: string | null
          email?: string | null
          id?: string
          is_active?: boolean
          mobile_money_number?: string | null
          mobile_money_type?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          tpin?: string | null
          trading_name?: string | null
          updated_at?: string
          vat_number?: string | null
          wht_exempt?: boolean
          wht_exemption_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_ap_account_id_fkey"
            columns: ["ap_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_ar_account_id_fkey"
            columns: ["ar_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      currencies: {
        Row: {
          code: string
          created_at: string
          decimal_places: number
          is_active: boolean
          is_frankfurter_supported: boolean
          is_primary: boolean
          name: string
          symbol: string
        }
        Insert: {
          code: string
          created_at?: string
          decimal_places?: number
          is_active?: boolean
          is_frankfurter_supported?: boolean
          is_primary?: boolean
          name: string
          symbol: string
        }
        Update: {
          code?: string
          created_at?: string
          decimal_places?: number
          is_active?: boolean
          is_frankfurter_supported?: boolean
          is_primary?: boolean
          name?: string
          symbol?: string
        }
        Relationships: []
      }
      departments: {
        Row: {
          branch_id: string | null
          business_id: string
          code: string | null
          cost_centre: string | null
          created_at: string
          deleted_at: string | null
          head_user_id: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          branch_id?: string | null
          business_id: string
          code?: string | null
          cost_centre?: string | null
          created_at?: string
          deleted_at?: string | null
          head_user_id?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          branch_id?: string | null
          business_id?: string
          code?: string | null
          cost_centre?: string | null
          created_at?: string
          deleted_at?: string | null
          head_user_id?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      depreciation_schedules: {
        Row: {
          accumulated_to_date: number
          asset_id: string
          business_id: string
          created_at: string
          depreciation_charge: number
          id: string
          journal_entry_id: string | null
          net_book_value: number
          period_end: string
          period_start: string
          posted: boolean
          posted_at: string | null
          posted_by: string | null
        }
        Insert: {
          accumulated_to_date: number
          asset_id: string
          business_id: string
          created_at?: string
          depreciation_charge: number
          id?: string
          journal_entry_id?: string | null
          net_book_value: number
          period_end: string
          period_start: string
          posted?: boolean
          posted_at?: string | null
          posted_by?: string | null
        }
        Update: {
          accumulated_to_date?: number
          asset_id?: string
          business_id?: string
          created_at?: string
          depreciation_charge?: number
          id?: string
          journal_entry_id?: string | null
          net_book_value?: number
          period_end?: string
          period_start?: string
          posted?: boolean
          posted_at?: string | null
          posted_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "depreciation_schedules_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "fixed_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depreciation_schedules_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depreciation_schedules_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_allowances: {
        Row: {
          amount: number
          business_id: string
          created_at: string
          effective_from: string
          effective_to: string | null
          employee_id: string
          id: string
          is_active: boolean
          is_taxable: boolean
          name: string
        }
        Insert: {
          amount?: number
          business_id: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          employee_id: string
          id?: string
          is_active?: boolean
          is_taxable?: boolean
          name: string
        }
        Update: {
          amount?: number
          business_id?: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          employee_id?: string
          id?: string
          is_active?: boolean
          is_taxable?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_allowances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_allowances_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_deductions: {
        Row: {
          amount: number
          business_id: string
          created_at: string
          deduction_type: string
          effective_from: string
          effective_to: string | null
          employee_id: string
          id: string
          is_active: boolean
          liability_account_id: string | null
          name: string
          percentage: number
          pre_tax: boolean
        }
        Insert: {
          amount?: number
          business_id: string
          created_at?: string
          deduction_type?: string
          effective_from?: string
          effective_to?: string | null
          employee_id: string
          id?: string
          is_active?: boolean
          liability_account_id?: string | null
          name: string
          percentage?: number
          pre_tax?: boolean
        }
        Update: {
          amount?: number
          business_id?: string
          created_at?: string
          deduction_type?: string
          effective_from?: string
          effective_to?: string | null
          employee_id?: string
          id?: string
          is_active?: boolean
          liability_account_id?: string | null
          name?: string
          percentage?: number
          pre_tax?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "employee_deductions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_deductions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_deductions_liability_account_id_fkey"
            columns: ["liability_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          bank_account_number: string | null
          bank_branch: string | null
          bank_name: string | null
          branch_id: string | null
          business_id: string
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          date_of_birth: string | null
          deleted_at: string | null
          department_id: string | null
          email: string | null
          employee_number: string
          employment_type: string
          end_date: string | null
          first_name: string
          gender: string | null
          gross_salary: number
          id: string
          is_active: boolean
          job_title: string | null
          last_name: string
          mobile_money_number: string | null
          mobile_money_type: string | null
          national_id: string | null
          notes: string | null
          pay_frequency: string
          paye_code: string | null
          paye_liability_account_id: string | null
          paye_tax_class: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          phone: string | null
          probation_end_date: string | null
          salary_account_id: string | null
          start_date: string
          tax_exempt: boolean
          tpin: string | null
          updated_at: string
        }
        Insert: {
          bank_account_number?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          branch_id?: string | null
          business_id: string
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          date_of_birth?: string | null
          deleted_at?: string | null
          department_id?: string | null
          email?: string | null
          employee_number: string
          employment_type?: string
          end_date?: string | null
          first_name: string
          gender?: string | null
          gross_salary?: number
          id?: string
          is_active?: boolean
          job_title?: string | null
          last_name: string
          mobile_money_number?: string | null
          mobile_money_type?: string | null
          national_id?: string | null
          notes?: string | null
          pay_frequency?: string
          paye_code?: string | null
          paye_liability_account_id?: string | null
          paye_tax_class?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          phone?: string | null
          probation_end_date?: string | null
          salary_account_id?: string | null
          start_date: string
          tax_exempt?: boolean
          tpin?: string | null
          updated_at?: string
        }
        Update: {
          bank_account_number?: string | null
          bank_branch?: string | null
          bank_name?: string | null
          branch_id?: string | null
          business_id?: string
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          date_of_birth?: string | null
          deleted_at?: string | null
          department_id?: string | null
          email?: string | null
          employee_number?: string
          employment_type?: string
          end_date?: string | null
          first_name?: string
          gender?: string | null
          gross_salary?: number
          id?: string
          is_active?: boolean
          job_title?: string | null
          last_name?: string
          mobile_money_number?: string | null
          mobile_money_type?: string | null
          national_id?: string | null
          notes?: string | null
          pay_frequency?: string
          paye_code?: string | null
          paye_liability_account_id?: string | null
          paye_tax_class?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          phone?: string | null
          probation_end_date?: string | null
          salary_account_id?: string | null
          start_date?: string
          tax_exempt?: boolean
          tpin?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_paye_liability_account_id_fkey"
            columns: ["paye_liability_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_salary_account_id_fkey"
            columns: ["salary_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_rates: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          from_currency: string
          id: string
          rate: number
          rate_date: string
          source: string | null
          to_currency: string
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          from_currency: string
          id?: string
          rate: number
          rate_date: string
          source?: string | null
          to_currency: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          from_currency?: string
          id?: string
          rate?: number
          rate_date?: string
          source?: string | null
          to_currency?: string
        }
        Relationships: [
          {
            foreignKeyName: "exchange_rates_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exchange_rates_from_currency_fkey"
            columns: ["from_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "exchange_rates_to_currency_fkey"
            columns: ["to_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      expense_lines: {
        Row: {
          account_id: string | null
          business_id: string
          created_at: string
          description: string
          expense_id: string
          id: string
          line_number: number
          line_subtotal: number | null
          line_total: number
          product_id: string | null
          quantity: number
          tax_amount: number
          tax_code: Database["public"]["Enums"]["tax_code"]
          tax_rate: number
          unit_price: number
        }
        Insert: {
          account_id?: string | null
          business_id: string
          created_at?: string
          description: string
          expense_id: string
          id?: string
          line_number: number
          line_subtotal?: number | null
          line_total?: number
          product_id?: string | null
          quantity?: number
          tax_amount?: number
          tax_code?: Database["public"]["Enums"]["tax_code"]
          tax_rate?: number
          unit_price?: number
        }
        Update: {
          account_id?: string | null
          business_id?: string
          created_at?: string
          description?: string
          expense_id?: string
          id?: string
          line_number?: number
          line_subtotal?: number | null
          line_total?: number
          product_id?: string | null
          quantity?: number
          tax_amount?: number
          tax_code?: Database["public"]["Enums"]["tax_code"]
          tax_rate?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "expense_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_lines_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_alerts"
            referencedColumns: ["product_id"]
          },
        ]
      }
      expense_payments: {
        Row: {
          amount: number
          bank_account_id: string | null
          business_id: string
          created_at: string
          created_by: string | null
          currency: string
          exchange_rate: number
          expense_id: string
          functional_amount: number | null
          id: string
          journal_entry_id: string | null
          notes: string | null
          original_amount: number | null
          original_currency: string | null
          payment_date: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          rate_date: string | null
          rate_is_stale: boolean
          reference: string | null
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          business_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          exchange_rate?: number
          expense_id: string
          functional_amount?: number | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          original_amount?: number | null
          original_currency?: string | null
          payment_date?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          rate_date?: string | null
          rate_is_stale?: boolean
          reference?: string | null
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          business_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          exchange_rate?: number
          expense_id?: string
          functional_amount?: number | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          original_amount?: number | null
          original_currency?: string | null
          payment_date?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          rate_date?: string | null
          rate_is_stale?: boolean
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expense_payments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_payments_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "expense_payments_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_payments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_payments_original_currency_fkey"
            columns: ["original_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      expenses: {
        Row: {
          amount_paid: number
          ap_account_id: string | null
          approved_at: string | null
          approved_by: string | null
          branch_id: string | null
          business_id: string
          contact_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          department_id: string | null
          due_date: string | null
          exchange_rate: number
          expense_date: string
          expense_number: string
          expense_type: string
          functional_amount: number | null
          id: string
          journal_entry_id: string | null
          notes: string | null
          original_amount: number | null
          original_currency: string | null
          rate_date: string | null
          rate_is_stale: boolean
          receipt_filename: string | null
          receipt_mime_type: string | null
          receipt_size_bytes: number | null
          receipt_url: string | null
          reference: string | null
          status: string
          subtotal: number
          total_amount: number
          updated_at: string
          vat_amount: number
          wht_amount: number
        }
        Insert: {
          amount_paid?: number
          ap_account_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          branch_id?: string | null
          business_id: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          department_id?: string | null
          due_date?: string | null
          exchange_rate?: number
          expense_date?: string
          expense_number: string
          expense_type?: string
          functional_amount?: number | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          original_amount?: number | null
          original_currency?: string | null
          rate_date?: string | null
          rate_is_stale?: boolean
          receipt_filename?: string | null
          receipt_mime_type?: string | null
          receipt_size_bytes?: number | null
          receipt_url?: string | null
          reference?: string | null
          status?: string
          subtotal?: number
          total_amount?: number
          updated_at?: string
          vat_amount?: number
          wht_amount?: number
        }
        Update: {
          amount_paid?: number
          ap_account_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          branch_id?: string | null
          business_id?: string
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          department_id?: string | null
          due_date?: string | null
          exchange_rate?: number
          expense_date?: string
          expense_number?: string
          expense_type?: string
          functional_amount?: number | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          original_amount?: number | null
          original_currency?: string | null
          rate_date?: string | null
          rate_is_stale?: boolean
          receipt_filename?: string | null
          receipt_mime_type?: string | null
          receipt_size_bytes?: number | null
          receipt_url?: string | null
          reference?: string | null
          status?: string
          subtotal?: number
          total_amount?: number
          updated_at?: string
          vat_amount?: number
          wht_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "expenses_ap_account_id_fkey"
            columns: ["ap_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_ar_ageing"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "expenses_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "expenses_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_original_currency_fkey"
            columns: ["original_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      fixed_assets: {
        Row: {
          accumulated_dep_account_id: string | null
          accumulated_depreciation: number
          acquisition_cost: number
          acquisition_date: string
          asset_account_id: string | null
          asset_number: string
          branch_id: string | null
          business_id: string
          category_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          dep_expense_account_id: string | null
          department_id: string | null
          depreciable_amount: number | null
          depreciation_method: Database["public"]["Enums"]["depreciation_method"]
          depreciation_rate: number | null
          depreciation_start_date: string
          description: string | null
          disposal_date: string | null
          disposal_journal_id: string | null
          disposal_proceeds: number | null
          id: string
          image_url: string | null
          insurance_expiry_date: string | null
          insurance_policy_number: string | null
          is_active: boolean
          last_depreciation_date: string | null
          location: string | null
          name: string
          net_book_value: number | null
          notes: string | null
          purchase_invoice_ref: string | null
          purchase_journal_id: string | null
          residual_value: number
          revaluation_date: string | null
          revaluation_surplus_account: string | null
          revalued_amount: number | null
          serial_number: string | null
          status: Database["public"]["Enums"]["asset_status"]
          supplier_id: string | null
          updated_at: string
          useful_life_months: number | null
          useful_life_years: number | null
          warranty_expiry_date: string | null
        }
        Insert: {
          accumulated_dep_account_id?: string | null
          accumulated_depreciation?: number
          acquisition_cost: number
          acquisition_date: string
          asset_account_id?: string | null
          asset_number: string
          branch_id?: string | null
          business_id: string
          category_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          dep_expense_account_id?: string | null
          department_id?: string | null
          depreciable_amount?: number | null
          depreciation_method?: Database["public"]["Enums"]["depreciation_method"]
          depreciation_rate?: number | null
          depreciation_start_date: string
          description?: string | null
          disposal_date?: string | null
          disposal_journal_id?: string | null
          disposal_proceeds?: number | null
          id?: string
          image_url?: string | null
          insurance_expiry_date?: string | null
          insurance_policy_number?: string | null
          is_active?: boolean
          last_depreciation_date?: string | null
          location?: string | null
          name: string
          net_book_value?: number | null
          notes?: string | null
          purchase_invoice_ref?: string | null
          purchase_journal_id?: string | null
          residual_value?: number
          revaluation_date?: string | null
          revaluation_surplus_account?: string | null
          revalued_amount?: number | null
          serial_number?: string | null
          status?: Database["public"]["Enums"]["asset_status"]
          supplier_id?: string | null
          updated_at?: string
          useful_life_months?: number | null
          useful_life_years?: number | null
          warranty_expiry_date?: string | null
        }
        Update: {
          accumulated_dep_account_id?: string | null
          accumulated_depreciation?: number
          acquisition_cost?: number
          acquisition_date?: string
          asset_account_id?: string | null
          asset_number?: string
          branch_id?: string | null
          business_id?: string
          category_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          dep_expense_account_id?: string | null
          department_id?: string | null
          depreciable_amount?: number | null
          depreciation_method?: Database["public"]["Enums"]["depreciation_method"]
          depreciation_rate?: number | null
          depreciation_start_date?: string
          description?: string | null
          disposal_date?: string | null
          disposal_journal_id?: string | null
          disposal_proceeds?: number | null
          id?: string
          image_url?: string | null
          insurance_expiry_date?: string | null
          insurance_policy_number?: string | null
          is_active?: boolean
          last_depreciation_date?: string | null
          location?: string | null
          name?: string
          net_book_value?: number | null
          notes?: string | null
          purchase_invoice_ref?: string | null
          purchase_journal_id?: string | null
          residual_value?: number
          revaluation_date?: string | null
          revaluation_surplus_account?: string | null
          revalued_amount?: number | null
          serial_number?: string | null
          status?: Database["public"]["Enums"]["asset_status"]
          supplier_id?: string | null
          updated_at?: string
          useful_life_months?: number | null
          useful_life_years?: number | null
          warranty_expiry_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fixed_assets_accumulated_dep_account_id_fkey"
            columns: ["accumulated_dep_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_asset_account_id_fkey"
            columns: ["asset_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "asset_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_dep_expense_account_id_fkey"
            columns: ["dep_expense_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_disposal_journal_id_fkey"
            columns: ["disposal_journal_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_purchase_journal_id_fkey"
            columns: ["purchase_journal_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_revaluation_surplus_account_fkey"
            columns: ["revaluation_surplus_account"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "v_ar_ageing"
            referencedColumns: ["contact_id"]
          },
        ]
      }
      fx_revaluations: {
        Row: {
          business_id: string
          closing_rate_source: string
          created_at: string
          created_by: string | null
          id: string
          journal_entry_id: string | null
          line_count: number
          revaluation_date: string
          reversal_entry_id: string | null
          status: string
          total_unrealised_gain: number
          total_unrealised_loss: number
        }
        Insert: {
          business_id: string
          closing_rate_source?: string
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          line_count?: number
          revaluation_date: string
          reversal_entry_id?: string | null
          status?: string
          total_unrealised_gain?: number
          total_unrealised_loss?: number
        }
        Update: {
          business_id?: string
          closing_rate_source?: string
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          line_count?: number
          revaluation_date?: string
          reversal_entry_id?: string | null
          status?: string
          total_unrealised_gain?: number
          total_unrealised_loss?: number
        }
        Relationships: [
          {
            foreignKeyName: "fx_revaluations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fx_revaluations_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fx_revaluations_reversal_entry_id_fkey"
            columns: ["reversal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_balances: {
        Row: {
          average_cost: number
          business_id: string
          id: string
          last_movement_at: string | null
          location_id: string
          product_id: string
          quantity_available: number | null
          quantity_on_hand: number
          quantity_reserved: number
          updated_at: string
        }
        Insert: {
          average_cost?: number
          business_id: string
          id?: string
          last_movement_at?: string | null
          location_id: string
          product_id: string
          quantity_available?: number | null
          quantity_on_hand?: number
          quantity_reserved?: number
          updated_at?: string
        }
        Update: {
          average_cost?: number
          business_id?: string
          id?: string
          last_movement_at?: string | null
          location_id?: string
          product_id?: string
          quantity_available?: number | null
          quantity_on_hand?: number
          quantity_reserved?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_balances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_alerts"
            referencedColumns: ["product_id"]
          },
        ]
      }
      inventory_locations: {
        Row: {
          branch_id: string | null
          business_id: string
          code: string | null
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          name: string
        }
        Insert: {
          branch_id?: string | null
          business_id: string
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name: string
        }
        Update: {
          branch_id?: string | null
          business_id?: string
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_locations_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_locations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          account_id: string | null
          business_id: string
          created_at: string
          description: string
          discount_percent: number
          id: string
          invoice_id: string
          line_number: number
          line_subtotal: number | null
          line_total: number
          product_id: string | null
          quantity: number
          tax_amount: number
          tax_code: Database["public"]["Enums"]["tax_code"]
          tax_rate: number
          unit_price: number
        }
        Insert: {
          account_id?: string | null
          business_id: string
          created_at?: string
          description: string
          discount_percent?: number
          id?: string
          invoice_id: string
          line_number: number
          line_subtotal?: number | null
          line_total?: number
          product_id?: string | null
          quantity?: number
          tax_amount?: number
          tax_code?: Database["public"]["Enums"]["tax_code"]
          tax_rate?: number
          unit_price?: number
        }
        Update: {
          account_id?: string | null
          business_id?: string
          created_at?: string
          description?: string
          discount_percent?: number
          id?: string
          invoice_id?: string
          line_number?: number
          line_subtotal?: number | null
          line_total?: number
          product_id?: string | null
          quantity?: number
          tax_amount?: number
          tax_code?: Database["public"]["Enums"]["tax_code"]
          tax_rate?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "fk_invoice_line_product"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_invoice_line_product"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_alerts"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "invoice_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ar_ageing"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      invoice_payments: {
        Row: {
          amount: number
          bank_account_id: string | null
          business_id: string
          created_at: string
          created_by: string | null
          currency: string
          exchange_rate: number
          functional_amount: number | null
          id: string
          invoice_id: string
          journal_entry_id: string | null
          notes: string | null
          original_amount: number | null
          original_currency: string | null
          payment_date: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          rate_date: string | null
          rate_is_stale: boolean
          reference: string | null
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          business_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          exchange_rate?: number
          functional_amount?: number | null
          id?: string
          invoice_id: string
          journal_entry_id?: string | null
          notes?: string | null
          original_amount?: number | null
          original_currency?: string | null
          payment_date?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          rate_date?: string | null
          rate_is_stale?: boolean
          reference?: string | null
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          business_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          exchange_rate?: number
          functional_amount?: number | null
          id?: string
          invoice_id?: string
          journal_entry_id?: string | null
          notes?: string | null
          original_amount?: number | null
          original_currency?: string | null
          payment_date?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          rate_date?: string | null
          rate_is_stale?: boolean
          reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_payments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ar_ageing"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_payments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_original_currency_fkey"
            columns: ["original_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      invoices: {
        Row: {
          amount_due: number | null
          amount_paid: number
          ar_account_id: string | null
          branch_id: string | null
          business_id: string
          contact_id: string
          created_at: string
          created_by: string | null
          credit_note_for: string | null
          currency: string
          deleted_at: string | null
          department_id: string | null
          discount_amount: number
          discount_percent: number
          due_date: string | null
          exchange_rate: number
          functional_amount: number | null
          id: string
          invoice_number: string
          invoice_type: string
          issue_date: string
          journal_entry_id: string | null
          notes: string | null
          original_amount: number | null
          original_currency: string | null
          po_number: string | null
          rate_date: string | null
          rate_is_stale: boolean
          revenue_account_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          taxable_amount: number
          terms: string | null
          total_amount: number
          updated_at: string
          vat_amount: number
          viewed_at: string | null
          wht_amount: number
        }
        Insert: {
          amount_due?: number | null
          amount_paid?: number
          ar_account_id?: string | null
          branch_id?: string | null
          business_id: string
          contact_id: string
          created_at?: string
          created_by?: string | null
          credit_note_for?: string | null
          currency?: string
          deleted_at?: string | null
          department_id?: string | null
          discount_amount?: number
          discount_percent?: number
          due_date?: string | null
          exchange_rate?: number
          functional_amount?: number | null
          id?: string
          invoice_number: string
          invoice_type?: string
          issue_date?: string
          journal_entry_id?: string | null
          notes?: string | null
          original_amount?: number | null
          original_currency?: string | null
          po_number?: string | null
          rate_date?: string | null
          rate_is_stale?: boolean
          revenue_account_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          taxable_amount?: number
          terms?: string | null
          total_amount?: number
          updated_at?: string
          vat_amount?: number
          viewed_at?: string | null
          wht_amount?: number
        }
        Update: {
          amount_due?: number | null
          amount_paid?: number
          ar_account_id?: string | null
          branch_id?: string | null
          business_id?: string
          contact_id?: string
          created_at?: string
          created_by?: string | null
          credit_note_for?: string | null
          currency?: string
          deleted_at?: string | null
          department_id?: string | null
          discount_amount?: number
          discount_percent?: number
          due_date?: string | null
          exchange_rate?: number
          functional_amount?: number | null
          id?: string
          invoice_number?: string
          invoice_type?: string
          issue_date?: string
          journal_entry_id?: string | null
          notes?: string | null
          original_amount?: number | null
          original_currency?: string | null
          po_number?: string | null
          rate_date?: string | null
          rate_is_stale?: boolean
          revenue_account_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          subtotal?: number
          taxable_amount?: number
          terms?: string | null
          total_amount?: number
          updated_at?: string
          vat_amount?: number
          viewed_at?: string | null
          wht_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoices_ar_account_id_fkey"
            columns: ["ar_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "v_ar_ageing"
            referencedColumns: ["contact_id"]
          },
          {
            foreignKeyName: "invoices_credit_note_for_fkey"
            columns: ["credit_note_for"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_credit_note_for_fkey"
            columns: ["credit_note_for"]
            isOneToOne: false
            referencedRelation: "v_ar_ageing"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoices_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "invoices_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_original_currency_fkey"
            columns: ["original_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "invoices_revenue_account_id_fkey"
            columns: ["revenue_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_entries: {
        Row: {
          branch_id: string | null
          business_id: string
          created_at: string
          created_by: string | null
          currency: string
          department_id: string | null
          description: string
          entry_date: string
          entry_number: string
          exchange_rate: number
          id: string
          period_id: string | null
          posted_at: string | null
          posted_by: string | null
          reference: string | null
          reversal_of: string | null
          reversed_by: string | null
          source_id: string | null
          source_type: string | null
          status: Database["public"]["Enums"]["journal_status"]
        }
        Insert: {
          branch_id?: string | null
          business_id: string
          created_at?: string
          created_by?: string | null
          currency?: string
          department_id?: string | null
          description: string
          entry_date: string
          entry_number: string
          exchange_rate?: number
          id?: string
          period_id?: string | null
          posted_at?: string | null
          posted_by?: string | null
          reference?: string | null
          reversal_of?: string | null
          reversed_by?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["journal_status"]
        }
        Update: {
          branch_id?: string | null
          business_id?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          department_id?: string | null
          description?: string
          entry_date?: string
          entry_number?: string
          exchange_rate?: number
          id?: string
          period_id?: string | null
          posted_at?: string | null
          posted_by?: string | null
          reference?: string | null
          reversal_of?: string | null
          reversed_by?: string | null
          source_id?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["journal_status"]
        }
        Relationships: [
          {
            foreignKeyName: "journal_entries_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "journal_entries_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "accounting_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      journal_lines: {
        Row: {
          account_id: string
          amount: number
          amount_base: number
          branch_id: string | null
          business_id: string
          created_at: string
          currency: string
          department_id: string | null
          description: string | null
          exchange_rate: number
          id: string
          is_debit: boolean
          journal_entry_id: string
          line_number: number
          original_amount: number | null
          original_currency: string | null
          rate_date: string | null
          rate_is_stale: boolean
          reconciled: boolean
          reconciled_at: string | null
          tax_amount: number
          tax_code: Database["public"]["Enums"]["tax_code"] | null
        }
        Insert: {
          account_id: string
          amount: number
          amount_base: number
          branch_id?: string | null
          business_id: string
          created_at?: string
          currency?: string
          department_id?: string | null
          description?: string | null
          exchange_rate?: number
          id?: string
          is_debit: boolean
          journal_entry_id: string
          line_number: number
          original_amount?: number | null
          original_currency?: string | null
          rate_date?: string | null
          rate_is_stale?: boolean
          reconciled?: boolean
          reconciled_at?: string | null
          tax_amount?: number
          tax_code?: Database["public"]["Enums"]["tax_code"] | null
        }
        Update: {
          account_id?: string
          amount?: number
          amount_base?: number
          branch_id?: string | null
          business_id?: string
          created_at?: string
          currency?: string
          department_id?: string | null
          description?: string | null
          exchange_rate?: number
          id?: string
          is_debit?: boolean
          journal_entry_id?: string
          line_number?: number
          original_amount?: number | null
          original_currency?: string | null
          rate_date?: string | null
          rate_is_stale?: boolean
          reconciled?: boolean
          reconciled_at?: string | null
          tax_amount?: number
          tax_code?: Database["public"]["Enums"]["tax_code"] | null
        }
        Relationships: [
          {
            foreignKeyName: "journal_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "journal_lines_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_original_currency_fkey"
            columns: ["original_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      paye_bands: {
        Row: {
          band_from: number
          band_label: string | null
          band_to: number | null
          business_id: string
          created_at: string
          effective_from: string
          effective_to: string | null
          fiscal_year: string
          id: string
          rate: number
        }
        Insert: {
          band_from: number
          band_label?: string | null
          band_to?: number | null
          business_id: string
          created_at?: string
          effective_from: string
          effective_to?: string | null
          fiscal_year: string
          id?: string
          rate: number
        }
        Update: {
          band_from?: number
          band_label?: string | null
          band_to?: number | null
          business_id?: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          fiscal_year?: string
          id?: string
          rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "paye_bands_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_employee_lines: {
        Row: {
          basic_salary: number
          business_id: string
          created_at: string
          employee_id: string
          gross_pay: number
          id: string
          net_pay: number
          notes: string | null
          other_deductions: number
          paid_at: string | null
          paye_bands_json: Json | null
          paye_deduction: number
          paye_taxable_income: number
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_ref: string | null
          payroll_run_id: string
          payslip_generated: boolean
          payslip_url: string | null
          pension_employee: number
          pension_employer: number
          total_allowances: number
          total_deductions: number
        }
        Insert: {
          basic_salary?: number
          business_id: string
          created_at?: string
          employee_id: string
          gross_pay?: number
          id?: string
          net_pay?: number
          notes?: string | null
          other_deductions?: number
          paid_at?: string | null
          paye_bands_json?: Json | null
          paye_deduction?: number
          paye_taxable_income?: number
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_ref?: string | null
          payroll_run_id: string
          payslip_generated?: boolean
          payslip_url?: string | null
          pension_employee?: number
          pension_employer?: number
          total_allowances?: number
          total_deductions?: number
        }
        Update: {
          basic_salary?: number
          business_id?: string
          created_at?: string
          employee_id?: string
          gross_pay?: number
          id?: string
          net_pay?: number
          notes?: string | null
          other_deductions?: number
          paid_at?: string | null
          paye_bands_json?: Json | null
          paye_deduction?: number
          paye_taxable_income?: number
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_ref?: string | null
          payroll_run_id?: string
          payslip_generated?: boolean
          payslip_url?: string | null
          pension_employee?: number
          pension_employer?: number
          total_allowances?: number
          total_deductions?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_employee_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_employee_lines_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_employee_lines_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          journal_entry_id: string | null
          notes: string | null
          pay_date: string
          paye_filed_at: string | null
          paye_return_ref: string | null
          payroll_period: string
          period_end: string
          period_start: string
          run_number: string
          status: Database["public"]["Enums"]["payroll_status"]
          total_gross: number
          total_net: number
          total_other_deductions: number
          total_paye: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          pay_date: string
          paye_filed_at?: string | null
          paye_return_ref?: string | null
          payroll_period: string
          period_end: string
          period_start: string
          run_number: string
          status?: Database["public"]["Enums"]["payroll_status"]
          total_gross?: number
          total_net?: number
          total_other_deductions?: number
          total_paye?: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          pay_date?: string
          paye_filed_at?: string | null
          paye_return_ref?: string | null
          payroll_period?: string
          period_end?: string
          period_start?: string
          run_number?: string
          status?: Database["public"]["Enums"]["payroll_status"]
          total_gross?: number
          total_net?: number
          total_other_deductions?: number
          total_paye?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      product_categories: {
        Row: {
          business_id: string
          created_at: string
          id: string
          name: string
          parent_id: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_categories_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string | null
          business_id: string
          category_id: string | null
          cogs_account_id: string | null
          created_at: string
          currency: Database["public"]["Enums"]["currency_code"]
          deleted_at: string | null
          description: string | null
          id: string
          image_url: string | null
          inventory_account_id: string | null
          is_active: boolean
          name: string
          product_type: string
          purchase_account_id: string | null
          purchase_price: number
          purchase_tax_code: Database["public"]["Enums"]["tax_code"]
          reorder_level: number | null
          reorder_quantity: number | null
          sale_price: number
          sales_account_id: string | null
          sales_tax_code: Database["public"]["Enums"]["tax_code"]
          sku: string | null
          track_inventory: boolean
          unit_of_measure: string | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          business_id: string
          category_id?: string | null
          cogs_account_id?: string | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          deleted_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          inventory_account_id?: string | null
          is_active?: boolean
          name: string
          product_type?: string
          purchase_account_id?: string | null
          purchase_price?: number
          purchase_tax_code?: Database["public"]["Enums"]["tax_code"]
          reorder_level?: number | null
          reorder_quantity?: number | null
          sale_price?: number
          sales_account_id?: string | null
          sales_tax_code?: Database["public"]["Enums"]["tax_code"]
          sku?: string | null
          track_inventory?: boolean
          unit_of_measure?: string | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          business_id?: string
          category_id?: string | null
          cogs_account_id?: string | null
          created_at?: string
          currency?: Database["public"]["Enums"]["currency_code"]
          deleted_at?: string | null
          description?: string | null
          id?: string
          image_url?: string | null
          inventory_account_id?: string | null
          is_active?: boolean
          name?: string
          product_type?: string
          purchase_account_id?: string | null
          purchase_price?: number
          purchase_tax_code?: Database["public"]["Enums"]["tax_code"]
          reorder_level?: number | null
          reorder_quantity?: number | null
          sale_price?: number
          sales_account_id?: string | null
          sales_tax_code?: Database["public"]["Enums"]["tax_code"]
          sku?: string | null
          track_inventory?: boolean
          unit_of_measure?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_cogs_account_id_fkey"
            columns: ["cogs_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_inventory_account_id_fkey"
            columns: ["inventory_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_purchase_account_id_fkey"
            columns: ["purchase_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_sales_account_id_fkey"
            columns: ["sales_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          full_name: string | null
          id: string
        }
        Insert: {
          full_name?: string | null
          id: string
        }
        Update: {
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      stock_movements: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          location_id: string
          movement_date: string
          movement_type: Database["public"]["Enums"]["stock_movement_type"]
          notes: string | null
          product_id: string
          quantity: number
          reference: string | null
          source_id: string | null
          source_type: string | null
          total_cost: number | null
          unit_cost: number
        }
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          location_id: string
          movement_date?: string
          movement_type: Database["public"]["Enums"]["stock_movement_type"]
          notes?: string | null
          product_id: string
          quantity: number
          reference?: string | null
          source_id?: string | null
          source_type?: string | null
          total_cost?: number | null
          unit_cost?: number
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          location_id?: string
          movement_date?: string
          movement_type?: Database["public"]["Enums"]["stock_movement_type"]
          notes?: string | null
          product_id?: string
          quantity?: number
          reference?: string | null
          source_id?: string | null
          source_type?: string | null
          total_cost?: number | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_alerts"
            referencedColumns: ["product_id"]
          },
        ]
      }
      stock_transfer_lines: {
        Row: {
          business_id: string
          created_at: string
          id: string
          notes: string | null
          product_id: string
          quantity_dispatched: number | null
          quantity_received: number | null
          quantity_requested: number
          transfer_id: string
          unit_cost: number
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          notes?: string | null
          product_id: string
          quantity_dispatched?: number | null
          quantity_received?: number | null
          quantity_requested: number
          transfer_id: string
          unit_cost?: number
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          product_id?: string
          quantity_dispatched?: number | null
          quantity_received?: number | null
          quantity_requested?: number
          transfer_id?: string
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfer_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "v_reorder_alerts"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_transfer_lines_transfer_id_fkey"
            columns: ["transfer_id"]
            isOneToOne: false
            referencedRelation: "stock_transfers"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_transfers: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          business_id: string
          created_at: string
          dispatched_at: string | null
          from_location_id: string
          id: string
          notes: string | null
          received_at: string | null
          received_by: string | null
          requested_by: string | null
          status: string
          to_location_id: string
          transfer_number: string
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          business_id: string
          created_at?: string
          dispatched_at?: string | null
          from_location_id: string
          id?: string
          notes?: string | null
          received_at?: string | null
          received_by?: string | null
          requested_by?: string | null
          status?: string
          to_location_id: string
          transfer_number: string
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          business_id?: string
          created_at?: string
          dispatched_at?: string | null
          from_location_id?: string
          id?: string
          notes?: string | null
          received_at?: string | null
          received_by?: string | null
          requested_by?: string | null
          status?: string
          to_location_id?: string
          transfer_number?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_transfers_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_alerts: {
        Row: {
          alert_type: Database["public"]["Enums"]["tax_alert_type"]
          business_id: string
          channel: Database["public"]["Enums"]["tax_alert_channel"]
          created_at: string
          id: string
          scheduled_for: string
          sent_at: string | null
          status: Database["public"]["Enums"]["tax_alert_status"]
          tax_return_id: string
        }
        Insert: {
          alert_type: Database["public"]["Enums"]["tax_alert_type"]
          business_id: string
          channel?: Database["public"]["Enums"]["tax_alert_channel"]
          created_at?: string
          id?: string
          scheduled_for: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["tax_alert_status"]
          tax_return_id: string
        }
        Update: {
          alert_type?: Database["public"]["Enums"]["tax_alert_type"]
          business_id?: string
          channel?: Database["public"]["Enums"]["tax_alert_channel"]
          created_at?: string
          id?: string
          scheduled_for?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["tax_alert_status"]
          tax_return_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_alerts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_alerts_tax_return_id_fkey"
            columns: ["tax_return_id"]
            isOneToOne: false
            referencedRelation: "tax_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_configurations: {
        Row: {
          business_id: string
          created_at: string
          description: string | null
          effective_from: string
          effective_to: string | null
          employee_rate: number | null
          employer_rate: number | null
          id: string
          is_active: boolean
          mra_reference: string | null
          name: string
          rate: number
          tax_code: Database["public"]["Enums"]["tax_code"]
          tax_payable_account_id: string | null
          tax_receivable_account_id: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          description?: string | null
          effective_from?: string
          effective_to?: string | null
          employee_rate?: number | null
          employer_rate?: number | null
          id?: string
          is_active?: boolean
          mra_reference?: string | null
          name: string
          rate?: number
          tax_code: Database["public"]["Enums"]["tax_code"]
          tax_payable_account_id?: string | null
          tax_receivable_account_id?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          description?: string | null
          effective_from?: string
          effective_to?: string | null
          employee_rate?: number | null
          employer_rate?: number | null
          id?: string
          is_active?: boolean
          mra_reference?: string | null
          name?: string
          rate?: number
          tax_code?: Database["public"]["Enums"]["tax_code"]
          tax_payable_account_id?: string | null
          tax_receivable_account_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_configurations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_configurations_tax_payable_account_id_fkey"
            columns: ["tax_payable_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_configurations_tax_receivable_account_id_fkey"
            columns: ["tax_receivable_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_payments: {
        Row: {
          amount: number
          bank_account_id: string | null
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          journal_entry_id: string | null
          notes: string | null
          payment_date: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          receipt_path: string | null
          reference: string | null
          tax_return_id: string
        }
        Insert: {
          amount: number
          bank_account_id?: string | null
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          payment_date?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          receipt_path?: string | null
          reference?: string | null
          tax_return_id: string
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          payment_date?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          receipt_path?: string | null
          reference?: string | null
          tax_return_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_payments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_payments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_payments_tax_return_id_fkey"
            columns: ["tax_return_id"]
            isOneToOne: false
            referencedRelation: "tax_returns"
            referencedColumns: ["id"]
          },
        ]
      }
      tax_returns: {
        Row: {
          amount_due: number
          amount_paid: number
          business_id: string
          created_at: string
          created_by: string | null
          due_date: string
          filed_at: string | null
          filed_ref: string | null
          gross_amount: number
          id: string
          input_tax: number
          journal_entry_id: string | null
          output_tax: number
          period_end: string
          period_label: string
          period_start: string
          source_id: string | null
          source_type: string | null
          status: Database["public"]["Enums"]["tax_return_status"]
          tax_code: Database["public"]["Enums"]["tax_code"]
          updated_at: string
        }
        Insert: {
          amount_due?: number
          amount_paid?: number
          business_id: string
          created_at?: string
          created_by?: string | null
          due_date: string
          filed_at?: string | null
          filed_ref?: string | null
          gross_amount?: number
          id?: string
          input_tax?: number
          journal_entry_id?: string | null
          output_tax?: number
          period_end: string
          period_label: string
          period_start: string
          source_id?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["tax_return_status"]
          tax_code: Database["public"]["Enums"]["tax_code"]
          updated_at?: string
        }
        Update: {
          amount_due?: number
          amount_paid?: number
          business_id?: string
          created_at?: string
          created_by?: string | null
          due_date?: string
          filed_at?: string | null
          filed_ref?: string | null
          gross_amount?: number
          id?: string
          input_tax?: number
          journal_entry_id?: string | null
          output_tax?: number
          period_end?: string
          period_label?: string
          period_start?: string
          source_id?: string | null
          source_type?: string | null
          status?: Database["public"]["Enums"]["tax_return_status"]
          tax_code?: Database["public"]["Enums"]["tax_code"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_returns_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_returns_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          deletion_finalized_at: string | null
          deletion_requested_at: string | null
          full_name: string
          id: string
          phone: string | null
          preferred_currency:
            | Database["public"]["Enums"]["currency_code"]
            | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          deletion_finalized_at?: string | null
          deletion_requested_at?: string | null
          full_name: string
          id: string
          phone?: string | null
          preferred_currency?:
            | Database["public"]["Enums"]["currency_code"]
            | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          deletion_finalized_at?: string | null
          deletion_requested_at?: string | null
          full_name?: string
          id?: string
          phone?: string | null
          preferred_currency?:
            | Database["public"]["Enums"]["currency_code"]
            | null
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_ar_ageing: {
        Row: {
          ageing_bucket: string | null
          amount_due: number | null
          amount_paid: number | null
          business_id: string | null
          contact_id: string | null
          contact_name: string | null
          currency: string | null
          days_overdue: number | null
          due_date: string | null
          invoice_id: string | null
          invoice_number: string | null
          issue_date: string | null
          total_amount: number | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
        ]
      }
      v_asset_register: {
        Row: {
          accumulated_depreciation: number | null
          acquisition_cost: number | null
          acquisition_date: string | null
          asset_number: string | null
          branch: string | null
          business_id: string | null
          category: string | null
          department: string | null
          depreciable_amount: number | null
          depreciation_method:
            | Database["public"]["Enums"]["depreciation_method"]
            | null
          last_depreciation_date: string | null
          name: string | null
          net_book_value: number | null
          residual_value: number | null
          status: Database["public"]["Enums"]["asset_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "fixed_assets_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      v_reorder_alerts: {
        Row: {
          average_cost: number | null
          business_id: string | null
          estimated_reorder_cost: number | null
          location_name: string | null
          product_id: string | null
          product_name: string | null
          quantity_available: number | null
          quantity_on_hand: number | null
          quantity_reserved: number | null
          reorder_level: number | null
          reorder_quantity: number | null
          sku: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_balances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      v_trial_balance: {
        Row: {
          account_subtype: Database["public"]["Enums"]["account_subtype"] | null
          account_type: Database["public"]["Enums"]["account_type"] | null
          balance: number | null
          business_id: string | null
          code: string | null
          name: string | null
          normal_balance: string | null
          total_credits: number | null
          total_debits: number | null
        }
        Relationships: [
          {
            foreignKeyName: "accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: Json }
      create_business_with_owner: {
        Args: {
          p_address_line1: string
          p_base_currency: string
          p_brand_color: string
          p_city: string
          p_country: string
          p_email: string
          p_expense_prefix: string
          p_financial_year_start: string
          p_invoice_prefix: string
          p_name: string
          p_payroll_prefix: string
          p_phone: string
          p_registration_number: string
          p_timezone: string
          p_tpin: string
          p_trading_name: string
          p_vat_number: string
          p_vat_registered: boolean
        }
        Returns: string
      }
      current_user_role: {
        Args: { p_business_id: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      get_enum_values: { Args: { enum_name: string }; Returns: string[] }
      get_user_role: {
        Args: { p_business_id: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      increment_amount_paid: {
        Args: { p_amount: number; p_id: string; p_table: string }
        Returns: undefined
      }
      invite_member: {
        Args: {
          p_business_id: string
          p_email: string
          p_role: Database["public"]["Enums"]["user_role"]
        }
        Returns: string
      }
      log_manual_audit_event: {
        Args: {
          p_business_id: string
          p_event_type: string
          p_new_values?: Json
          p_notes?: string
          p_old_values?: Json
          p_resource_id: string
          p_resource_ref?: string
          p_resource_type: string
        }
        Returns: undefined
      }
      seed_new_business: { Args: { p_biz: string }; Returns: undefined }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      user_has_role: {
        Args: {
          p_business_id: string
          p_min_role: Database["public"]["Enums"]["user_role"]
        }
        Returns: boolean
      }
      verify_audit_chain: {
        Args: { p_business_id: string; p_resource_type?: string }
        Returns: {
          chain_valid: boolean
          entry_hash: string
          event_type: string
          id: number
          occurred_at: string
          prev_hash: string
          resource_id: string
          resource_type: string
        }[]
      }
    }
    Enums: {
      account_subtype:
        | "current_asset"
        | "non_current_asset"
        | "fixed_asset"
        | "current_liability"
        | "non_current_liability"
        | "share_capital"
        | "retained_earnings"
        | "reserves"
        | "revenue"
        | "other_income"
        | "cost_of_sales"
        | "operating_expense"
        | "finance_cost"
        | "tax_expense"
        | "depreciation_amortisation"
      account_type: "asset" | "liability" | "equity" | "income" | "expense"
      asset_status:
        | "active"
        | "disposed"
        | "fully_depreciated"
        | "impaired"
        | "under_construction"
      currency_code:
        | "MWK"
        | "USD"
        | "EUR"
        | "GBP"
        | "ZAR"
        | "ZMW"
        | "TZS"
        | "KES"
        | "UGX"
      depreciation_method:
        | "straight_line"
        | "reducing_balance"
        | "units_of_production"
        | "sum_of_years_digits"
      invoice_status:
        | "draft"
        | "sent"
        | "partially_paid"
        | "paid"
        | "overdue"
        | "void"
        | "credit_note"
      journal_status: "draft" | "posted" | "reversed"
      payment_method:
        | "cash"
        | "bank_transfer"
        | "cheque"
        | "airtel_money"
        | "tnm_mpamba"
        | "card"
        | "other"
      payroll_status: "draft" | "approved" | "paid" | "void"
      stock_movement_type:
        | "purchase"
        | "sale"
        | "adjustment_in"
        | "adjustment_out"
        | "transfer_in"
        | "transfer_out"
        | "return_in"
        | "return_out"
        | "opening_balance"
        | "write_off"
      tax_alert_channel: "email" | "sms"
      tax_alert_status: "pending" | "sent" | "failed"
      tax_alert_type: "14_day" | "7_day" | "1_day" | "due_date"
      tax_code:
        | "vat_standard"
        | "vat_zero"
        | "vat_exempt"
        | "paye"
        | "wht_15"
        | "wht_20"
        | "wht_10"
        | "cit"
        | "fbt"
        | "none"
        | "tpr_pension"
      tax_return_status: "pending" | "filed" | "paid" | "overdue" | "void"
      user_role:
        | "owner"
        | "admin"
        | "accountant"
        | "payroll_manager"
        | "auditor"
        | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      account_subtype: [
        "current_asset",
        "non_current_asset",
        "fixed_asset",
        "current_liability",
        "non_current_liability",
        "share_capital",
        "retained_earnings",
        "reserves",
        "revenue",
        "other_income",
        "cost_of_sales",
        "operating_expense",
        "finance_cost",
        "tax_expense",
        "depreciation_amortisation",
      ],
      account_type: ["asset", "liability", "equity", "income", "expense"],
      asset_status: [
        "active",
        "disposed",
        "fully_depreciated",
        "impaired",
        "under_construction",
      ],
      currency_code: [
        "MWK",
        "USD",
        "EUR",
        "GBP",
        "ZAR",
        "ZMW",
        "TZS",
        "KES",
        "UGX",
      ],
      depreciation_method: [
        "straight_line",
        "reducing_balance",
        "units_of_production",
        "sum_of_years_digits",
      ],
      invoice_status: [
        "draft",
        "sent",
        "partially_paid",
        "paid",
        "overdue",
        "void",
        "credit_note",
      ],
      journal_status: ["draft", "posted", "reversed"],
      payment_method: [
        "cash",
        "bank_transfer",
        "cheque",
        "airtel_money",
        "tnm_mpamba",
        "card",
        "other",
      ],
      payroll_status: ["draft", "approved", "paid", "void"],
      stock_movement_type: [
        "purchase",
        "sale",
        "adjustment_in",
        "adjustment_out",
        "transfer_in",
        "transfer_out",
        "return_in",
        "return_out",
        "opening_balance",
        "write_off",
      ],
      tax_alert_channel: ["email", "sms"],
      tax_alert_status: ["pending", "sent", "failed"],
      tax_alert_type: ["14_day", "7_day", "1_day", "due_date"],
      tax_code: [
        "vat_standard",
        "vat_zero",
        "vat_exempt",
        "paye",
        "wht_15",
        "wht_20",
        "wht_10",
        "cit",
        "fbt",
        "none",
        "tpr_pension",
      ],
      tax_return_status: ["pending", "filed", "paid", "overdue", "void"],
      user_role: [
        "owner",
        "admin",
        "accountant",
        "payroll_manager",
        "auditor",
        "viewer",
      ],
    },
  },
} as const
