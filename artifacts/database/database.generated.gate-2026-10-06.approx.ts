/* eslint-disable */
// Pre-implementation gate artifact (2026-10-06) — catalog-faithful APPROXIMATE
// types regenerated from a disposable replay of ALL repository migrations
// (authoritative migration-derived schema, PostgreSQL 17.10).
// NOT the exact `supabase gen types typescript` output: exact CLI regeneration
// requires Docker (unavailable in the gate environment) or live Supabase access
// (BLOCKED). Tracked file src/dal/types/database.generated.ts was NOT overwritten.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]
export type Database = {
  public: {
    Tables: {
      accounting_period_events: {
        Row: {
          id: number
          business_id: string
          period_id: string
          action: string
          reason: string
          actor: string | null
          created_at: string
        },
        Insert: {
          "id?": number
          business_id: string
          period_id: string
          action: string
          reason: string
          "actor?": string | null
          "created_at?": string
        },
        Update: {
          "id?": number
          "business_id?": string
          "period_id?": string
          "action?": string
          "reason?": string
          "actor?": string | null
          "created_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "accounting_period_events_period_id_fkey"
            columns: ["period_id"]
            referencedRelation: "accounting_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_period_events_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
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
        },
        Insert: {
          business_id: string
          "closed_at?": string | null
          "closed_by?": string | null
          "created_at?": string
          "id?": string
          is_closed: boolean
          name: string
          period_end: string
          period_start: string
          "updated_at?": string
        },
        Update: {
          "business_id?": string
          "closed_at?": string | null
          "closed_by?": string | null
          "created_at?": string
          "id?": string
          "is_closed?": boolean
          "name?": string
          "period_end?": string
          "period_start?": string
          "updated_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "accounting_periods_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
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
        },
        Insert: {
          "account_subtype?": Database["public"]["Enums"]["account_subtype"] | null
          account_type: Database["public"]["Enums"]["account_type"]
          "bank_account_number?": string | null
          "bank_branch?": string | null
          "bank_name?": string | null
          "branch_id?": string | null
          business_id: string
          code: string
          "created_at?": string
          currency: string
          "deleted_at?": string | null
          "department_id?": string | null
          "description?": string | null
          "id?": string
          "is_active?": boolean
          is_bank_account: boolean
          is_group: boolean
          is_system: boolean
          "mobile_money_number?": string | null
          "mobile_money_type?": string | null
          name: string
          normal_balance: string
          "notes?": string | null
          opening_balance: number
          "opening_balance_date?": string | null
          "parent_id?": string | null
          "tax_code?": Database["public"]["Enums"]["tax_code"] | null
          "updated_at?": string
        },
        Update: {
          "account_subtype?": Database["public"]["Enums"]["account_subtype"] | null
          "account_type?": Database["public"]["Enums"]["account_type"]
          "bank_account_number?": string | null
          "bank_branch?": string | null
          "bank_name?": string | null
          "branch_id?": string | null
          "business_id?": string
          "code?": string
          "created_at?": string
          "currency?": string
          "deleted_at?": string | null
          "department_id?": string | null
          "description?": string | null
          "id?": string
          "is_active?": boolean
          "is_bank_account?": boolean
          "is_group?": boolean
          "is_system?": boolean
          "mobile_money_number?": string | null
          "mobile_money_type?": string | null
          "name?": string
          "normal_balance?": string
          "notes?": string | null
          "opening_balance?": number
          "opening_balance_date?": string | null
          "parent_id?": string | null
          "tax_code?": Database["public"]["Enums"]["tax_code"] | null
          "updated_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "accounts_currency_fkey"
            columns: ["currency"]
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "accounts_department_id_fkey"
            columns: ["department_id"]
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_branch_id_fkey"
            columns: ["branch_id"]
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_parent_id_fkey"
            columns: ["parent_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          }
        ]
      }
      ai_insights_usage: {
        Row: {
          user_id: string
          window_start: string
          count: number
        },
        Insert: {
          user_id: string
          window_start: string
          "count?": number
        },
        Update: {
          "user_id?": string
          "window_start?": string
          "count?": number
        },
        Relationships: []
      }
      api_keys: {
        Row: {
          id: string
          business_id: string
          name: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          created_by: string | null
          created_at: string
          revoked_at: string | null
        },
        Insert: {
          "id?": string
          business_id: string
          name: string
          key_hash: string
          key_prefix: string
          "last_used_at?": string | null
          "created_by?": string | null
          "created_at?": string
          "revoked_at?": string | null
        },
        Update: {
          "id?": string
          "business_id?": string
          "name?": string
          "key_hash?": string
          "key_prefix?": string
          "last_used_at?": string | null
          "created_by?": string | null
          "created_at?": string
          "revoked_at?": string | null
        },
        Relationships: [
          {
            foreignKeyName: "api_keys_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      api_usage: {
        Row: {
          id: string
          api_key: string | null
          count: number | null
          window_start: string | null
          created_at: string | null
          api_key_id: string | null
        },
        Insert: {
          "id?": string
          "api_key?": string | null
          "count?": number | null
          "window_start?": string | null
          "created_at?": string | null
          "api_key_id?": string | null
        },
        Update: {
          "id?": string
          "api_key?": string | null
          "count?": number | null
          "window_start?": string | null
          "created_at?": string | null
          "api_key_id?": string | null
        },
        Relationships: [
          {
            foreignKeyName: "api_usage_api_key_id_fkey"
            columns: ["api_key_id"]
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          }
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
          is_depreciable: boolean
          mra_depreciation_rate: number | null
          name: string
          residual_percent: number
          useful_life_years: number | null
        },
        Insert: {
          "accumulated_dep_account_id?": string | null
          "asset_account_id?": string | null
          business_id: string
          "created_at?": string
          "dep_expense_account_id?": string | null
          depreciation_method: Database["public"]["Enums"]["depreciation_method"]
          "id?": string
          "is_active?": boolean
          "is_depreciable?": boolean
          "mra_depreciation_rate?": number | null
          name: string
          residual_percent: number
          "useful_life_years?": number | null
        },
        Update: {
          "accumulated_dep_account_id?": string | null
          "asset_account_id?": string | null
          "business_id?": string
          "created_at?": string
          "dep_expense_account_id?": string | null
          "depreciation_method?": Database["public"]["Enums"]["depreciation_method"]
          "id?": string
          "is_active?": boolean
          "is_depreciable?": boolean
          "mra_depreciation_rate?": number | null
          "name?": string
          "residual_percent?": number
          "useful_life_years?": number | null
        },
        Relationships: [
          {
            foreignKeyName: "asset_categories_accumulated_dep_account_id_fkey"
            columns: ["accumulated_dep_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_categories_asset_account_id_fkey"
            columns: ["asset_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_categories_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_categories_dep_expense_account_id_fkey"
            columns: ["dep_expense_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          }
        ]
      }
      audit_log: {
        Row: {
          business_id: string
          changed_fields: string[] | null
          entry_hash: string | null
          event_type: string
          id: number
          ip_address: string
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
        },
        Insert: {
          business_id: string
          "changed_fields?": string[] | null
          "entry_hash?": string | null
          event_type: string
          "id?": number
          ip_address: string
          "new_values?": Json | null
          "notes?": string | null
          occurred_at: string
          "old_values?": Json | null
          "prev_hash?": string | null
          "resource_id?": string | null
          "resource_ref?": string | null
          resource_type: string
          "session_id?": string | null
          "user_agent?": string | null
          "user_email?": string | null
          "user_id?": string | null
        },
        Update: {
          "business_id?": string
          "changed_fields?": string[] | null
          "entry_hash?": string | null
          "event_type?": string
          "id?": number
          "ip_address?": string
          "new_values?": Json | null
          "notes?": string | null
          "occurred_at?": string
          "old_values?": Json | null
          "prev_hash?": string | null
          "resource_id?": string | null
          "resource_ref?": string | null
          "resource_type?": string
          "session_id?": string | null
          "user_agent?": string | null
          "user_email?": string | null
          "user_id?": string | null
        },
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
          match_method: string | null
          match_confidence: number | null
          locked_at: string | null
        },
        Insert: {
          "balance?": number | null
          business_id: string
          "created_at?": string
          credit_amount: number
          debit_amount: number
          description: string
          "id?": string
          is_reconciled: boolean
          "journal_line_id?": string | null
          "reference?": string | null
          statement_id: string
          transaction_date: string
          "match_method?": string | null
          "match_confidence?": number | null
          "locked_at?": string | null
        },
        Update: {
          "balance?": number | null
          "business_id?": string
          "created_at?": string
          "credit_amount?": number
          "debit_amount?": number
          "description?": string
          "id?": string
          "is_reconciled?": boolean
          "journal_line_id?": string | null
          "reference?": string | null
          "statement_id?": string
          "transaction_date?": string
          "match_method?": string | null
          "match_confidence?": number | null
          "locked_at?": string | null
        },
        Relationships: [
          {
            foreignKeyName: "bank_statement_lines_journal_line_id_fkey"
            columns: ["journal_line_id"]
            referencedRelation: "journal_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_statement_id_fkey"
            columns: ["statement_id"]
            referencedRelation: "bank_statements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statement_lines_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
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
          reconciled_at: string | null
          reconciled_by: string | null
          is_locked: boolean
          locked_at: string | null
        },
        Insert: {
          account_id: string
          business_id: string
          closing_balance: number
          "created_at?": string
          "id?": string
          opening_balance: number
          "source?": string | null
          statement_date: string
          "uploaded_by?": string | null
          "reconciled_at?": string | null
          "reconciled_by?": string | null
          "is_locked?": boolean
          "locked_at?": string | null
        },
        Update: {
          "account_id?": string
          "business_id?": string
          "closing_balance?": number
          "created_at?": string
          "id?": string
          "opening_balance?": number
          "source?": string | null
          "statement_date?": string
          "uploaded_by?": string | null
          "reconciled_at?": string | null
          "reconciled_by?": string | null
          "is_locked?": boolean
          "locked_at?": string | null
        },
        Relationships: [
          {
            foreignKeyName: "bank_statements_account_id_fkey"
            columns: ["account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statements_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
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
        },
        Insert: {
          business_id: string
          "code?": string | null
          "created_at?": string
          "deleted_at?": string | null
          "id?": string
          "is_active?": boolean
          "location?": string | null
          "manager_id?": string | null
          name: string
          "updated_at?": string
        },
        Update: {
          "business_id?": string
          "code?": string | null
          "created_at?": string
          "deleted_at?": string | null
          "id?": string
          "is_active?": boolean
          "location?": string | null
          "manager_id?": string | null
          "name?": string
          "updated_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "branches_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
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
        },
        Insert: {
          account_id: string
          "annual_total?": number | null
          "branch_id?": string | null
          budget_id: string
          business_id: string
          "created_at?": string
          "department_id?": string | null
          "id?": string
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
          "notes?": string | null
        },
        Update: {
          "account_id?": string
          "annual_total?": number | null
          "branch_id?": string | null
          "budget_id?": string
          "business_id?": string
          "created_at?": string
          "department_id?": string | null
          "id?": string
          "m01_amount?": number
          "m02_amount?": number
          "m03_amount?": number
          "m04_amount?": number
          "m05_amount?": number
          "m06_amount?": number
          "m07_amount?": number
          "m08_amount?": number
          "m09_amount?": number
          "m10_amount?": number
          "m11_amount?": number
          "m12_amount?": number
          "notes?": string | null
        },
        Relationships: [
          {
            foreignKeyName: "budget_lines_department_id_fkey"
            columns: ["department_id"]
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_account_id_fkey"
            columns: ["account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_branch_id_fkey"
            columns: ["branch_id"]
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_budget_id_fkey"
            columns: ["budget_id"]
            referencedRelation: "budgets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "budget_lines_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
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
        },
        Insert: {
          business_id: string
          "created_at?": string
          "created_by?": string | null
          fiscal_year: string
          "id?": string
          "is_active?": boolean
          name: string
          "notes?": string | null
          period_end: string
          period_start: string
          "updated_at?": string
        },
        Update: {
          "business_id?": string
          "created_at?": string
          "created_by?": string | null
          "fiscal_year?": string
          "id?": string
          "is_active?": boolean
          "name?": string
          "notes?": string | null
          "period_end?": string
          "period_start?": string
          "updated_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "budgets_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      business_invitations: {
        Row: {
          id: string
          business_id: string
          email: string | null
          role: Database["public"]["Enums"]["user_role"]
          token: string
          invited_by: string | null
          invited_at: string
          expires_at: string
          accepted_at: string | null
          accepted_by: string | null
          phone: string | null
          role_assignment_authorized: boolean
        },
        Insert: {
          "id?": string
          business_id: string
          "email?": string | null
          role: Database["public"]["Enums"]["user_role"]
          token: string
          "invited_by?": string | null
          "invited_at?": string
          "expires_at?": string
          "accepted_at?": string | null
          "accepted_by?": string | null
          "phone?": string | null
          "role_assignment_authorized?": boolean
        },
        Update: {
          "id?": string
          "business_id?": string
          "email?": string | null
          "role?": Database["public"]["Enums"]["user_role"]
          "token?": string
          "invited_by?": string | null
          "invited_at?": string
          "expires_at?": string
          "accepted_at?": string | null
          "accepted_by?": string | null
          "phone?": string | null
          "role_assignment_authorized?": boolean
        },
        Relationships: [
          {
            foreignKeyName: "business_invitations_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      business_terms_acceptances: {
        Row: {
          id: string
          business_id: string
          user_id: string
          terms_version: string
          accepted_at: string
          created_at: string
        },
        Insert: {
          "id?": string
          business_id: string
          user_id: string
          terms_version: string
          "accepted_at?": string
          "created_at?": string
        },
        Update: {
          "id?": string
          "business_id?": string
          "user_id?": string
          "terms_version?": string
          "accepted_at?": string
          "created_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "business_terms_acceptances_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
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
        },
        Insert: {
          "accepted_at?": string | null
          "branch_id?": string | null
          business_id: string
          "created_at?": string
          "id?": string
          "invitation_expires_at?": string | null
          "invitation_token?": string | null
          "invited_at?": string | null
          "invited_by?": string | null
          "is_active?": boolean
          role: Database["public"]["Enums"]["user_role"]
          "updated_at?": string
          user_id: string
        },
        Update: {
          "accepted_at?": string | null
          "branch_id?": string | null
          "business_id?": string
          "created_at?": string
          "id?": string
          "invitation_expires_at?": string | null
          "invitation_token?": string | null
          "invited_at?": string | null
          "invited_by?": string | null
          "is_active?": boolean
          "role?": Database["public"]["Enums"]["user_role"]
          "updated_at?": string
          "user_id?": string
        },
        Relationships: [
          {
            foreignKeyName: "business_users_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_users_branch_id_fkey"
            columns: ["branch_id"]
            referencedRelation: "branches"
            referencedColumns: ["id"]
          }
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
          default_payment_method: Database["public"]["Enums"]["payment_method"] | null
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
          plan_expires_at: string | null
          plan_tier: string
          plan_updated_at: string | null
          registration_number: string | null
          timezone: string
          tpin: string | null
          trading_name: string | null
          updated_at: string
          vat_number: string | null
          vat_period: string | null
          vat_registered: boolean
          website: string | null
        },
        Insert: {
          "address_line1?": string | null
          "address_line2?": string | null
          base_currency: string
          "brand_color?": string | null
          "city?": string | null
          coa_template: string
          "country?": string | null
          "created_at?": string
          "default_payment_method?": Database["public"]["Enums"]["payment_method"] | null
          "deleted_at?": string | null
          "email?": string | null
          expense_next_number: number
          "expense_prefix?": string | null
          financial_year_start: string
          "id?": string
          invoice_next_number: number
          "invoice_prefix?": string | null
          "is_active?": boolean
          "logo_url?": string | null
          name: string
          payroll_next_number: number
          "payroll_prefix?": string | null
          "phone?": string | null
          "plan_expires_at?": string | null
          "plan_tier?": string
          "plan_updated_at?": string | null
          "registration_number?": string | null
          timezone: string
          "tpin?": string | null
          "trading_name?": string | null
          "updated_at?": string
          "vat_number?": string | null
          "vat_period?": string | null
          vat_registered: boolean
          "website?": string | null
        },
        Update: {
          "address_line1?": string | null
          "address_line2?": string | null
          "base_currency?": string
          "brand_color?": string | null
          "city?": string | null
          "coa_template?": string
          "country?": string | null
          "created_at?": string
          "default_payment_method?": Database["public"]["Enums"]["payment_method"] | null
          "deleted_at?": string | null
          "email?": string | null
          "expense_next_number?": number
          "expense_prefix?": string | null
          "financial_year_start?": string
          "id?": string
          "invoice_next_number?": number
          "invoice_prefix?": string | null
          "is_active?": boolean
          "logo_url?": string | null
          "name?": string
          "payroll_next_number?": number
          "payroll_prefix?": string | null
          "phone?": string | null
          "plan_expires_at?": string | null
          "plan_tier?": string
          "plan_updated_at?": string | null
          "registration_number?": string | null
          "timezone?": string
          "tpin?": string | null
          "trading_name?": string | null
          "updated_at?": string
          "vat_number?": string | null
          "vat_period?": string | null
          "vat_registered?": boolean
          "website?": string | null
        },
        Relationships: [
          {
            foreignKeyName: "businesses_base_currency_fkey"
            columns: ["base_currency"]
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          }
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
        },
        Insert: {
          "address_line1?": string | null
          "address_line2?": string | null
          "ap_account_id?": string | null
          "ar_account_id?": string | null
          business_id: string
          "city?": string | null
          contact_type: string
          "country?": string | null
          "created_at?": string
          "credit_limit?": number | null
          "credit_terms_days?": number | null
          "currency?": Database["public"]["Enums"]["currency_code"] | null
          "deleted_at?": string | null
          "email?": string | null
          "id?": string
          "is_active?": boolean
          "mobile_money_number?": string | null
          "mobile_money_type?": string | null
          name: string
          "notes?": string | null
          "phone?": string | null
          "tpin?": string | null
          "trading_name?": string | null
          "updated_at?": string
          "vat_number?": string | null
          wht_exempt: boolean
          "wht_exemption_ref?": string | null
        },
        Update: {
          "address_line1?": string | null
          "address_line2?": string | null
          "ap_account_id?": string | null
          "ar_account_id?": string | null
          "business_id?": string
          "city?": string | null
          "contact_type?": string
          "country?": string | null
          "created_at?": string
          "credit_limit?": number | null
          "credit_terms_days?": number | null
          "currency?": Database["public"]["Enums"]["currency_code"] | null
          "deleted_at?": string | null
          "email?": string | null
          "id?": string
          "is_active?": boolean
          "mobile_money_number?": string | null
          "mobile_money_type?": string | null
          "name?": string
          "notes?": string | null
          "phone?": string | null
          "tpin?": string | null
          "trading_name?": string | null
          "updated_at?": string
          "vat_number?": string | null
          "wht_exempt?": boolean
          "wht_exemption_ref?": string | null
        },
        Relationships: [
          {
            foreignKeyName: "contacts_ap_account_id_fkey"
            columns: ["ap_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_ar_account_id_fkey"
            columns: ["ar_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      currencies: {
        Row: {
          code: string
          name: string
          symbol: string
          decimal_places: number
          is_active: boolean
          is_primary: boolean
          is_frankfurter_supported: boolean
          created_at: string
        },
        Insert: {
          code: string
          name: string
          "symbol?": string
          "decimal_places?": number
          "is_active?": boolean
          "is_primary?": boolean
          "is_frankfurter_supported?": boolean
          "created_at?": string
        },
        Update: {
          "code?": string
          "name?": string
          "symbol?": string
          "decimal_places?": number
          "is_active?": boolean
          "is_primary?": boolean
          "is_frankfurter_supported?": boolean
          "created_at?": string
        },
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
        },
        Insert: {
          "branch_id?": string | null
          business_id: string
          "code?": string | null
          "cost_centre?": string | null
          "created_at?": string
          "deleted_at?": string | null
          "head_user_id?": string | null
          "id?": string
          "is_active?": boolean
          name: string
          "updated_at?": string
        },
        Update: {
          "branch_id?": string | null
          "business_id?": string
          "code?": string | null
          "cost_centre?": string | null
          "created_at?": string
          "deleted_at?": string | null
          "head_user_id?": string | null
          "id?": string
          "is_active?": boolean
          "name?": string
          "updated_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "departments_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_branch_id_fkey"
            columns: ["branch_id"]
            referencedRelation: "branches"
            referencedColumns: ["id"]
          }
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
        },
        Insert: {
          accumulated_to_date: number
          asset_id: string
          business_id: string
          "created_at?": string
          depreciation_charge: number
          "id?": string
          "journal_entry_id?": string | null
          net_book_value: number
          period_end: string
          period_start: string
          posted: boolean
          "posted_at?": string | null
          "posted_by?": string | null
        },
        Update: {
          "accumulated_to_date?": number
          "asset_id?": string
          "business_id?": string
          "created_at?": string
          "depreciation_charge?": number
          "id?": string
          "journal_entry_id?": string | null
          "net_book_value?": number
          "period_end?": string
          "period_start?": string
          "posted?": boolean
          "posted_at?": string | null
          "posted_by?": string | null
        },
        Relationships: [
          {
            foreignKeyName: "depreciation_schedules_asset_id_fkey"
            columns: ["asset_id"]
            referencedRelation: "fixed_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depreciation_schedules_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depreciation_schedules_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
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
        },
        Insert: {
          amount: number
          business_id: string
          "created_at?": string
          effective_from: string
          "effective_to?": string | null
          employee_id: string
          "id?": string
          "is_active?": boolean
          is_taxable: boolean
          name: string
        },
        Update: {
          "amount?": number
          "business_id?": string
          "created_at?": string
          "effective_from?": string
          "effective_to?": string | null
          "employee_id?": string
          "id?": string
          "is_active?": boolean
          "is_taxable?": boolean
          "name?": string
        },
        Relationships: [
          {
            foreignKeyName: "employee_allowances_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_allowances_employee_id_fkey"
            columns: ["employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["id"]
          }
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
        },
        Insert: {
          amount: number
          business_id: string
          "created_at?": string
          deduction_type: string
          effective_from: string
          "effective_to?": string | null
          employee_id: string
          "id?": string
          "is_active?": boolean
          "liability_account_id?": string | null
          name: string
          percentage: number
          pre_tax: boolean
        },
        Update: {
          "amount?": number
          "business_id?": string
          "created_at?": string
          "deduction_type?": string
          "effective_from?": string
          "effective_to?": string | null
          "employee_id?": string
          "id?": string
          "is_active?": boolean
          "liability_account_id?": string | null
          "name?": string
          "percentage?": number
          "pre_tax?": boolean
        },
        Relationships: [
          {
            foreignKeyName: "employee_deductions_employee_id_fkey"
            columns: ["employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_deductions_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_deductions_liability_account_id_fkey"
            columns: ["liability_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          }
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
        },
        Insert: {
          "bank_account_number?": string | null
          "bank_branch?": string | null
          "bank_name?": string | null
          "branch_id?": string | null
          business_id: string
          "created_at?": string
          currency: Database["public"]["Enums"]["currency_code"]
          "date_of_birth?": string | null
          "deleted_at?": string | null
          "department_id?": string | null
          "email?": string | null
          employee_number: string
          employment_type: string
          "end_date?": string | null
          first_name: string
          "gender?": string | null
          gross_salary: number
          "id?": string
          "is_active?": boolean
          "job_title?": string | null
          last_name: string
          "mobile_money_number?": string | null
          "mobile_money_type?": string | null
          "national_id?": string | null
          "notes?": string | null
          pay_frequency: string
          "paye_code?": string | null
          "paye_liability_account_id?": string | null
          "paye_tax_class?": string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          "phone?": string | null
          "probation_end_date?": string | null
          "salary_account_id?": string | null
          start_date: string
          tax_exempt: boolean
          "tpin?": string | null
          "updated_at?": string
        },
        Update: {
          "bank_account_number?": string | null
          "bank_branch?": string | null
          "bank_name?": string | null
          "branch_id?": string | null
          "business_id?": string
          "created_at?": string
          "currency?": Database["public"]["Enums"]["currency_code"]
          "date_of_birth?": string | null
          "deleted_at?": string | null
          "department_id?": string | null
          "email?": string | null
          "employee_number?": string
          "employment_type?": string
          "end_date?": string | null
          "first_name?": string
          "gender?": string | null
          "gross_salary?": number
          "id?": string
          "is_active?": boolean
          "job_title?": string | null
          "last_name?": string
          "mobile_money_number?": string | null
          "mobile_money_type?": string | null
          "national_id?": string | null
          "notes?": string | null
          "pay_frequency?": string
          "paye_code?": string | null
          "paye_liability_account_id?": string | null
          "paye_tax_class?": string | null
          "payment_method?": Database["public"]["Enums"]["payment_method"]
          "phone?": string | null
          "probation_end_date?": string | null
          "salary_account_id?": string | null
          "start_date?": string
          "tax_exempt?": boolean
          "tpin?": string | null
          "updated_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "employees_department_id_fkey"
            columns: ["department_id"]
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_paye_liability_account_id_fkey"
            columns: ["paye_liability_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_branch_id_fkey"
            columns: ["branch_id"]
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_salary_account_id_fkey"
            columns: ["salary_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      exchange_rates: {
        Row: {
          id: string
          business_id: string
          from_currency: string
          to_currency: string
          rate: number
          rate_date: string
          source: string
          created_by: string | null
          created_at: string
        },
        Insert: {
          "id?": string
          business_id: string
          from_currency: string
          to_currency: string
          rate: number
          rate_date: string
          "source?": string
          "created_by?": string | null
          "created_at?": string
        },
        Update: {
          "id?": string
          "business_id?": string
          "from_currency?": string
          "to_currency?": string
          "rate?": number
          "rate_date?": string
          "source?": string
          "created_by?": string | null
          "created_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "exchange_rates_from_currency_fkey"
            columns: ["from_currency"]
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "exchange_rates_to_currency_fkey"
            columns: ["to_currency"]
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "exchange_rates_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      expense_lines: {
        Row: {
          account_id: string | null
          business_id: string
          created_at: string
          description: string
          discount_amount: number
          discount_percent: number
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
        },
        Insert: {
          "account_id?": string | null
          business_id: string
          "created_at?": string
          description: string
          "discount_amount?": number
          "discount_percent?": number
          expense_id: string
          "id?": string
          line_number: number
          "line_subtotal?": number | null
          line_total: number
          "product_id?": string | null
          quantity: number
          tax_amount: number
          tax_code: Database["public"]["Enums"]["tax_code"]
          tax_rate: number
          unit_price: number
        },
        Update: {
          "account_id?": string | null
          "business_id?": string
          "created_at?": string
          "description?": string
          "discount_amount?": number
          "discount_percent?": number
          "expense_id?": string
          "id?": string
          "line_number?": number
          "line_subtotal?": number | null
          "line_total?": number
          "product_id?": string | null
          "quantity?": number
          "tax_amount?": number
          "tax_code?": Database["public"]["Enums"]["tax_code"]
          "tax_rate?": number
          "unit_price?": number
        },
        Relationships: [
          {
            foreignKeyName: "expense_lines_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_lines_product_id_fkey"
            columns: ["product_id"]
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_lines_expense_id_fkey"
            columns: ["expense_id"]
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_lines_account_id_fkey"
            columns: ["account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          }
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
          exchange_rate_used: number | null
          functional_currency: string | null
          client_key: string | null
        },
        Insert: {
          amount: number
          "bank_account_id?": string | null
          business_id: string
          "created_at?": string
          "created_by?": string | null
          currency: string
          exchange_rate: number
          expense_id: string
          "functional_amount?": number | null
          "id?": string
          "journal_entry_id?": string | null
          "notes?": string | null
          "original_amount?": number | null
          "original_currency?": string | null
          payment_date: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          "rate_date?": string | null
          "rate_is_stale?": boolean
          "reference?": string | null
          "exchange_rate_used?": number | null
          "functional_currency?": string | null
          "client_key?": string | null
        },
        Update: {
          "amount?": number
          "bank_account_id?": string | null
          "business_id?": string
          "created_at?": string
          "created_by?": string | null
          "currency?": string
          "exchange_rate?": number
          "expense_id?": string
          "functional_amount?": number | null
          "id?": string
          "journal_entry_id?": string | null
          "notes?": string | null
          "original_amount?": number | null
          "original_currency?": string | null
          "payment_date?": string
          "payment_method?": Database["public"]["Enums"]["payment_method"]
          "rate_date?": string | null
          "rate_is_stale?": boolean
          "reference?": string | null
          "exchange_rate_used?": number | null
          "functional_currency?": string | null
          "client_key?": string | null
        },
        Relationships: [
          {
            foreignKeyName: "expense_payments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_payments_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_payments_currency_fkey"
            columns: ["currency"]
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "expense_payments_expense_id_fkey"
            columns: ["expense_id"]
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_payments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_payments_original_currency_fkey"
            columns: ["original_currency"]
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "expense_payments_functional_currency_fkey"
            columns: ["functional_currency"]
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          }
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
          discount_amount: number
          discount_percent: number
          total_amount: number
          updated_at: string
          vat_amount: number
          wht_amount: number
          exchange_rate_used: number | null
          functional_currency: string | null
          client_key: string | null
        },
        Insert: {
          amount_paid: number
          "ap_account_id?": string | null
          "approved_at?": string | null
          "approved_by?": string | null
          "branch_id?": string | null
          business_id: string
          "contact_id?": string | null
          "created_at?": string
          "created_by?": string | null
          currency: string
          "deleted_at?": string | null
          "department_id?": string | null
          "due_date?": string | null
          exchange_rate: number
          expense_date: string
          expense_number: string
          expense_type: string
          "functional_amount?": number | null
          "id?": string
          "journal_entry_id?": string | null
          "notes?": string | null
          "original_amount?": number | null
          "original_currency?": string | null
          "rate_date?": string | null
          "rate_is_stale?": boolean
          "receipt_filename?": string | null
          "receipt_mime_type?": string | null
          "receipt_size_bytes?": number | null
          "receipt_url?": string | null
          "reference?": string | null
          status: string
          subtotal: number
          "discount_amount?": number
          "discount_percent?": number
          total_amount: number
          "updated_at?": string
          vat_amount: number
          wht_amount: number
          "exchange_rate_used?": number | null
          "functional_currency?": string | null
          "client_key?": string | null
        },
        Update: {
          "amount_paid?": number
          "ap_account_id?": string | null
          "approved_at?": string | null
          "approved_by?": string | null
          "branch_id?": string | null
          "business_id?": string
          "contact_id?": string | null
          "created_at?": string
          "created_by?": string | null
          "currency?": string
          "deleted_at?": string | null
          "department_id?": string | null
          "due_date?": string | null
          "exchange_rate?": number
          "expense_date?": string
          "expense_number?": string
          "expense_type?": string
          "functional_amount?": number | null
          "id?": string
          "journal_entry_id?": string | null
          "notes?": string | null
          "original_amount?": number | null
          "original_currency?": string | null
          "rate_date?": string | null
          "rate_is_stale?": boolean
          "receipt_filename?": string | null
          "receipt_mime_type?": string | null
          "receipt_size_bytes?": number | null
          "receipt_url?": string | null
          "reference?": string | null
          "status?": string
          "subtotal?": number
          "discount_amount?": number
          "discount_percent?": number
          "total_amount?": number
          "updated_at?": string
          "vat_amount?": number
          "wht_amount?": number
          "exchange_rate_used?": number | null
          "functional_currency?": string | null
          "client_key?": string | null
        },
        Relationships: [
          {
            foreignKeyName: "expenses_branch_id_fkey"
            columns: ["branch_id"]
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_contact_id_fkey"
            columns: ["contact_id"]
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_currency_fkey"
            columns: ["currency"]
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "expenses_department_id_fkey"
            columns: ["department_id"]
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_original_currency_fkey"
            columns: ["original_currency"]
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "expenses_functional_currency_fkey"
            columns: ["functional_currency"]
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "expenses_ap_account_id_fkey"
            columns: ["ap_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
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
          is_depreciable: boolean
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
        },
        Insert: {
          "accumulated_dep_account_id?": string | null
          accumulated_depreciation: number
          acquisition_cost: number
          acquisition_date: string
          "asset_account_id?": string | null
          asset_number: string
          "branch_id?": string | null
          business_id: string
          category_id: string
          "created_at?": string
          "created_by?": string | null
          "deleted_at?": string | null
          "dep_expense_account_id?": string | null
          "department_id?": string | null
          "depreciable_amount?": number | null
          depreciation_method: Database["public"]["Enums"]["depreciation_method"]
          "depreciation_rate?": number | null
          depreciation_start_date: string
          "description?": string | null
          "disposal_date?": string | null
          "disposal_journal_id?": string | null
          "disposal_proceeds?": number | null
          "id?": string
          "image_url?": string | null
          "insurance_expiry_date?": string | null
          "insurance_policy_number?": string | null
          "is_active?": boolean
          "is_depreciable?": boolean
          "last_depreciation_date?": string | null
          "location?": string | null
          name: string
          "net_book_value?": number | null
          "notes?": string | null
          "purchase_invoice_ref?": string | null
          "purchase_journal_id?": string | null
          residual_value: number
          "revaluation_date?": string | null
          "revaluation_surplus_account?": string | null
          "revalued_amount?": number | null
          "serial_number?": string | null
          status: Database["public"]["Enums"]["asset_status"]
          "supplier_id?": string | null
          "updated_at?": string
          "useful_life_months?": number | null
          "useful_life_years?": number | null
          "warranty_expiry_date?": string | null
        },
        Update: {
          "accumulated_dep_account_id?": string | null
          "accumulated_depreciation?": number
          "acquisition_cost?": number
          "acquisition_date?": string
          "asset_account_id?": string | null
          "asset_number?": string
          "branch_id?": string | null
          "business_id?": string
          "category_id?": string
          "created_at?": string
          "created_by?": string | null
          "deleted_at?": string | null
          "dep_expense_account_id?": string | null
          "department_id?": string | null
          "depreciable_amount?": number | null
          "depreciation_method?": Database["public"]["Enums"]["depreciation_method"]
          "depreciation_rate?": number | null
          "depreciation_start_date?": string
          "description?": string | null
          "disposal_date?": string | null
          "disposal_journal_id?": string | null
          "disposal_proceeds?": number | null
          "id?": string
          "image_url?": string | null
          "insurance_expiry_date?": string | null
          "insurance_policy_number?": string | null
          "is_active?": boolean
          "is_depreciable?": boolean
          "last_depreciation_date?": string | null
          "location?": string | null
          "name?": string
          "net_book_value?": number | null
          "notes?": string | null
          "purchase_invoice_ref?": string | null
          "purchase_journal_id?": string | null
          "residual_value?": number
          "revaluation_date?": string | null
          "revaluation_surplus_account?": string | null
          "revalued_amount?": number | null
          "serial_number?": string | null
          "status?": Database["public"]["Enums"]["asset_status"]
          "supplier_id?": string | null
          "updated_at?": string
          "useful_life_months?": number | null
          "useful_life_years?": number | null
          "warranty_expiry_date?": string | null
        },
        Relationships: [
          {
            foreignKeyName: "fixed_assets_supplier_id_fkey"
            columns: ["supplier_id"]
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_department_id_fkey"
            columns: ["department_id"]
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_dep_expense_account_id_fkey"
            columns: ["dep_expense_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_category_id_fkey"
            columns: ["category_id"]
            referencedRelation: "asset_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_branch_id_fkey"
            columns: ["branch_id"]
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_asset_account_id_fkey"
            columns: ["asset_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_accumulated_dep_account_id_fkey"
            columns: ["accumulated_dep_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_disposal_journal_id_fkey"
            columns: ["disposal_journal_id"]
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_purchase_journal_id_fkey"
            columns: ["purchase_journal_id"]
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_revaluation_surplus_account_fkey"
            columns: ["revaluation_surplus_account"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          }
        ]
      }
      fx_revaluations: {
        Row: {
          id: string
          business_id: string
          revaluation_date: string
          journal_entry_id: string | null
          reversal_entry_id: string | null
          total_unrealised_gain: number
          total_unrealised_loss: number
          line_count: number
          closing_rate_source: string
          status: string
          created_by: string | null
          created_at: string
        },
        Insert: {
          "id?": string
          business_id: string
          revaluation_date: string
          "journal_entry_id?": string | null
          "reversal_entry_id?": string | null
          "total_unrealised_gain?": number
          "total_unrealised_loss?": number
          "line_count?": number
          "closing_rate_source?": string
          "status?": string
          "created_by?": string | null
          "created_at?": string
        },
        Update: {
          "id?": string
          "business_id?": string
          "revaluation_date?": string
          "journal_entry_id?": string | null
          "reversal_entry_id?": string | null
          "total_unrealised_gain?": number
          "total_unrealised_loss?": number
          "line_count?": number
          "closing_rate_source?": string
          "status?": string
          "created_by?": string | null
          "created_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "fx_revaluations_reversal_entry_id_fkey"
            columns: ["reversal_entry_id"]
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fx_revaluations_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fx_revaluations_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          }
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
        },
        Insert: {
          average_cost: number
          business_id: string
          "id?": string
          "last_movement_at?": string | null
          location_id: string
          product_id: string
          "quantity_available?": number | null
          quantity_on_hand: number
          quantity_reserved: number
          "updated_at?": string
        },
        Update: {
          "average_cost?": number
          "business_id?": string
          "id?": string
          "last_movement_at?": string | null
          "location_id?": string
          "product_id?": string
          "quantity_available?": number | null
          "quantity_on_hand?": number
          "quantity_reserved?": number
          "updated_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "inventory_balances_product_id_fkey"
            columns: ["product_id"]
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_location_id_fkey"
            columns: ["location_id"]
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          }
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
        },
        Insert: {
          "branch_id?": string | null
          business_id: string
          "code?": string | null
          "created_at?": string
          "id?": string
          "is_active?": boolean
          is_default: boolean
          name: string
        },
        Update: {
          "branch_id?": string | null
          "business_id?": string
          "code?": string | null
          "created_at?": string
          "id?": string
          "is_active?": boolean
          "is_default?": boolean
          "name?": string
        },
        Relationships: [
          {
            foreignKeyName: "inventory_locations_branch_id_fkey"
            columns: ["branch_id"]
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_locations_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      invoice_approval_policies: {
        Row: {
          business_id: string
          enabled: boolean
          threshold: number | null
          roles: string[]
          updated_by: string | null
          updated_at: string
        },
        Insert: {
          business_id: string
          "enabled?": boolean
          "threshold?": number | null
          "roles?": string[]
          "updated_by?": string | null
          "updated_at?": string
        },
        Update: {
          "business_id?": string
          "enabled?": boolean
          "threshold?": number | null
          "roles?": string[]
          "updated_by?": string | null
          "updated_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "invoice_approval_policies_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      invoice_approvals: {
        Row: {
          id: string
          business_id: string
          invoice_id: string
          approved_by: string
          approved_at: string
          note: string | null
          revoked_at: string | null
          revoked_reason: string | null
        },
        Insert: {
          "id?": string
          business_id: string
          invoice_id: string
          approved_by: string
          "approved_at?": string
          "note?": string | null
          "revoked_at?": string | null
          "revoked_reason?": string | null
        },
        Update: {
          "id?": string
          "business_id?": string
          "invoice_id?": string
          "approved_by?": string
          "approved_at?": string
          "note?": string | null
          "revoked_at?": string | null
          "revoked_reason?": string | null
        },
        Relationships: [
          {
            foreignKeyName: "invoice_approvals_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_approvals_invoice_id_fkey"
            columns: ["invoice_id"]
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          }
        ]
      }
      invoice_delivery_events: {
        Row: {
          id: string
          business_id: string
          invoice_id: string
          event_type: string
          reminder_stage: string | null
          occurred_at: string
          metadata: Json
        },
        Insert: {
          "id?": string
          business_id: string
          invoice_id: string
          event_type: string
          "reminder_stage?": string | null
          "occurred_at?": string
          "metadata?": Json
        },
        Update: {
          "id?": string
          "business_id?": string
          "invoice_id?": string
          "event_type?": string
          "reminder_stage?": string | null
          "occurred_at?": string
          "metadata?": Json
        },
        Relationships: [
          {
            foreignKeyName: "invoice_delivery_events_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_delivery_events_invoice_id_fkey"
            columns: ["invoice_id"]
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          }
        ]
      }
      invoice_lines: {
        Row: {
          account_id: string | null
          business_id: string
          created_at: string
          description: string
          discount_amount: number
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
        },
        Insert: {
          "account_id?": string | null
          business_id: string
          "created_at?": string
          description: string
          "discount_amount?": number
          discount_percent: number
          "id?": string
          invoice_id: string
          line_number: number
          "line_subtotal?": number | null
          line_total: number
          "product_id?": string | null
          quantity: number
          tax_amount: number
          tax_code: Database["public"]["Enums"]["tax_code"]
          tax_rate: number
          unit_price: number
        },
        Update: {
          "account_id?": string | null
          "business_id?": string
          "created_at?": string
          "description?": string
          "discount_amount?": number
          "discount_percent?": number
          "id?": string
          "invoice_id?": string
          "line_number?": number
          "line_subtotal?": number | null
          "line_total?": number
          "product_id?": string | null
          "quantity?": number
          "tax_amount?": number
          "tax_code?": Database["public"]["Enums"]["tax_code"]
          "tax_rate?": number
          "unit_price?": number
        },
        Relationships: [
          {
            foreignKeyName: "invoice_lines_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_invoice_line_product"
            columns: ["product_id"]
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_account_id_fkey"
            columns: ["account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          }
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
          exchange_rate_used: number | null
          functional_currency: string | null
          client_key: string | null
        },
        Insert: {
          amount: number
          "bank_account_id?": string | null
          business_id: string
          "created_at?": string
          "created_by?": string | null
          currency: string
          exchange_rate: number
          "functional_amount?": number | null
          "id?": string
          invoice_id: string
          "journal_entry_id?": string | null
          "notes?": string | null
          "original_amount?": number | null
          "original_currency?": string | null
          payment_date: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          "rate_date?": string | null
          "rate_is_stale?": boolean
          "reference?": string | null
          "exchange_rate_used?": number | null
          "functional_currency?": string | null
          "client_key?": string | null
        },
        Update: {
          "amount?": number
          "bank_account_id?": string | null
          "business_id?": string
          "created_at?": string
          "created_by?": string | null
          "currency?": string
          "exchange_rate?": number
          "functional_amount?": number | null
          "id?": string
          "invoice_id?": string
          "journal_entry_id?": string | null
          "notes?": string | null
          "original_amount?": number | null
          "original_currency?": string | null
          "payment_date?": string
          "payment_method?": Database["public"]["Enums"]["payment_method"]
          "rate_date?": string | null
          "rate_is_stale?": boolean
          "reference?": string | null
          "exchange_rate_used?": number | null
          "functional_currency?": string | null
          "client_key?": string | null
        },
        Relationships: [
          {
            foreignKeyName: "invoice_payments_functional_currency_fkey"
            columns: ["functional_currency"]
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "invoice_payments_original_currency_fkey"
            columns: ["original_currency"]
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "invoice_payments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_currency_fkey"
            columns: ["currency"]
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_payments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          }
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
          project_code: string | null
          lpo_number: string | null
          accent_colour: string | null
          payment_provider: string | null
          payment_reference: string | null
          template: string
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
          exchange_rate_used: number | null
          functional_currency: string | null
          client_key: string | null
          pos_shift_id: string | null
          payload_hash: string | null
          submitted_by: string | null
        },
        Insert: {
          "amount_due?": number | null
          amount_paid: number
          "ar_account_id?": string | null
          "branch_id?": string | null
          business_id: string
          contact_id: string
          "created_at?": string
          "created_by?": string | null
          "credit_note_for?": string | null
          currency: string
          "deleted_at?": string | null
          "department_id?": string | null
          discount_amount: number
          discount_percent: number
          "due_date?": string | null
          exchange_rate: number
          "functional_amount?": number | null
          "id?": string
          invoice_number: string
          invoice_type: string
          issue_date: string
          "journal_entry_id?": string | null
          "notes?": string | null
          "original_amount?": number | null
          "original_currency?": string | null
          "po_number?": string | null
          "project_code?": string | null
          "lpo_number?": string | null
          "accent_colour?": string | null
          "payment_provider?": string | null
          "payment_reference?": string | null
          "template?": string
          "rate_date?": string | null
          "rate_is_stale?": boolean
          "revenue_account_id?": string | null
          "sent_at?": string | null
          status: Database["public"]["Enums"]["invoice_status"]
          subtotal: number
          taxable_amount: number
          "terms?": string | null
          total_amount: number
          "updated_at?": string
          vat_amount: number
          "viewed_at?": string | null
          wht_amount: number
          "exchange_rate_used?": number | null
          "functional_currency?": string | null
          "client_key?": string | null
          "pos_shift_id?": string | null
          "payload_hash?": string | null
          "submitted_by?": string | null
        },
        Update: {
          "amount_due?": number | null
          "amount_paid?": number
          "ar_account_id?": string | null
          "branch_id?": string | null
          "business_id?": string
          "contact_id?": string
          "created_at?": string
          "created_by?": string | null
          "credit_note_for?": string | null
          "currency?": string
          "deleted_at?": string | null
          "department_id?": string | null
          "discount_amount?": number
          "discount_percent?": number
          "due_date?": string | null
          "exchange_rate?": number
          "functional_amount?": number | null
          "id?": string
          "invoice_number?": string
          "invoice_type?": string
          "issue_date?": string
          "journal_entry_id?": string | null
          "notes?": string | null
          "original_amount?": number | null
          "original_currency?": string | null
          "po_number?": string | null
          "project_code?": string | null
          "lpo_number?": string | null
          "accent_colour?": string | null
          "payment_provider?": string | null
          "payment_reference?": string | null
          "template?": string
          "rate_date?": string | null
          "rate_is_stale?": boolean
          "revenue_account_id?": string | null
          "sent_at?": string | null
          "status?": Database["public"]["Enums"]["invoice_status"]
          "subtotal?": number
          "taxable_amount?": number
          "terms?": string | null
          "total_amount?": number
          "updated_at?": string
          "vat_amount?": number
          "viewed_at?": string | null
          "wht_amount?": number
          "exchange_rate_used?": number | null
          "functional_currency?": string | null
          "client_key?": string | null
          "pos_shift_id?": string | null
          "payload_hash?": string | null
          "submitted_by?": string | null
        },
        Relationships: [
          {
            foreignKeyName: "invoices_functional_currency_fkey"
            columns: ["functional_currency"]
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "invoices_pos_shift_id_fkey"
            columns: ["pos_shift_id"]
            referencedRelation: "pos_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_revenue_account_id_fkey"
            columns: ["revenue_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_original_currency_fkey"
            columns: ["original_currency"]
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "invoices_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_department_id_fkey"
            columns: ["department_id"]
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_currency_fkey"
            columns: ["currency"]
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "invoices_credit_note_for_fkey"
            columns: ["credit_note_for"]
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_contact_id_fkey"
            columns: ["contact_id"]
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_branch_id_fkey"
            columns: ["branch_id"]
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_ar_account_id_fkey"
            columns: ["ar_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          }
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
          posting_key: string | null
        },
        Insert: {
          "branch_id?": string | null
          business_id: string
          "created_at?": string
          "created_by?": string | null
          currency: string
          "department_id?": string | null
          description: string
          entry_date: string
          entry_number: string
          exchange_rate: number
          "id?": string
          "period_id?": string | null
          "posted_at?": string | null
          "posted_by?": string | null
          "reference?": string | null
          "reversal_of?": string | null
          "reversed_by?": string | null
          "source_id?": string | null
          "source_type?": string | null
          status: Database["public"]["Enums"]["journal_status"]
          "posting_key?": string | null
        },
        Update: {
          "branch_id?": string | null
          "business_id?": string
          "created_at?": string
          "created_by?": string | null
          "currency?": string
          "department_id?": string | null
          "description?": string
          "entry_date?": string
          "entry_number?": string
          "exchange_rate?": number
          "id?": string
          "period_id?": string | null
          "posted_at?": string | null
          "posted_by?": string | null
          "reference?": string | null
          "reversal_of?": string | null
          "reversed_by?": string | null
          "source_id?": string | null
          "source_type?": string | null
          "status?": Database["public"]["Enums"]["journal_status"]
          "posting_key?": string | null
        },
        Relationships: [
          {
            foreignKeyName: "journal_entries_reversal_of_fkey"
            columns: ["reversal_of"]
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_reversed_by_fkey"
            columns: ["reversed_by"]
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_branch_id_fkey"
            columns: ["branch_id"]
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_currency_fkey"
            columns: ["currency"]
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "journal_entries_department_id_fkey"
            columns: ["department_id"]
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_period_id_fkey"
            columns: ["period_id"]
            referencedRelation: "accounting_periods"
            referencedColumns: ["id"]
          }
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
          exchange_rate_used: number | null
          functional_currency: string | null
          functional_amount: number | null
        },
        Insert: {
          account_id: string
          amount: number
          amount_base: number
          "branch_id?": string | null
          business_id: string
          "created_at?": string
          currency: string
          "department_id?": string | null
          "description?": string | null
          exchange_rate: number
          "id?": string
          is_debit: boolean
          journal_entry_id: string
          line_number: number
          "original_amount?": number | null
          "original_currency?": string | null
          "rate_date?": string | null
          "rate_is_stale?": boolean
          reconciled: boolean
          "reconciled_at?": string | null
          tax_amount: number
          "tax_code?": Database["public"]["Enums"]["tax_code"] | null
          "exchange_rate_used?": number | null
          "functional_currency?": string | null
          "functional_amount?": number | null
        },
        Update: {
          "account_id?": string
          "amount?": number
          "amount_base?": number
          "branch_id?": string | null
          "business_id?": string
          "created_at?": string
          "currency?": string
          "department_id?": string | null
          "description?": string | null
          "exchange_rate?": number
          "id?": string
          "is_debit?": boolean
          "journal_entry_id?": string
          "line_number?": number
          "original_amount?": number | null
          "original_currency?": string | null
          "rate_date?": string | null
          "rate_is_stale?": boolean
          "reconciled?": boolean
          "reconciled_at?": string | null
          "tax_amount?": number
          "tax_code?": Database["public"]["Enums"]["tax_code"] | null
          "exchange_rate_used?": number | null
          "functional_currency?": string | null
          "functional_amount?": number | null
        },
        Relationships: [
          {
            foreignKeyName: "journal_lines_account_id_fkey"
            columns: ["account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_branch_id_fkey"
            columns: ["branch_id"]
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_functional_currency_fkey"
            columns: ["functional_currency"]
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "journal_lines_original_currency_fkey"
            columns: ["original_currency"]
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "journal_lines_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_department_id_fkey"
            columns: ["department_id"]
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_currency_fkey"
            columns: ["currency"]
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "journal_lines_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      loan_repayments: {
        Row: {
          id: string
          business_id: string
          loan_id: string
          repayment_date: string
          amount: number
          principal_portion: number
          interest_portion: number
          bank_account_id: string | null
          journal_entry_id: string | null
          reference: string | null
          notes: string | null
          created_by: string | null
          created_at: string
        },
        Insert: {
          "id?": string
          business_id: string
          loan_id: string
          repayment_date: string
          amount: number
          principal_portion: number
          interest_portion: number
          "bank_account_id?": string | null
          "journal_entry_id?": string | null
          "reference?": string | null
          "notes?": string | null
          "created_by?": string | null
          "created_at?": string
        },
        Update: {
          "id?": string
          "business_id?": string
          "loan_id?": string
          "repayment_date?": string
          "amount?": number
          "principal_portion?": number
          "interest_portion?": number
          "bank_account_id?": string | null
          "journal_entry_id?": string | null
          "reference?": string | null
          "notes?": string | null
          "created_by?": string | null
          "created_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "loan_repayments_loan_id_fkey"
            columns: ["loan_id"]
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_repayments_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_repayments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_repayments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          }
        ]
      }
      loans: {
        Row: {
          id: string
          business_id: string
          lender_name: string
          description: string | null
          loan_account_id: string
          interest_expense_account_id: string | null
          principal_amount: number
          interest_rate_pct: number | null
          term_months: number | null
          start_date: string
          first_payment_date: string | null
          status: string
          drawdown_journal_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        },
        Insert: {
          "id?": string
          business_id: string
          lender_name: string
          "description?": string | null
          loan_account_id: string
          "interest_expense_account_id?": string | null
          principal_amount: number
          "interest_rate_pct?": number | null
          "term_months?": number | null
          start_date: string
          "first_payment_date?": string | null
          "status?": string
          "drawdown_journal_id?": string | null
          "created_by?": string | null
          "created_at?": string
          "updated_at?": string
        },
        Update: {
          "id?": string
          "business_id?": string
          "lender_name?": string
          "description?": string | null
          "loan_account_id?": string
          "interest_expense_account_id?": string | null
          "principal_amount?": number
          "interest_rate_pct?": number | null
          "term_months?": number | null
          "start_date?": string
          "first_payment_date?": string | null
          "status?": string
          "drawdown_journal_id?": string | null
          "created_by?": string | null
          "created_at?": string
          "updated_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "loans_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_drawdown_journal_id_fkey"
            columns: ["drawdown_journal_id"]
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_loan_account_id_fkey"
            columns: ["loan_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_interest_expense_account_id_fkey"
            columns: ["interest_expense_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          }
        ]
      }
      offline_queue_reconciliations: {
        Row: {
          id: string
          business_id: string
          client_key: string
          operation_type: string
          exception_class: string
          origin_user_id: string | null
          origin_device_id: string | null
          captured_at: string | null
          reconciled_by: string
          reason: string
          revalidation: Json
          disposition: string
          replayed_document_id: string | null
          denial_code: string | null
          denial_message: string | null
          created_at: string
        },
        Insert: {
          "id?": string
          business_id: string
          client_key: string
          operation_type: string
          exception_class: string
          "origin_user_id?": string | null
          "origin_device_id?": string | null
          "captured_at?": string | null
          reconciled_by: string
          reason: string
          "revalidation?": Json
          disposition: string
          "replayed_document_id?": string | null
          "denial_code?": string | null
          "denial_message?": string | null
          "created_at?": string
        },
        Update: {
          "id?": string
          "business_id?": string
          "client_key?": string
          "operation_type?": string
          "exception_class?": string
          "origin_user_id?": string | null
          "origin_device_id?": string | null
          "captured_at?": string | null
          "reconciled_by?": string
          "reason?": string
          "revalidation?": Json
          "disposition?": string
          "replayed_document_id?": string | null
          "denial_code?": string | null
          "denial_message?": string | null
          "created_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "offline_queue_reconciliations_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      partner_admins: {
        Row: {
          partner_id: string
          user_id: string
          role: string
          created_at: string
        },
        Insert: {
          partner_id: string
          user_id: string
          "role?": string
          "created_at?": string
        },
        Update: {
          "partner_id?": string
          "user_id?": string
          "role?": string
          "created_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "partner_admins_partner_id_fkey"
            columns: ["partner_id"]
            referencedRelation: "partners"
            referencedColumns: ["id"]
          }
        ]
      }
      partner_clients: {
        Row: {
          partner_id: string
          business_id: string
          created_at: string | null
        },
        Insert: {
          partner_id: string
          business_id: string
          "created_at?": string | null
        },
        Update: {
          "partner_id?": string
          "business_id?": string
          "created_at?": string | null
        },
        Relationships: [
          {
            foreignKeyName: "partner_clients_partner_id_fkey"
            columns: ["partner_id"]
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_clients_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      partner_feature_flags: {
        Row: {
          partner_id: string
          feature_key: string
          enabled: boolean | null
        },
        Insert: {
          partner_id: string
          feature_key: string
          "enabled?": boolean | null
        },
        Update: {
          "partner_id?": string
          "feature_key?": string
          "enabled?": boolean | null
        },
        Relationships: [
          {
            foreignKeyName: "partner_feature_flags_partner_id_fkey"
            columns: ["partner_id"]
            referencedRelation: "partners"
            referencedColumns: ["id"]
          }
        ]
      }
      partner_invoices: {
        Row: {
          id: string
          partner_id: string | null
          amount: number | null
          currency: string | null
          status: string | null
          created_at: string | null
          updated_at: string | null
          invoice_number: string | null
          period_start: string | null
          period_end: string | null
          due_date: string | null
          client_count: number
          notes: string | null
        },
        Insert: {
          "id?": string
          "partner_id?": string | null
          "amount?": number | null
          "currency?": string | null
          "status?": string | null
          "created_at?": string | null
          "updated_at?": string | null
          "invoice_number?": string | null
          "period_start?": string | null
          "period_end?": string | null
          "due_date?": string | null
          "client_count?": number
          "notes?": string | null
        },
        Update: {
          "id?": string
          "partner_id?": string | null
          "amount?": number | null
          "currency?": string | null
          "status?": string | null
          "created_at?": string | null
          "updated_at?": string | null
          "invoice_number?": string | null
          "period_start?": string | null
          "period_end?": string | null
          "due_date?": string | null
          "client_count?": number
          "notes?": string | null
        },
        Relationships: [
          {
            foreignKeyName: "partner_invoices_partner_id_fkey"
            columns: ["partner_id"]
            referencedRelation: "partners"
            referencedColumns: ["id"]
          }
        ]
      }
      partners: {
        Row: {
          id: string
          name: string
          domain: string | null
          logo_url: string | null
          primary_colour: string | null
          support_email: string | null
          app_name: string | null
          client_limit: number | null
          is_active: boolean | null
          billing_email: string | null
          created_at: string | null
          updated_at: string | null
          slug: string | null
          custom_domain: string | null
          onboarding_title: string | null
          onboarding_subtitle: string | null
          support_phone: string | null
          allow_client_visibility: boolean
          billing_contact_name: string | null
          price_per_client: number
          billing_currency: string
        },
        Insert: {
          "id?": string
          name: string
          "domain?": string | null
          "logo_url?": string | null
          "primary_colour?": string | null
          "support_email?": string | null
          "app_name?": string | null
          "client_limit?": number | null
          "is_active?": boolean | null
          "billing_email?": string | null
          "created_at?": string | null
          "updated_at?": string | null
          "slug?": string | null
          "custom_domain?": string | null
          "onboarding_title?": string | null
          "onboarding_subtitle?": string | null
          "support_phone?": string | null
          "allow_client_visibility?": boolean
          "billing_contact_name?": string | null
          "price_per_client?": number
          "billing_currency?": string
        },
        Update: {
          "id?": string
          "name?": string
          "domain?": string | null
          "logo_url?": string | null
          "primary_colour?": string | null
          "support_email?": string | null
          "app_name?": string | null
          "client_limit?": number | null
          "is_active?": boolean | null
          "billing_email?": string | null
          "created_at?": string | null
          "updated_at?": string | null
          "slug?": string | null
          "custom_domain?": string | null
          "onboarding_title?": string | null
          "onboarding_subtitle?": string | null
          "support_phone?": string | null
          "allow_client_visibility?": boolean
          "billing_contact_name?": string | null
          "price_per_client?": number
          "billing_currency?": string
        },
        Relationships: []
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
        },
        Insert: {
          band_from: number
          "band_label?": string | null
          "band_to?": number | null
          business_id: string
          "created_at?": string
          effective_from: string
          "effective_to?": string | null
          fiscal_year: string
          "id?": string
          rate: number
        },
        Update: {
          "band_from?": number
          "band_label?": string | null
          "band_to?": number | null
          "business_id?": string
          "created_at?": string
          "effective_from?": string
          "effective_to?": string | null
          "fiscal_year?": string
          "id?": string
          "rate?": number
        },
        Relationships: [
          {
            foreignKeyName: "paye_bands_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
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
        },
        Insert: {
          basic_salary: number
          business_id: string
          "created_at?": string
          employee_id: string
          gross_pay: number
          "id?": string
          net_pay: number
          "notes?": string | null
          other_deductions: number
          "paid_at?": string | null
          "paye_bands_json?": Json | null
          paye_deduction: number
          paye_taxable_income: number
          payment_method: Database["public"]["Enums"]["payment_method"]
          "payment_ref?": string | null
          payroll_run_id: string
          payslip_generated: boolean
          "payslip_url?": string | null
          pension_employee: number
          pension_employer: number
          total_allowances: number
          total_deductions: number
        },
        Update: {
          "basic_salary?": number
          "business_id?": string
          "created_at?": string
          "employee_id?": string
          "gross_pay?": number
          "id?": string
          "net_pay?": number
          "notes?": string | null
          "other_deductions?": number
          "paid_at?": string | null
          "paye_bands_json?": Json | null
          "paye_deduction?": number
          "paye_taxable_income?": number
          "payment_method?": Database["public"]["Enums"]["payment_method"]
          "payment_ref?": string | null
          "payroll_run_id?": string
          "payslip_generated?": boolean
          "payslip_url?": string | null
          "pension_employee?": number
          "pension_employer?": number
          "total_allowances?": number
          "total_deductions?": number
        },
        Relationships: [
          {
            foreignKeyName: "payroll_employee_lines_employee_id_fkey"
            columns: ["employee_id"]
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_employee_lines_payroll_run_id_fkey"
            columns: ["payroll_run_id"]
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_employee_lines_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
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
          client_key: string | null
        },
        Insert: {
          "approved_at?": string | null
          "approved_by?": string | null
          business_id: string
          "created_at?": string
          "created_by?": string | null
          "id?": string
          "journal_entry_id?": string | null
          "notes?": string | null
          pay_date: string
          "paye_filed_at?": string | null
          "paye_return_ref?": string | null
          payroll_period: string
          period_end: string
          period_start: string
          run_number: string
          status: Database["public"]["Enums"]["payroll_status"]
          total_gross: number
          total_net: number
          total_other_deductions: number
          total_paye: number
          "updated_at?": string
          "client_key?": string | null
        },
        Update: {
          "approved_at?": string | null
          "approved_by?": string | null
          "business_id?": string
          "created_at?": string
          "created_by?": string | null
          "id?": string
          "journal_entry_id?": string | null
          "notes?": string | null
          "pay_date?": string
          "paye_filed_at?": string | null
          "paye_return_ref?": string | null
          "payroll_period?": string
          "period_end?": string
          "period_start?": string
          "run_number?": string
          "status?": Database["public"]["Enums"]["payroll_status"]
          "total_gross?": number
          "total_net?": number
          "total_other_deductions?": number
          "total_paye?": number
          "updated_at?": string
          "client_key?": string | null
        },
        Relationships: [
          {
            foreignKeyName: "payroll_runs_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      phone_accounts: {
        Row: {
          phone: string
          user_id: string
          business_id: string | null
          created_by: string | null
          created_at: string
          temporary_password: boolean
        },
        Insert: {
          phone: string
          user_id: string
          "business_id?": string | null
          "created_by?": string | null
          "created_at?": string
          "temporary_password?": boolean
        },
        Update: {
          "phone?": string
          "user_id?": string
          "business_id?": string | null
          "created_by?": string | null
          "created_at?": string
          "temporary_password?": boolean
        },
        Relationships: [
          {
            foreignKeyName: "phone_accounts_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      pos_approvals: {
        Row: {
          id: string
          token: string
          business_id: string
          action: string
          document_id: string
          amount: number | null
          requested_by: string
          authorized_by: string | null
          authorized_at: string | null
          expires_at: string
          consumed_at: string | null
          consumed_by: string | null
          created_at: string
        },
        Insert: {
          "id?": string
          "token?": string
          business_id: string
          action: string
          document_id: string
          "amount?": number | null
          requested_by: string
          "authorized_by?": string | null
          "authorized_at?": string | null
          expires_at: string
          "consumed_at?": string | null
          "consumed_by?": string | null
          "created_at?": string
        },
        Update: {
          "id?": string
          "token?": string
          "business_id?": string
          "action?": string
          "document_id?": string
          "amount?": number | null
          "requested_by?": string
          "authorized_by?": string | null
          "authorized_at?": string | null
          "expires_at?": string
          "consumed_at?": string | null
          "consumed_by?": string | null
          "created_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "pos_approvals_document_id_fkey"
            columns: ["document_id"]
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_approvals_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      pos_cash_movements: {
        Row: {
          id: string
          business_id: string
          branch_id: string | null
          shift_id: string | null
          user_id: string | null
          user_name: string | null
          movement_type: string
          amount: number
          reason: string
          created_at: string
          command_key: string | null
        },
        Insert: {
          "id?": string
          business_id: string
          "branch_id?": string | null
          "shift_id?": string | null
          "user_id?": string | null
          "user_name?": string | null
          movement_type: string
          amount: number
          reason: string
          "created_at?": string
          "command_key?": string | null
        },
        Update: {
          "id?": string
          "business_id?": string
          "branch_id?": string | null
          "shift_id?": string | null
          "user_id?": string | null
          "user_name?": string | null
          "movement_type?": string
          "amount?": number
          "reason?": string
          "created_at?": string
          "command_key?": string | null
        },
        Relationships: [
          {
            foreignKeyName: "pos_cash_movements_shift_id_fkey"
            columns: ["shift_id"]
            referencedRelation: "pos_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_cash_movements_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_cash_movements_branch_id_fkey"
            columns: ["branch_id"]
            referencedRelation: "branches"
            referencedColumns: ["id"]
          }
        ]
      }
      pos_corrections: {
        Row: {
          id: string
          business_id: string
          command_key: string
          command_type: string
          document_id: string
          amount: number
          currency: string
          lines: Json
          approval_id: string | null
          journal_entry_id: string | null
          reason: string | null
          created_by: string
          created_at: string
        },
        Insert: {
          "id?": string
          business_id: string
          command_key: string
          command_type: string
          document_id: string
          "amount?": number
          currency: string
          "lines?": Json
          "approval_id?": string | null
          "journal_entry_id?": string | null
          "reason?": string | null
          created_by: string
          "created_at?": string
        },
        Update: {
          "id?": string
          "business_id?": string
          "command_key?": string
          "command_type?": string
          "document_id?": string
          "amount?": number
          "currency?": string
          "lines?": Json
          "approval_id?": string | null
          "journal_entry_id?": string | null
          "reason?": string | null
          "created_by?": string
          "created_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "pos_corrections_document_id_fkey"
            columns: ["document_id"]
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_corrections_approval_id_fkey"
            columns: ["approval_id"]
            referencedRelation: "pos_approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_corrections_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      pos_price_overrides: {
        Row: {
          id: string
          token: string
          business_id: string
          kind: string
          product_id: string | null
          unit_price: number | null
          max_discount_percent: number | null
          reason: string | null
          requested_by: string
          authorized_by: string | null
          authorized_at: string | null
          expires_at: string
          consumed_at: string | null
          consumed_by: string | null
          consumed_invoice_id: string | null
          created_at: string
        },
        Insert: {
          "id?": string
          "token?": string
          business_id: string
          kind: string
          "product_id?": string | null
          "unit_price?": number | null
          "max_discount_percent?": number | null
          "reason?": string | null
          requested_by: string
          "authorized_by?": string | null
          "authorized_at?": string | null
          expires_at: string
          "consumed_at?": string | null
          "consumed_by?": string | null
          "consumed_invoice_id?": string | null
          "created_at?": string
        },
        Update: {
          "id?": string
          "token?": string
          "business_id?": string
          "kind?": string
          "product_id?": string | null
          "unit_price?": number | null
          "max_discount_percent?": number | null
          "reason?": string | null
          "requested_by?": string
          "authorized_by?": string | null
          "authorized_at?": string | null
          "expires_at?": string
          "consumed_at?": string | null
          "consumed_by?": string | null
          "consumed_invoice_id?": string | null
          "created_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "pos_price_overrides_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_price_overrides_product_id_fkey"
            columns: ["product_id"]
            referencedRelation: "products"
            referencedColumns: ["id"]
          }
        ]
      }
      pos_settings: {
        Row: {
          id: string
          business_id: string
          enabled_payment_methods: Json
          cashier_max_discount_percent: number
          manager_max_discount_percent: number
          require_approval_for_void: boolean
          require_approval_for_refund: boolean
          require_explanation_variance_threshold: number
          receipt_header: string | null
          receipt_footer: string
          show_tax_on_receipt: boolean
          custom_role_permissions: Json
          created_at: string
          updated_at: string
        },
        Insert: {
          "id?": string
          business_id: string
          "enabled_payment_methods?": Json
          "cashier_max_discount_percent?": number
          "manager_max_discount_percent?": number
          "require_approval_for_void?": boolean
          "require_approval_for_refund?": boolean
          "require_explanation_variance_threshold?": number
          "receipt_header?": string | null
          "receipt_footer?": string
          "show_tax_on_receipt?": boolean
          "custom_role_permissions?": Json
          "created_at?": string
          "updated_at?": string
        },
        Update: {
          "id?": string
          "business_id?": string
          "enabled_payment_methods?": Json
          "cashier_max_discount_percent?": number
          "manager_max_discount_percent?": number
          "require_approval_for_void?": boolean
          "require_approval_for_refund?": boolean
          "require_explanation_variance_threshold?": number
          "receipt_header?": string | null
          "receipt_footer?": string
          "show_tax_on_receipt?": boolean
          "custom_role_permissions?": Json
          "created_at?": string
          "updated_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "pos_settings_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      pos_shift_closes: {
        Row: {
          id: string
          business_id: string
          shift_id: string
          command_key: string
          report_number: string
          closed_by: string
          cashier_id: string | null
          terminal_id: string | null
          branch_id: string | null
          opened_at: string
          closed_at: string
          opening_cash: number
          cash_tenders: number
          other_tenders: number
          refund_total: number
          cash_in_total: number
          cash_out_total: number
          sales_count: number
          tender_breakdown: Json
          expected_cash: number
          actual_cash: number
          variance: number
          variance_reason: string | null
          notes: string | null
          payload: Json
          created_at: string
        },
        Insert: {
          "id?": string
          business_id: string
          shift_id: string
          command_key: string
          report_number: string
          closed_by: string
          "cashier_id?": string | null
          "terminal_id?": string | null
          "branch_id?": string | null
          opened_at: string
          closed_at: string
          opening_cash: number
          cash_tenders: number
          other_tenders: number
          refund_total: number
          cash_in_total: number
          cash_out_total: number
          sales_count: number
          "tender_breakdown?": Json
          expected_cash: number
          actual_cash: number
          variance: number
          "variance_reason?": string | null
          "notes?": string | null
          payload: Json
          "created_at?": string
        },
        Update: {
          "id?": string
          "business_id?": string
          "shift_id?": string
          "command_key?": string
          "report_number?": string
          "closed_by?": string
          "cashier_id?": string | null
          "terminal_id?": string | null
          "branch_id?": string | null
          "opened_at?": string
          "closed_at?": string
          "opening_cash?": number
          "cash_tenders?": number
          "other_tenders?": number
          "refund_total?": number
          "cash_in_total?": number
          "cash_out_total?": number
          "sales_count?": number
          "tender_breakdown?": Json
          "expected_cash?": number
          "actual_cash?": number
          "variance?": number
          "variance_reason?": string | null
          "notes?": string | null
          "payload?": Json
          "created_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "pos_shift_closes_shift_id_fkey"
            columns: ["shift_id"]
            referencedRelation: "pos_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_shift_closes_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      pos_shift_late_adjustments: {
        Row: {
          id: string
          business_id: string
          shift_id: string
          invoice_id: string | null
          command_key: string
          amount: number
          reason: string
          detected_at: string
          created_at: string
        },
        Insert: {
          "id?": string
          business_id: string
          shift_id: string
          "invoice_id?": string | null
          command_key: string
          amount: number
          reason: string
          detected_at: string
          "created_at?": string
        },
        Update: {
          "id?": string
          "business_id?": string
          "shift_id?": string
          "invoice_id?": string | null
          "command_key?": string
          "amount?": number
          "reason?": string
          "detected_at?": string
          "created_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "pos_shift_late_adjustments_shift_id_fkey"
            columns: ["shift_id"]
            referencedRelation: "pos_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_shift_late_adjustments_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_shift_late_adjustments_invoice_id_fkey"
            columns: ["invoice_id"]
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          }
        ]
      }
      pos_shifts: {
        Row: {
          id: string
          business_id: string
          branch_id: string | null
          cashier_id: string | null
          cashier_name: string | null
          opened_at: string
          closed_at: string | null
          opening_cash: number
          expected_cash: number
          actual_cash: number | null
          cash_variance: number | null
          variance_reason: string | null
          total_sales_amount: number
          cash_sales_amount: number
          other_sales_amount: number
          refunds_amount: number
          cash_in_amount: number
          cash_out_amount: number
          status: string
          notes: string | null
          created_at: string
          updated_at: string
          terminal_id: string | null
          open_command_key: string | null
        },
        Insert: {
          "id?": string
          business_id: string
          "branch_id?": string | null
          "cashier_id?": string | null
          "cashier_name?": string | null
          "opened_at?": string
          "closed_at?": string | null
          "opening_cash?": number
          "expected_cash?": number
          "actual_cash?": number | null
          "cash_variance?": number | null
          "variance_reason?": string | null
          "total_sales_amount?": number
          "cash_sales_amount?": number
          "other_sales_amount?": number
          "refunds_amount?": number
          "cash_in_amount?": number
          "cash_out_amount?": number
          "status?": string
          "notes?": string | null
          "created_at?": string
          "updated_at?": string
          "terminal_id?": string | null
          "open_command_key?": string | null
        },
        Update: {
          "id?": string
          "business_id?": string
          "branch_id?": string | null
          "cashier_id?": string | null
          "cashier_name?": string | null
          "opened_at?": string
          "closed_at?": string | null
          "opening_cash?": number
          "expected_cash?": number
          "actual_cash?": number | null
          "cash_variance?": number | null
          "variance_reason?": string | null
          "total_sales_amount?": number
          "cash_sales_amount?": number
          "other_sales_amount?": number
          "refunds_amount?": number
          "cash_in_amount?": number
          "cash_out_amount?": number
          "status?": string
          "notes?": string | null
          "created_at?": string
          "updated_at?": string
          "terminal_id?": string | null
          "open_command_key?": string | null
        },
        Relationships: [
          {
            foreignKeyName: "pos_shifts_terminal_id_fkey"
            columns: ["terminal_id"]
            referencedRelation: "pos_terminals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_shifts_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_shifts_branch_id_fkey"
            columns: ["branch_id"]
            referencedRelation: "branches"
            referencedColumns: ["id"]
          }
        ]
      }
      pos_terminals: {
        Row: {
          id: string
          business_id: string
          name: string
          branch_id: string
          preferred_location_id: string | null
          is_active: boolean
          created_at: string
        },
        Insert: {
          "id?": string
          business_id: string
          name: string
          branch_id: string
          "preferred_location_id?": string | null
          "is_active?": boolean
          "created_at?": string
        },
        Update: {
          "id?": string
          "business_id?": string
          "name?": string
          "branch_id?": string
          "preferred_location_id?": string | null
          "is_active?": boolean
          "created_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "pos_terminals_preferred_location_id_fkey"
            columns: ["preferred_location_id"]
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_terminals_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_terminals_branch_id_fkey"
            columns: ["branch_id"]
            referencedRelation: "branches"
            referencedColumns: ["id"]
          }
        ]
      }
      product_categories: {
        Row: {
          business_id: string
          created_at: string
          id: string
          name: string
          parent_id: string | null
        },
        Insert: {
          business_id: string
          "created_at?": string
          "id?": string
          name: string
          "parent_id?": string | null
        },
        Update: {
          "business_id?": string
          "created_at?": string
          "id?": string
          "name?": string
          "parent_id?": string | null
        },
        Relationships: [
          {
            foreignKeyName: "product_categories_parent_id_fkey"
            columns: ["parent_id"]
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_categories_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
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
        },
        Insert: {
          "barcode?": string | null
          business_id: string
          "category_id?": string | null
          "cogs_account_id?": string | null
          "created_at?": string
          currency: Database["public"]["Enums"]["currency_code"]
          "deleted_at?": string | null
          "description?": string | null
          "id?": string
          "image_url?": string | null
          "inventory_account_id?": string | null
          "is_active?": boolean
          name: string
          product_type: string
          "purchase_account_id?": string | null
          purchase_price: number
          purchase_tax_code: Database["public"]["Enums"]["tax_code"]
          "reorder_level?": number | null
          "reorder_quantity?": number | null
          sale_price: number
          "sales_account_id?": string | null
          sales_tax_code: Database["public"]["Enums"]["tax_code"]
          "sku?": string | null
          track_inventory: boolean
          "unit_of_measure?": string | null
          "updated_at?": string
        },
        Update: {
          "barcode?": string | null
          "business_id?": string
          "category_id?": string | null
          "cogs_account_id?": string | null
          "created_at?": string
          "currency?": Database["public"]["Enums"]["currency_code"]
          "deleted_at?": string | null
          "description?": string | null
          "id?": string
          "image_url?": string | null
          "inventory_account_id?": string | null
          "is_active?": boolean
          "name?": string
          "product_type?": string
          "purchase_account_id?": string | null
          "purchase_price?": number
          "purchase_tax_code?": Database["public"]["Enums"]["tax_code"]
          "reorder_level?": number | null
          "reorder_quantity?": number | null
          "sale_price?": number
          "sales_account_id?": string | null
          "sales_tax_code?": Database["public"]["Enums"]["tax_code"]
          "sku?": string | null
          "track_inventory?": boolean
          "unit_of_measure?": string | null
          "updated_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "products_cogs_account_id_fkey"
            columns: ["cogs_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_purchase_account_id_fkey"
            columns: ["purchase_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_sales_account_id_fkey"
            columns: ["sales_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            referencedRelation: "product_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_inventory_account_id_fkey"
            columns: ["inventory_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          }
        ]
      }
      profiles: {
        Row: {
          full_name: string | null
          id: string
        },
        Insert: {
          "full_name?": string | null
          "id?": string
        },
        Update: {
          "full_name?": string | null
          "id?": string
        },
        Relationships: []
      }
      recurring_invoices: {
        Row: {
          id: string
          business_id: string
          template_invoice_id: string
          frequency: string
          next_run_date: string
          auto_send: boolean
          active: boolean
          created_at: string
        },
        Insert: {
          "id?": string
          business_id: string
          template_invoice_id: string
          frequency: string
          next_run_date: string
          "auto_send?": boolean
          "active?": boolean
          "created_at?": string
        },
        Update: {
          "id?": string
          "business_id?": string
          "template_invoice_id?": string
          "frequency?": string
          "next_run_date?": string
          "auto_send?": boolean
          "active?": boolean
          "created_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "recurring_invoices_template_invoice_id_fkey"
            columns: ["template_invoice_id"]
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_invoices_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      share_transactions: {
        Row: {
          id: string
          business_id: string
          shareholder_name: string
          transaction_type: string
          shares_count: number | null
          amount: number
          share_account_id: string
          bank_account_id: string | null
          journal_entry_id: string | null
          reference: string | null
          notes: string | null
          created_by: string | null
          created_at: string
        },
        Insert: {
          "id?": string
          business_id: string
          shareholder_name: string
          transaction_type: string
          "shares_count?": number | null
          amount: number
          share_account_id: string
          "bank_account_id?": string | null
          "journal_entry_id?": string | null
          "reference?": string | null
          "notes?": string | null
          "created_by?": string | null
          "created_at?": string
        },
        Update: {
          "id?": string
          "business_id?": string
          "shareholder_name?": string
          "transaction_type?": string
          "shares_count?": number | null
          "amount?": number
          "share_account_id?": string
          "bank_account_id?": string | null
          "journal_entry_id?": string | null
          "reference?": string | null
          "notes?": string | null
          "created_by?": string | null
          "created_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "share_transactions_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_transactions_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_transactions_share_account_id_fkey"
            columns: ["share_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          }
        ]
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
          client_key: string | null
        },
        Insert: {
          business_id: string
          "created_at?": string
          "created_by?": string | null
          "id?": string
          location_id: string
          movement_date: string
          movement_type: Database["public"]["Enums"]["stock_movement_type"]
          "notes?": string | null
          product_id: string
          quantity: number
          "reference?": string | null
          "source_id?": string | null
          "source_type?": string | null
          "total_cost?": number | null
          unit_cost: number
          "client_key?": string | null
        },
        Update: {
          "business_id?": string
          "created_at?": string
          "created_by?": string | null
          "id?": string
          "location_id?": string
          "movement_date?": string
          "movement_type?": Database["public"]["Enums"]["stock_movement_type"]
          "notes?": string | null
          "product_id?": string
          "quantity?": number
          "reference?": string | null
          "source_id?": string | null
          "source_type?": string | null
          "total_cost?": number | null
          "unit_cost?": number
          "client_key?": string | null
        },
        Relationships: [
          {
            foreignKeyName: "stock_movements_location_id_fkey"
            columns: ["location_id"]
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            referencedRelation: "products"
            referencedColumns: ["id"]
          }
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
        },
        Insert: {
          business_id: string
          "created_at?": string
          "id?": string
          "notes?": string | null
          product_id: string
          "quantity_dispatched?": number | null
          "quantity_received?": number | null
          quantity_requested: number
          transfer_id: string
          unit_cost: number
        },
        Update: {
          "business_id?": string
          "created_at?": string
          "id?": string
          "notes?": string | null
          "product_id?": string
          "quantity_dispatched?": number | null
          "quantity_received?": number | null
          "quantity_requested?": number
          "transfer_id?": string
          "unit_cost?": number
        },
        Relationships: [
          {
            foreignKeyName: "stock_transfer_lines_product_id_fkey"
            columns: ["product_id"]
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_lines_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfer_lines_transfer_id_fkey"
            columns: ["transfer_id"]
            referencedRelation: "stock_transfers"
            referencedColumns: ["id"]
          }
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
        },
        Insert: {
          "approved_at?": string | null
          "approved_by?": string | null
          business_id: string
          "created_at?": string
          "dispatched_at?": string | null
          from_location_id: string
          "id?": string
          "notes?": string | null
          "received_at?": string | null
          "received_by?": string | null
          "requested_by?": string | null
          status: string
          to_location_id: string
          transfer_number: string
          "updated_at?": string
        },
        Update: {
          "approved_at?": string | null
          "approved_by?": string | null
          "business_id?": string
          "created_at?": string
          "dispatched_at?": string | null
          "from_location_id?": string
          "id?": string
          "notes?": string | null
          "received_at?": string | null
          "received_by?": string | null
          "requested_by?": string | null
          "status?": string
          "to_location_id?": string
          "transfer_number?": string
          "updated_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "stock_transfers_requested_by_fkey"
            columns: ["requested_by"]
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_from_location_id_fkey"
            columns: ["from_location_id"]
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_received_by_fkey"
            columns: ["received_by"]
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_to_location_id_fkey"
            columns: ["to_location_id"]
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_approved_by_fkey"
            columns: ["approved_by"]
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_transfers_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      subscription_payments: {
        Row: {
          id: string
          business_id: string
          tx_ref: string
          gateway: string
          gateway_reference: string | null
          target_plan_tier: string
          billing_cycle: string
          amount: number
          currency: string
          status: string
          checkout_url: string | null
          plan_expires_at: string | null
          initiated_by: string | null
          raw_response: Json | null
          created_at: string
          updated_at: string
        },
        Insert: {
          "id?": string
          business_id: string
          tx_ref: string
          "gateway?": string
          "gateway_reference?": string | null
          target_plan_tier: string
          billing_cycle: string
          amount: number
          "currency?": string
          "status?": string
          "checkout_url?": string | null
          "plan_expires_at?": string | null
          "initiated_by?": string | null
          "raw_response?": Json | null
          "created_at?": string
          "updated_at?": string
        },
        Update: {
          "id?": string
          "business_id?": string
          "tx_ref?": string
          "gateway?": string
          "gateway_reference?": string | null
          "target_plan_tier?": string
          "billing_cycle?": string
          "amount?": number
          "currency?": string
          "status?": string
          "checkout_url?": string | null
          "plan_expires_at?": string | null
          "initiated_by?": string | null
          "raw_response?": Json | null
          "created_at?": string
          "updated_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "subscription_payments_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      subscription_reminders_sent: {
        Row: {
          id: string
          business_id: string
          plan_expires_at: string
          days_before: number
          sent_at: string
        },
        Insert: {
          "id?": string
          business_id: string
          plan_expires_at: string
          days_before: number
          "sent_at?": string
        },
        Update: {
          "id?": string
          "business_id?": string
          "plan_expires_at?": string
          "days_before?": number
          "sent_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "subscription_reminders_sent_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
      support_agent_usage: {
        Row: {
          user_id: string
          window_start: string
          count: number
        },
        Insert: {
          user_id: string
          window_start: string
          "count?": number
        },
        Update: {
          "user_id?": string
          "window_start?": string
          "count?": number
        },
        Relationships: []
      }
      tax_alerts: {
        Row: {
          id: string
          business_id: string
          tax_return_id: string
          alert_type: Database["public"]["Enums"]["tax_alert_type"]
          scheduled_for: string
          sent_at: string | null
          channel: Database["public"]["Enums"]["tax_alert_channel"]
          status: Database["public"]["Enums"]["tax_alert_status"]
          created_at: string
        },
        Insert: {
          "id?": string
          business_id: string
          tax_return_id: string
          alert_type: Database["public"]["Enums"]["tax_alert_type"]
          scheduled_for: string
          "sent_at?": string | null
          "channel?": Database["public"]["Enums"]["tax_alert_channel"]
          "status?": Database["public"]["Enums"]["tax_alert_status"]
          "created_at?": string
        },
        Update: {
          "id?": string
          "business_id?": string
          "tax_return_id?": string
          "alert_type?": Database["public"]["Enums"]["tax_alert_type"]
          "scheduled_for?": string
          "sent_at?": string | null
          "channel?": Database["public"]["Enums"]["tax_alert_channel"]
          "status?": Database["public"]["Enums"]["tax_alert_status"]
          "created_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "tax_alerts_tax_return_id_fkey"
            columns: ["tax_return_id"]
            referencedRelation: "tax_returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_alerts_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
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
        },
        Insert: {
          business_id: string
          "created_at?": string
          "description?": string | null
          effective_from: string
          "effective_to?": string | null
          "employee_rate?": number | null
          "employer_rate?": number | null
          "id?": string
          "is_active?": boolean
          "mra_reference?": string | null
          name: string
          rate: number
          tax_code: Database["public"]["Enums"]["tax_code"]
          "tax_payable_account_id?": string | null
          "tax_receivable_account_id?": string | null
          "updated_at?": string
        },
        Update: {
          "business_id?": string
          "created_at?": string
          "description?": string | null
          "effective_from?": string
          "effective_to?": string | null
          "employee_rate?": number | null
          "employer_rate?": number | null
          "id?": string
          "is_active?": boolean
          "mra_reference?": string | null
          "name?": string
          "rate?": number
          "tax_code?": Database["public"]["Enums"]["tax_code"]
          "tax_payable_account_id?": string | null
          "tax_receivable_account_id?": string | null
          "updated_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "tax_configurations_tax_payable_account_id_fkey"
            columns: ["tax_payable_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_configurations_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_configurations_tax_receivable_account_id_fkey"
            columns: ["tax_receivable_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          }
        ]
      }
      tax_payments: {
        Row: {
          id: string
          business_id: string
          tax_return_id: string
          payment_date: string
          amount: number
          payment_method: Database["public"]["Enums"]["payment_method"]
          bank_account_id: string | null
          reference: string | null
          receipt_path: string | null
          journal_entry_id: string | null
          notes: string | null
          created_by: string | null
          created_at: string
        },
        Insert: {
          "id?": string
          business_id: string
          tax_return_id: string
          "payment_date?": string
          amount: number
          "payment_method?": Database["public"]["Enums"]["payment_method"]
          "bank_account_id?": string | null
          "reference?": string | null
          "receipt_path?": string | null
          "journal_entry_id?": string | null
          "notes?": string | null
          "created_by?": string | null
          "created_at?": string
        },
        Update: {
          "id?": string
          "business_id?": string
          "tax_return_id?": string
          "payment_date?": string
          "amount?": number
          "payment_method?": Database["public"]["Enums"]["payment_method"]
          "bank_account_id?": string | null
          "reference?": string | null
          "receipt_path?": string | null
          "journal_entry_id?": string | null
          "notes?": string | null
          "created_by?": string | null
          "created_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "tax_payments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_payments_tax_return_id_fkey"
            columns: ["tax_return_id"]
            referencedRelation: "tax_returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_payments_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_payments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          }
        ]
      }
      tax_returns: {
        Row: {
          id: string
          business_id: string
          tax_code: Database["public"]["Enums"]["tax_code"]
          period_label: string
          period_start: string
          period_end: string
          due_date: string
          output_tax: number
          input_tax: number
          gross_amount: number
          amount_due: number
          amount_paid: number
          status: Database["public"]["Enums"]["tax_return_status"]
          journal_entry_id: string | null
          filed_ref: string | null
          filed_at: string | null
          source_type: string | null
          source_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
        },
        Insert: {
          "id?": string
          business_id: string
          tax_code: Database["public"]["Enums"]["tax_code"]
          period_label: string
          period_start: string
          period_end: string
          due_date: string
          "output_tax?": number
          "input_tax?": number
          "gross_amount?": number
          "amount_due?": number
          "amount_paid?": number
          "status?": Database["public"]["Enums"]["tax_return_status"]
          "journal_entry_id?": string | null
          "filed_ref?": string | null
          "filed_at?": string | null
          "source_type?": string | null
          "source_id?": string | null
          "created_by?": string | null
          "created_at?": string
          "updated_at?": string
        },
        Update: {
          "id?": string
          "business_id?": string
          "tax_code?": Database["public"]["Enums"]["tax_code"]
          "period_label?": string
          "period_start?": string
          "period_end?": string
          "due_date?": string
          "output_tax?": number
          "input_tax?": number
          "gross_amount?": number
          "amount_due?": number
          "amount_paid?": number
          "status?": Database["public"]["Enums"]["tax_return_status"]
          "journal_entry_id?": string | null
          "filed_ref?": string | null
          "filed_at?": string | null
          "source_type?": string | null
          "source_id?": string | null
          "created_by?": string | null
          "created_at?": string
          "updated_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "tax_returns_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_returns_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          }
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
          is_platform_admin: boolean
          phone: string | null
          preferred_language: string | null
          preferred_currency: Database["public"]["Enums"]["currency_code"] | null
          updated_at: string
        },
        Insert: {
          "avatar_url?": string | null
          "created_at?": string
          "deletion_finalized_at?": string | null
          "deletion_requested_at?": string | null
          full_name: string
          "id?": string
          "is_platform_admin?": boolean
          "phone?": string | null
          "preferred_language?": string | null
          "preferred_currency?": Database["public"]["Enums"]["currency_code"] | null
          "updated_at?": string
        },
        Update: {
          "avatar_url?": string | null
          "created_at?": string
          "deletion_finalized_at?": string | null
          "deletion_requested_at?": string | null
          "full_name?": string
          "id?": string
          "is_platform_admin?": boolean
          "phone?": string | null
          "preferred_language?": string | null
          "preferred_currency?": Database["public"]["Enums"]["currency_code"] | null
          "updated_at?": string
        },
        Relationships: []
      }
      webhook_deliveries: {
        Row: {
          id: string
          webhook_id: string
          event: string
          payload: Json
          status_code: number | null
          response_body: string | null
          attempt: number
          delivered_at: string | null
          created_at: string
        },
        Insert: {
          "id?": string
          webhook_id: string
          event: string
          payload: Json
          "status_code?": number | null
          "response_body?": string | null
          "attempt?": number
          "delivered_at?": string | null
          "created_at?": string
        },
        Update: {
          "id?": string
          "webhook_id?": string
          "event?": string
          "payload?": Json
          "status_code?": number | null
          "response_body?": string | null
          "attempt?": number
          "delivered_at?": string | null
          "created_at?": string
        },
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_webhook_id_fkey"
            columns: ["webhook_id"]
            referencedRelation: "webhooks"
            referencedColumns: ["id"]
          }
        ]
      }
      webhooks: {
        Row: {
          id: string
          business_id: string
          url: string
          events: string[]
          secret: string
          is_active: boolean
          last_triggered_at: string | null
          created_by: string | null
          created_at: string
          updated_at: string
          consecutive_failures: number
        },
        Insert: {
          "id?": string
          business_id: string
          url: string
          "events?": string[]
          "secret?": string
          "is_active?": boolean
          "last_triggered_at?": string | null
          "created_by?": string | null
          "created_at?": string
          "updated_at?": string
          "consecutive_failures?": number
        },
        Update: {
          "id?": string
          "business_id?": string
          "url?": string
          "events?": string[]
          "secret?": string
          "is_active?": boolean
          "last_triggered_at?": string | null
          "created_by?": string | null
          "created_at?": string
          "updated_at?": string
          "consecutive_failures?": number
        },
        Relationships: [
          {
            foreignKeyName: "webhooks_business_id_fkey"
            columns: ["business_id"]
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: {
      v_ai_anomalies: {
        Row: {
          business_id: string | null
          branch_id: string | null
          type: string | null
          severity: string | null
          occurred_on: string | null
          amount: number | null
          reference: string | null
          description: string | null
        }
        Relationships: []
      }
      v_ai_cash_accounts: {
        Row: {
          id: string | null
          business_id: string | null
          branch_id: string | null
          code: string | null
          name: string | null
          opening_balance: number | null
        }
        Relationships: []
      }
      v_ai_cash_movements: {
        Row: {
          business_id: string | null
          branch_id: string | null
          entry_id: string | null
          entry_date: string | null
          month: string | null
          net_cash: number | null
        }
        Relationships: []
      }
      v_ai_customer_concentration: {
        Row: {
          business_id: string | null
          branch_id: string | null
          total_revenue: number | null
          top_customer: string | null
          top_contact_id: string | null
          top_customer_revenue: number | null
          concentration_pct: number | null
          customer_count: number | null
        }
        Relationships: []
      }
      v_ai_expense_docs: {
        Row: {
          business_id: string | null
          branch_id: string | null
          expense_id: string | null
          expense_number: string | null
          contact_id: string | null
          expense_date: string | null
          due_date: string | null
          status: string | null
          expense_type: string | null
          exchange_rate: number | null
          amount_base: number | null
          amount_outstanding: number | null
        }
        Relationships: []
      }
      v_ai_kpis: {
        Row: {
          business_id: string | null
          branch_id: string | null
          period_start: string | null
          period_end: string | null
          revenue_mtd: number | null
          expenses_mtd: number | null
          net_profit_mtd: number | null
          profit_margin_pct: number | null
          cash_balance: number | null
          receivables_total: number | null
          overdue_total: number | null
          open_invoice_count: number | null
          payables_total: number | null
          avg_days_to_pay: number | null
          expense_ratio_pct: number | null
        }
        Relationships: []
      }
      v_ai_monthly_trend: {
        Row: {
          business_id: string | null
          branch_id: string | null
          month: string | null
          month_start: string | null
          revenue: number | null
          expenses: number | null
          profit: number | null
          cash_in: number | null
          cash_out: number | null
          net_cash: number | null
          cumulative_cash: number | null
        }
        Relationships: []
      }
      v_ai_overdue_invoices: {
        Row: {
          business_id: string | null
          branch_id: string | null
          invoice_id: string | null
          invoice_number: string | null
          contact_id: string | null
          customer: string | null
          amount_outstanding: number | null
          issue_date: string | null
          due_date: string | null
          days_overdue: number | null
        }
        Relationships: []
      }
      v_ai_revenue_invoices: {
        Row: {
          business_id: string | null
          branch_id: string | null
          invoice_id: string | null
          invoice_number: string | null
          contact_id: string | null
          issue_date: string | null
          due_date: string | null
          status: string | null
          amount_base: number | null
          amount_outstanding: number | null
        }
        Relationships: []
      }
      v_ai_top_customers: {
        Row: {
          business_id: string | null
          branch_id: string | null
          contact_id: string | null
          customer: string | null
          revenue: number | null
          invoice_count: number | null
          last_invoice_date: string | null
          outstanding: number | null
          share_pct: number | null
        }
        Relationships: []
      }
      v_ai_top_expenses: {
        Row: {
          business_id: string | null
          branch_id: string | null
          month: string | null
          category: string | null
          account_code: string | null
          amount: number | null
          document_count: number | null
        }
        Relationships: []
      }
      v_ai_upcoming_payables: {
        Row: {
          business_id: string | null
          branch_id: string | null
          source: string | null
          label: string | null
          counterparty: string | null
          amount: number | null
          due_date: string | null
        }
        Relationships: []
      }
      v_ai_upcoming_receivables: {
        Row: {
          business_id: string | null
          branch_id: string | null
          invoice_id: string | null
          invoice_number: string | null
          customer: string | null
          amount_outstanding: number | null
          due_date: string | null
          days_until_due: number | null
          bucket: string | null
        }
        Relationships: []
      }
      v_ar_ageing: {
        Row: {
          business_id: string | null
          contact_id: string | null
          contact_name: string | null
          invoice_id: string | null
          invoice_number: string | null
          issue_date: string | null
          due_date: string | null
          currency: string | null
          total_amount: number | null
          amount_paid: number | null
          amount_due: number | null
          days_overdue: number | null
          ageing_bucket: string | null
        }
        Relationships: []
      }
      v_asset_register: {
        Row: {
          business_id: string | null
          asset_number: string | null
          name: string | null
          acquisition_cost: number | null
          acquisition_date: string | null
          depreciable_amount: number | null
          residual_value: number | null
          accumulated_depreciation: number | null
          depreciation_method: Database["public"]["Enums"]["depreciation_method"] | null
          last_depreciation_date: string | null
          net_book_value: number | null
          status: Database["public"]["Enums"]["asset_status"] | null
          category: string | null
          branch: string | null
          department: string | null
        }
        Relationships: []
      }
      v_cash_flow: {
        Row: {
          business_id: string | null
          period: string | null
          operating: number | null
          investing: number | null
          financing: number | null
          net_change: number | null
        }
        Relationships: []
      }
      v_inventory_balance_ledger_drift: {
        Row: {
          business_id: string | null
          product_id: string | null
          location_id: string | null
          quantity_on_hand: number | null
          ledger_quantity: number | null
          difference: number | null
          movement_count: number | null
          last_ledger_movement_at: string | null
          balance_updated_at: string | null
        }
        Relationships: []
      }
      v_inventory_ledger_variance: {
        Row: {
          business_id: string | null
          business_name: string | null
          stock_on_hand_value: number | null
          inventory_ledger_balance: number | null
          variance: number | null
          status: string | null
        }
        Relationships: []
      }
      v_partner_client_usage: {
        Row: {
          partner_id: string | null
          business_id: string | null
          business_name: string | null
          plan_tier: string | null
          is_active: boolean | null
          onboarded_at: string | null
          journal_entry_count: number | null
          invoice_count: number | null
          user_count: number | null
          last_activity_at: string | null
        }
        Relationships: []
      }
      v_reorder_alerts: {
        Row: {
          business_id: string | null
          product_id: string | null
          product_name: string | null
          sku: string | null
          location_name: string | null
          quantity_on_hand: number | null
          quantity_reserved: number | null
          quantity_available: number | null
          average_cost: number | null
          reorder_level: number | null
          reorder_quantity: number | null
          estimated_reorder_cost: number | null
        }
        Relationships: []
      }
      v_trial_balance: {
        Row: {
          business_id: string | null
          code: string | null
          name: string | null
          account_type: Database["public"]["Enums"]["account_type"] | null
          account_subtype: Database["public"]["Enums"]["account_subtype"] | null
          normal_balance: string | null
          total_debits: number | null
          total_credits: number | null
          balance: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      _ledgr_account_by_code: {
        Args: {
          p_business_id: string
          p_code: string
        }
        Returns: string
      }
      _ledgr_apply_stock_movement_balance: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      _ledgr_apply_stock_movement_delta: {
        Args: {
          p_business_id: string
          p_product_id: string
          p_location_id: string
          p_quantity: number
          p_unit_cost: number
          p_moved_at: string
        }
        Returns: undefined
      }
      _ledgr_assert_account: {
        Args: {
          p_account_id: string
          p_business_id: string
          p_role: string
        }
        Returns: string
      }
      _ledgr_assert_period_open: {
        Args: {
          p_business: string
          p_date: string
          p_what: string
        }
        Returns: undefined
      }
      _ledgr_assert_pos_price_authority: {
        Args: {
          p_business_id: string
          p_invoice: Json
          p_lines: Json
          p_tokens: string[]
        }
        Returns: undefined
      }
      _ledgr_assert_pos_sale_amounts: {
        Args: {
          p_business_id: string
          p_invoice: Json
          p_lines: Json
        }
        Returns: undefined
      }
      _ledgr_assert_usage_limit: {
        Args: {
          p_business_id: string
        }
        Returns: undefined
      }
      _ledgr_before_insert_expenses_quota: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      _ledgr_before_insert_invoices_quota: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      _ledgr_before_insert_payroll_runs_quota: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      _ledgr_closed_period: {
        Args: {
          p_business: string
          p_date: string
        }
        Returns: Database["public"]["Tables"]["accounting_periods"]["Row"]
      }
      _ledgr_complete_pos_sale: {
        Args: {
          p_business_id: string
          p_invoice_id: string
        }
        Returns: Json
      }
      _ledgr_consume_pos_approval: {
        Args: {
          p_token: string
          p_business_id: string
          p_action: string
          p_document_id: string
        }
        Returns: string
      }
      _ledgr_consume_price_override: {
        Args: {
          p_business_id: string
          p_tokens: string[]
          p_kind: string
          p_product_id: string
          p_unit_price: number
          p_percent: number
        }
        Returns: boolean
      }
      _ledgr_correction_preflight: {
        Args: {
          p_business_id: string
          p_document_id: string
          p_action: string
          p_approval_token: string
        }
        Returns: Record<string, unknown>[]
      }
      _ledgr_guard_accounting_period: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      _ledgr_guard_invoice_direct_write: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      _ledgr_guard_invoice_line_direct_write: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      _ledgr_guard_pos_shift_link: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      _ledgr_invoice_approval_guard: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      _ledgr_invoice_line_revokes_approval: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      _ledgr_invoice_needs_approval: {
        Args: {
          p_business: string
          p_submitter: string
          p_total: number
        }
        Returns: boolean
      }
      _ledgr_is_pos_supervisor: {
        Args: {
          p_business_id: string
          p_user: string
        }
        Returns: boolean
      }
      _ledgr_member_role: {
        Args: {
          p_business: string
          p_user: string
        }
        Returns: string
      }
      _ledgr_period_guard: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      _ledgr_period_guard_child: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      _ledgr_period_guard_invoice: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      _ledgr_period_guard_journal_entry: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      _ledgr_period_is_open: {
        Args: {
          p_business: string
          p_date: string
        }
        Returns: boolean
      }
      _ledgr_pos_actor_name: {
        Args: {
          p_uid: string
        }
        Returns: string
      }
      _ledgr_pos_discount_cap: {
        Args: {
          p_business_id: string
          p_user: string
        }
        Returns: number
      }
      _ledgr_pos_payload_hash: {
        Args: {
          p_payload: Json
        }
        Returns: string
      }
      _ledgr_pos_stock_location: {
        Args: {
          p_business_id: string
          p_branch_id: string
        }
        Returns: string
      }
      _ledgr_post_cogs: {
        Args: {
          p_business_id: string
          p_invoice_id: string
          p_invoice_number: string
          p_issue_date: string
          p_branch_id: string
          p_department_id: string
          p_cost_lines: Json
          p_posting_key: string
        }
        Returns: string
      }
      _ledgr_post_entry: {
        Args: {
          p_business_id: string
          p_entry_number: string
          p_entry_date: string
          p_description: string
          p_source_type: string
          p_source_id: string
          p_currency: string
          p_exchange_rate: number
          p_branch_id: string
          p_department_id: string
          p_lines: Json
          p_posting_key: string
        }
        Returns: string
      }
      _ledgr_post_entry_keyed: {
        Args: {
          p_business_id: string
          p_posting_key: string
          p_entry_date: string
          p_description: string
          p_source_type: string
          p_source_id: string
          p_currency: string
          p_exchange_rate: number
          p_branch_id: string
          p_department_id: string
          p_lines: Json
        }
        Returns: string
      }
      _ledgr_resolve_sale_contact: {
        Args: {
          p_business_id: string
          p_contact_id: string
          p_customer: Json
        }
        Returns: string
      }
      _ledgr_revoke_invoice_approval: {
        Args: {
          p_invoice: string
          p_reason: string
        }
        Returns: undefined
      }
      _ledgr_stock_location: {
        Args: {
          p_business_id: string
          p_branch_id: string
        }
        Returns: string
      }
      _ledgr_try_uuid: {
        Args: {
          p: string
        }
        Returns: string
      }
      accept_invitation: {
        Args: {
          p_token: string
        }
        Returns: Json
      }
      accept_invitation_membership: {
        Args: {
          p_invitation_id: string
          p_recipient_id: string
          p_expected_invitation: Json
        }
        Returns: Json
      }
      add_partner_admin: {
        Args: {
          p_partner_id: string
          p_user_email_or_id: string
          "p_role?": string
        }
        Returns: undefined
      }
      ai_context: {
        Args: {
          p_business_id: string
          p_branch_id: string
        }
        Returns: Json
      }
      apply_subscription_payment: {
        Args: {
          p_tx_ref: string
          p_status: string
          p_gateway_reference: string
          p_raw_response: Json
        }
        Returns: Database["public"]["Tables"]["subscription_payments"]["Row"]
      }
      approve_invoice: {
        Args: {
          p_invoice_id: string
          "p_note?": string
        }
        Returns: Json
      }
      audit_chain_hash: {
        Args: {
          p_prev_hash: string
          p_business_id: string
          p_user_id: string
          p_occurred_at: string
          p_event_type: string
          p_resource_type: string
          p_resource_id: string
          p_resource_ref: string
          p_old_values: Json
          p_new_values: Json
          p_notes: string
        }
        Returns: string
      }
      authorize_pos_approval: {
        Args: {
          p_token: string
        }
        Returns: Json
      }
      authorize_pos_price_override: {
        Args: {
          p_token: string
        }
        Returns: Json
      }
      backfill_and_recalculate_inventory: {
        Args: {
          "p_business_id?": string
        }
        Returns: Record<string, unknown>[]
      }
      business_partner_id: {
        Args: {
          bid: string
        }
        Returns: string
      }
      can_access_branch: {
        Args: {
          p_business_id: string
          p_branch_id: string
        }
        Returns: boolean
      }
      can_access_location: {
        Args: {
          p_business_id: string
          p_location_id: string
        }
        Returns: boolean
      }
      can_admin_business_data: {
        Args: {
          p_business_id: string
        }
        Returns: boolean
      }
      can_operate_pos: {
        Args: {
          p_business_id: string
        }
        Returns: boolean
      }
      can_read_audit: {
        Args: {
          p_business_id: string
        }
        Returns: boolean
      }
      can_read_partner_client: {
        Args: {
          pid: string
          bid: string
        }
        Returns: boolean
      }
      can_read_partner_peer_business: {
        Args: {
          bid: string
        }
        Returns: boolean
      }
      can_view_payroll: {
        Args: {
          p_business_id: string
        }
        Returns: boolean
      }
      can_write_business_data: {
        Args: {
          p_business_id: string
        }
        Returns: boolean
      }
      can_write_contacts_data: {
        Args: {
          p_business_id: string
        }
        Returns: boolean
      }
      can_write_expense_data: {
        Args: {
          p_business_id: string
        }
        Returns: boolean
      }
      can_write_payroll: {
        Args: {
          p_business_id: string
        }
        Returns: boolean
      }
      can_write_sales_data: {
        Args: {
          p_business_id: string
        }
        Returns: boolean
      }
      clear_partner_admins: {
        Args: {
          p_partner_id: string
        }
        Returns: number
      }
      close_accounting_period: {
        Args: {
          p_period_id: string
          "p_reason?": string
        }
        Returns: Json
      }
      close_pos_shift_command: {
        Args: {
          p_payload: Json
        }
        Returns: Json
      }
      consume_api_rate_limit: {
        Args: {
          p_bucket: string
          p_limit: number
          p_window_start: string
        }
        Returns: boolean
      }
      create_api_journal_entry: {
        Args: {
          p_business_id: string
          p_entry: Json
          p_lines: Json
        }
        Returns: Json
      }
      create_business_with_owner: {
        Args: {
          p_name: string
          p_trading_name: string
          p_registration_number: string
          p_tpin: string
          p_vat_number: string
          p_vat_registered: boolean
          p_base_currency: string
          p_financial_year_start: string
          p_timezone: string
          p_address_line1: string
          p_city: string
          p_country: string
          p_phone: string
          p_email: string
          p_brand_color: string
          p_invoice_prefix: string
          p_expense_prefix: string
          p_payroll_prefix: string
        }
        Returns: string
      }
      create_invoice_with_lines: {
        Args: {
          p_invoice: Json
          p_lines: Json
          "p_client_key?": string
        }
        Returns: Json
      }
      current_partner_ids: {
        Args: {
          uid: string
        }
        Returns: string[]
      }
      current_user_role: {
        Args: {
          p_business_id: string
        }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      diagnose_user_login: {
        Args: {
          p_user_email_or_id: string
        }
        Returns: Record<string, unknown>[]
      }
      enforce_expense_payment_allowed: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      enforce_invoice_payment_allowed: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      enforce_partner_client_limit: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      enforce_plan_tier_change: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      get_enum_values: {
        Args: {
          p_enum_name: string
        }
        Returns: string[]
      }
      get_pos_shift_report: {
        Args: {
          p_shift_id: string
        }
        Returns: Json
      }
      get_user_role: {
        Args: {
          p_business_id: string
        }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      grant_user_business_access: {
        Args: {
          p_user_email_or_id: string
          p_business_id: string
          "p_role?": string
        }
        Returns: Record<string, unknown>[]
      }
      increment_amount_paid: {
        Args: {
          p_table: string
          p_id: string
          p_amount: number
        }
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
      is_business_member: {
        Args: {
          p_business_id: string
        }
        Returns: boolean
      }
      is_partner_admin: {
        Args: {
          uid: string
          pid: string
        }
        Returns: boolean
      }
      is_partner_business_admin: {
        Args: {
          bid: string
        }
        Returns: boolean
      }
      is_platform_admin: {
        Args: {
          uid: string
        }
        Returns: boolean
      }
      ledgr_monthly_document_count: {
        Args: {
          p_business_id: string
        }
        Returns: number
      }
      list_all_businesses: {
        Args: Record<PropertyKey, never>
        Returns: Record<string, unknown>[]
      }
      list_partner_admins: {
        Args: {
          p_partner_id: string
        }
        Returns: Record<string, unknown>[]
      }
      log_manual_audit_event: {
        Args: {
          p_business_id: string
          p_event_type: string
          p_resource_type: string
          p_resource_id: string
          "p_resource_ref?": string
          "p_old_values?": Json
          "p_new_values?": Json
          "p_notes?": string
        }
        Returns: undefined
      }
      next_journal_entry_number: {
        Args: {
          "p_business_id?": string
        }
        Returns: string
      }
      open_pos_shift_command: {
        Args: {
          p_payload: Json
        }
        Returns: Json
      }
      plan_tier_rank: {
        Args: {
          tier: string
        }
        Returns: number
      }
      pos_stock_availability: {
        Args: {
          p_business_id: string
          "p_branch_id?": string
        }
        Returns: Json
      }
      post_pos_sale: {
        Args: {
          p_payload: Json
        }
        Returns: Json
      }
      prevent_functional_currency_change: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      prevent_locked_bank_line_change: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      protect_partner_commercial_fields: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      r01_guard_invitation_write: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      r01_guard_membership_write: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      r01_guard_profile_write: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      reconcile_offline_queue_item: {
        Args: {
          p_request: Json
        }
        Returns: Json
      }
      record_business_terms_acceptance: {
        Args: {
          p_business_id: string
          p_terms_version: string
        }
        Returns: string
      }
      record_expense_payment: {
        Args: {
          p_payment: Json
          p_client_key: string
        }
        Returns: Json
      }
      record_inventory_journal_movement: {
        Args: {
          p_payload: Json
        }
        Returns: Json
      }
      record_invoice_payment: {
        Args: {
          p_payment: Json
          p_client_key: string
        }
        Returns: Json
      }
      record_pos_cash_movement_command: {
        Args: {
          p_payload: Json
        }
        Returns: Json
      }
      record_sale_stock_and_cogs: {
        Args: {
          p_invoice_id: string
          p_lines: Json
        }
        Returns: Json
      }
      refund_pos_sale_command: {
        Args: {
          p_payload: Json
        }
        Returns: Json
      }
      remove_partner_admin: {
        Args: {
          p_partner_id: string
          p_user_email_or_id: string
        }
        Returns: undefined
      }
      reopen_accounting_period: {
        Args: {
          p_period_id: string
          p_reason: string
        }
        Returns: Json
      }
      request_pos_approval: {
        Args: {
          p_business_id: string
          p_action: string
          p_document_id: string
          "p_amount?": number
          "p_reason?": string
          "p_ttl_minutes?": number
        }
        Returns: Json
      }
      request_pos_price_override: {
        Args: {
          p_business_id: string
          p_kind: string
          "p_product_id?": string
          "p_unit_price?": number
          "p_max_discount_percent?": number
          "p_reason?": string
          "p_ttl_minutes?": number
        }
        Returns: Json
      }
      reserve_next_document_number: {
        Args: {
          p_business_id: string
          p_kind: string
        }
        Returns: string
      }
      save_quick_expense: {
        Args: {
          p_payload: Json
        }
        Returns: Json
      }
      save_quick_sale: {
        Args: {
          p_payload: Json
        }
        Returns: Json
      }
      seed_new_business: {
        Args: {
          p_biz: Json
        }
        Returns: undefined
      }
      seed_partner_feature_flags: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      set_invoice_approval_policy: {
        Args: {
          p_business_id: string
          p_enabled: boolean
          p_threshold: number
          "p_roles?": string[]
        }
        Returns: Json
      }
      set_partner_invoice_number: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      set_updated_at: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      set_user_business_access: {
        Args: {
          p_user_email_or_id: string
          p_business_ids: string[]
          "p_role?": string
          "p_revoke_others?": boolean
        }
        Returns: Record<string, unknown>[]
      }
      sync_invoice_amount_due: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      touch_updated_at: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      update_inventory_balance: {
        Args: Record<PropertyKey, never>
        Returns: unknown /* trigger */
      }
      user_has_role: {
        Args: {
          p_business_id: string
          p_min_role: Database["public"]["Enums"]["user_role"]
        }
        Returns: boolean
      }
      verify_audit_chain: {
        Args: {
          p_business_id: string
          "p_resource_type?": string
        }
        Returns: Record<string, unknown>[]
      }
      void_pos_sale_command: {
        Args: {
          p_payload: Json
        }
        Returns: Json
      }
    }
    Enums: {
      account_subtype: "current_asset" | "non_current_asset" | "fixed_asset" | "current_liability" | "non_current_liability" | "share_capital" | "retained_earnings" | "reserves" | "revenue" | "other_income" | "cost_of_sales" | "operating_expense" | "finance_cost" | "tax_expense" | "depreciation_amortisation"
      account_type: "asset" | "liability" | "equity" | "income" | "expense"
      asset_status: "active" | "disposed" | "fully_depreciated" | "impaired" | "under_construction"
      currency_code: "MWK" | "USD" | "EUR" | "GBP" | "ZAR" | "ZMW" | "TZS" | "KES" | "UGX"
      depreciation_method: "straight_line" | "reducing_balance" | "units_of_production" | "sum_of_years_digits"
      invoice_status: "draft" | "sent" | "partially_paid" | "paid" | "overdue" | "void" | "credit_note"
      journal_status: "draft" | "posted" | "reversed"
      payment_method: "cash" | "bank_transfer" | "cheque" | "airtel_money" | "tnm_mpamba" | "card" | "other"
      payroll_status: "draft" | "approved" | "paid" | "void"
      stock_movement_type: "purchase" | "sale" | "adjustment_in" | "adjustment_out" | "transfer_in" | "transfer_out" | "return_in" | "return_out" | "opening_balance" | "write_off"
      tax_alert_channel: "email" | "sms"
      tax_alert_status: "pending" | "sent" | "failed"
      tax_alert_type: "14_day" | "7_day" | "1_day" | "due_date"
      tax_code: "vat_standard" | "vat_zero" | "vat_exempt" | "paye" | "wht_15" | "wht_20" | "wht_10" | "cit" | "fbt" | "none" | "tpr_pension"
      tax_return_status: "pending" | "filed" | "paid" | "overdue" | "void"
      user_role: "owner" | "admin" | "accountant" | "payroll_manager" | "supervisor" | "data_entry" | "inventory_manager" | "sales_clerk" | "auditor" | "viewer" | "purchasing_officer" | "warehouse_worker" | "sales_manager" | "customer_service_rep" | "tax_compliance_officer" | "treasury_manager" | "asset_manager" | "board_member" | "branch_manager" | "cashier" | "manager" | "stock_clerk"
    }
    CompositeTypes: Record<string, never>
  }
}
