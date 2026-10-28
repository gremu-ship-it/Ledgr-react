export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      approval_history: {
        Row: {
          action: string
          acted_at: string
          acted_by: string
          comments: string | null
          id: number
          request_id: string
          step_order: number
        }
        Insert: {
          action: string
          acted_at?: string
          acted_by: string
          comments?: string | null
          id?: never
          request_id: string
          step_order: number
        }
        Update: {
          action?: string
          acted_at?: string
          acted_by?: string
          comments?: string | null
          id?: never
          request_id?: string
          step_order?: number
        }
        Relationships: []
      }
      approval_request_steps: {
        Row: {
          description: string | null
          request_id: string
          required_role: string
          step_order: number
        }
        Insert: {
          description?: string | null
          request_id: string
          required_role: string
          step_order: number
        }
        Update: {
          description?: string | null
          request_id?: string
          required_role?: string
          step_order?: number
        }
        Relationships: []
      }
      approval_requests: {
        Row: {
          business_id: string
          completed_at: string | null
          current_step: number
          document_id: string
          document_snapshot: Json
          document_type: string
          id: string
          requested_at: string
          requested_by: string
          status: string
          workflow_id: string
        }
        Insert: {
          business_id: string
          completed_at?: string | null
          current_step?: number
          document_id: string
          document_snapshot: Json
          document_type: string
          id?: string
          requested_at?: string
          requested_by: string
          status?: string
          workflow_id: string
        }
        Update: {
          business_id?: string
          completed_at?: string | null
          current_step?: number
          document_id?: string
          document_snapshot?: Json
          document_type?: string
          id?: string
          requested_at?: string
          requested_by?: string
          status?: string
          workflow_id?: string
        }
        Relationships: []
      }
      approval_workflow_steps: {
        Row: {
          description: string | null
          id: string
          required_role: string
          step_order: number
          workflow_id: string
        }
        Insert: {
          description?: string | null
          id?: string
          required_role: string
          step_order: number
          workflow_id: string
        }
        Update: {
          description?: string | null
          id?: string
          required_role?: string
          step_order?: number
          workflow_id?: string
        }
        Relationships: []
      }
      approval_workflows: {
        Row: {
          business_id: string
          created_at: string
          document_type: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          document_type: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          document_type?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      accounting_period_events: {
        Row: {
          action: string
          actor: string | null
          business_id: string
          created_at: string
          id: number
          period_id: string
          reason: string
        }
        ComputedFields: never
        Insert: {
          action: string
          actor?: string | null
          business_id: string
          created_at?: string
          id?: number
          period_id: string
          reason: string
        }
        Update: {
          action?: string
          actor?: string | null
          business_id?: string
          created_at?: string
          id?: number
          period_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounting_period_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounting_period_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "accounting_period_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "accounting_period_events_period_id_fkey"
            columns: ["period_id"]
            isOneToOne: false
            referencedRelation: "accounting_periods"
            referencedColumns: ["id"]
          },
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
        }
        ComputedFields: never
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
          {
            foreignKeyName: "accounting_periods_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "accounting_periods_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
        ComputedFields: never
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
            foreignKeyName: "accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
          {
            foreignKeyName: "accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_insights_usage: {
        Row: {
          count: number
          user_id: string
          window_start: string
        }
        ComputedFields: never
        Insert: {
          count?: number
          user_id: string
          window_start: string
        }
        Update: {
          count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          revoked_at: string | null
        }
        ComputedFields: never
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          revoked_at?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          revoked_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "api_keys_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
      api_usage: {
        Row: {
          api_key: string | null
          api_key_id: string | null
          count: number | null
          created_at: string | null
          id: string
          window_start: string | null
        }
        ComputedFields: never
        Insert: {
          api_key?: string | null
          api_key_id?: string | null
          count?: number | null
          created_at?: string | null
          id?: string
          window_start?: string | null
        }
        Update: {
          api_key?: string | null
          api_key_id?: string | null
          count?: number | null
          created_at?: string | null
          id?: string
          window_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_usage_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
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
          is_depreciable: boolean
          mra_depreciation_rate: number | null
          name: string
          residual_percent: number
          useful_life_years: number | null
        }
        ComputedFields: never
        Insert: {
          accumulated_dep_account_id?: string | null
          asset_account_id?: string | null
          business_id: string
          created_at?: string
          dep_expense_account_id?: string | null
          depreciation_method?: Database["public"]["Enums"]["depreciation_method"]
          id?: string
          is_active?: boolean
          is_depreciable?: boolean
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
          is_depreciable?: boolean
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
            foreignKeyName: "asset_categories_accumulated_dep_account_id_fkey"
            columns: ["accumulated_dep_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
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
            foreignKeyName: "asset_categories_asset_account_id_fkey"
            columns: ["asset_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
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
            foreignKeyName: "asset_categories_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "asset_categories_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "asset_categories_dep_expense_account_id_fkey"
            columns: ["dep_expense_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_categories_dep_expense_account_id_fkey"
            columns: ["dep_expense_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_20260927_sent_to_paid: {
        Row: {
          business_id: string | null
          id: string | null
          invoice_number: string | null
          issue_date: string | null
          total_amount: number | null
        }
        ComputedFields: never
        Insert: {
          business_id?: string | null
          id?: string | null
          invoice_number?: string | null
          issue_date?: string | null
          total_amount?: number | null
        }
        Update: {
          business_id?: string | null
          id?: string | null
          invoice_number?: string | null
          issue_date?: string | null
          total_amount?: number | null
        }
        Relationships: []
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
        ComputedFields: never
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
          locked_at: string | null
          match_confidence: number | null
          match_method: string | null
          reference: string | null
          statement_id: string
          transaction_date: string
        }
        ComputedFields: never
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
          locked_at?: string | null
          match_confidence?: number | null
          match_method?: string | null
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
          locked_at?: string | null
          match_confidence?: number | null
          match_method?: string | null
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
            foreignKeyName: "bank_statement_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "bank_statement_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
          is_locked: boolean
          locked_at: string | null
          opening_balance: number
          reconciled_at: string | null
          reconciled_by: string | null
          source: string | null
          statement_date: string
          uploaded_by: string | null
        }
        ComputedFields: never
        Insert: {
          account_id: string
          business_id: string
          closing_balance?: number
          created_at?: string
          id?: string
          is_locked?: boolean
          locked_at?: string | null
          opening_balance?: number
          reconciled_at?: string | null
          reconciled_by?: string | null
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
          is_locked?: boolean
          locked_at?: string | null
          opening_balance?: number
          reconciled_at?: string | null
          reconciled_by?: string | null
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
            foreignKeyName: "bank_statements_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statements_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_statements_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "bank_statements_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
        ComputedFields: never
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
          {
            foreignKeyName: "branches_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "branches_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
        ComputedFields: never
        Insert: {
          account_id: string
          annual_total?: never
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
          annual_total?: never
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
            foreignKeyName: "budget_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
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
            foreignKeyName: "budget_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "budget_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
        ComputedFields: never
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
          {
            foreignKeyName: "budgets_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "budgets_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
      business_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          business_id: string
          email: string | null
          expires_at: string
          id: string
          invited_at: string
          invited_by: string | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          role_assignment_authorized: boolean
          token: string
        }
        ComputedFields: never
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          business_id: string
          email?: string | null
          expires_at?: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          phone?: string | null
          role: Database["public"]["Enums"]["user_role"]
          role_assignment_authorized?: boolean
          token: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          business_id?: string
          email?: string | null
          expires_at?: string
          id?: string
          invited_at?: string
          invited_by?: string | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          role_assignment_authorized?: boolean
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_invitations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_invitations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "business_invitations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
      business_terms_acceptances: {
        Row: {
          accepted_at: string
          business_id: string
          created_at: string
          id: string
          terms_version: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          accepted_at?: string
          business_id: string
          created_at?: string
          id?: string
          terms_version: string
          user_id: string
        }
        Update: {
          accepted_at?: string
          business_id?: string
          created_at?: string
          id?: string
          terms_version?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_terms_acceptances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "business_terms_acceptances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "business_terms_acceptances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
        ComputedFields: never
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
          {
            foreignKeyName: "business_users_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "business_users_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
      businesses: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          base_currency: string
          brand_color: string | null
          capability_overrides: NonNullable<Json>
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
          operating_models: string[]
          organisation_type: string
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
        }
        ComputedFields: never
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          base_currency?: string
          brand_color?: string | null
          capability_overrides?: NonNullable<Json>
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
          operating_models?: string[]
          organisation_type?: string
          payroll_next_number?: number
          payroll_prefix?: string | null
          phone?: string | null
          plan_expires_at?: string | null
          plan_tier?: string
          plan_updated_at?: string | null
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
          capability_overrides?: NonNullable<Json>
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
          operating_models?: string[]
          organisation_type?: string
          payroll_next_number?: number
          payroll_prefix?: string | null
          phone?: string | null
          plan_expires_at?: string | null
          plan_tier?: string
          plan_updated_at?: string | null
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
      construction_delivery_note_lines: {
        Row: {
          business_id: string
          created_at: string
          delivery_note_id: string
          id: string
          line_note: string | null
          line_number: number
          po_line_id: string
          product_id: string
          quantity_declared: number
          quantity_declared_base: number
          uom: string
        }
        ComputedFields: never
        Insert: {
          business_id: string
          created_at?: string
          delivery_note_id: string
          id?: string
          line_note?: string | null
          line_number: number
          po_line_id: string
          product_id: string
          quantity_declared: number
          quantity_declared_base: number
          uom: string
        }
        Update: {
          business_id?: string
          created_at?: string
          delivery_note_id?: string
          id?: string
          line_note?: string | null
          line_number?: number
          po_line_id?: string
          product_id?: string
          quantity_declared?: number
          quantity_declared_base?: number
          uom?: string
        }
        Relationships: [
          {
            foreignKeyName: "construction_delivery_note_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_delivery_note_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_delivery_note_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_delivery_note_lines_delivery_note_id_fkey"
            columns: ["delivery_note_id"]
            isOneToOne: false
            referencedRelation: "construction_delivery_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_delivery_note_lines_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "construction_purchase_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_delivery_note_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_delivery_notes: {
        Row: {
          business_id: string
          client_key: string
          delivery_note_number: string
          document_date: string
          document_received_by: string | null
          evidence_reference: string
          exception_evidence: string | null
          exception_of: string | null
          exception_reason: string | null
          id: string
          is_exception: boolean
          normalized_reference: string
          notes: string | null
          po_id: string
          recorded_at: string
          recorded_by: string
          supplier_contact_id: string
        }
        ComputedFields: never
        Insert: {
          business_id: string
          client_key: string
          delivery_note_number: string
          document_date: string
          document_received_by?: string | null
          evidence_reference: string
          exception_evidence?: string | null
          exception_of?: string | null
          exception_reason?: string | null
          id?: string
          is_exception?: boolean
          normalized_reference: string
          notes?: string | null
          po_id: string
          recorded_at?: string
          recorded_by: string
          supplier_contact_id: string
        }
        Update: {
          business_id?: string
          client_key?: string
          delivery_note_number?: string
          document_date?: string
          document_received_by?: string | null
          evidence_reference?: string
          exception_evidence?: string | null
          exception_of?: string | null
          exception_reason?: string | null
          id?: string
          is_exception?: boolean
          normalized_reference?: string
          notes?: string | null
          po_id?: string
          recorded_at?: string
          recorded_by?: string
          supplier_contact_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "construction_delivery_notes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_delivery_notes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_delivery_notes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_delivery_notes_exception_of_fkey"
            columns: ["exception_of"]
            isOneToOne: false
            referencedRelation: "construction_delivery_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_delivery_notes_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "construction_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_delivery_notes_supplier_contact_id_fkey"
            columns: ["supplier_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_goods_receipt_holds: {
        Row: {
          business_id: string
          created_at: string
          created_by: string
          evidence_reference: string
          grn_line_id: string
          hold_type: string
          id: string
          quantity: number
          quantity_base: number
          reason: string
          release_reason: string | null
          released_at: string | null
          released_by: string | null
          status: string
        }
        ComputedFields: never
        Insert: {
          business_id: string
          created_at?: string
          created_by: string
          evidence_reference: string
          grn_line_id: string
          hold_type: string
          id?: string
          quantity: number
          quantity_base: number
          reason: string
          release_reason?: string | null
          released_at?: string | null
          released_by?: string | null
          status?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string
          evidence_reference?: string
          grn_line_id?: string
          hold_type?: string
          id?: string
          quantity?: number
          quantity_base?: number
          reason?: string
          release_reason?: string | null
          released_at?: string | null
          released_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "construction_goods_receipt_holds_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_goods_receipt_holds_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_goods_receipt_holds_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_goods_receipt_holds_grn_line_id_fkey"
            columns: ["grn_line_id"]
            isOneToOne: false
            referencedRelation: "construction_goods_receipt_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_goods_receipt_lines: {
        Row: {
          accepted_base: number
          business_id: string
          created_at: string
          disputed_base: number
          grn_id: string
          id: string
          line_note: string | null
          line_number: number
          over_receipt_authorized_by: string | null
          over_receipt_evidence: string | null
          over_receipt_exception: boolean
          over_receipt_reason: string | null
          po_line_id: string
          product_id: string
          quantity_accepted: number
          quantity_disputed: number
          quantity_posted_base: number
          quantity_quarantined: number
          quantity_received: number
          quantity_rejected: number
          quarantined_base: number
          received_base: number
          rejected_base: number
          uom: string
        }
        ComputedFields: never
        Insert: {
          accepted_base?: number
          business_id: string
          created_at?: string
          disputed_base?: number
          grn_id: string
          id?: string
          line_note?: string | null
          line_number: number
          over_receipt_authorized_by?: string | null
          over_receipt_evidence?: string | null
          over_receipt_exception?: boolean
          over_receipt_reason?: string | null
          po_line_id: string
          product_id: string
          quantity_accepted?: number
          quantity_disputed?: number
          quantity_posted_base?: number
          quantity_quarantined?: number
          quantity_received: number
          quantity_rejected?: number
          quarantined_base?: number
          received_base: number
          rejected_base?: number
          uom: string
        }
        Update: {
          accepted_base?: number
          business_id?: string
          created_at?: string
          disputed_base?: number
          grn_id?: string
          id?: string
          line_note?: string | null
          line_number?: number
          over_receipt_authorized_by?: string | null
          over_receipt_evidence?: string | null
          over_receipt_exception?: boolean
          over_receipt_reason?: string | null
          po_line_id?: string
          product_id?: string
          quantity_accepted?: number
          quantity_disputed?: number
          quantity_posted_base?: number
          quantity_quarantined?: number
          quantity_received?: number
          quantity_rejected?: number
          quarantined_base?: number
          received_base?: number
          rejected_base?: number
          uom?: string
        }
        Relationships: [
          {
            foreignKeyName: "construction_goods_receipt_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_goods_receipt_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_goods_receipt_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_goods_receipt_lines_grn_id_fkey"
            columns: ["grn_id"]
            isOneToOne: false
            referencedRelation: "construction_goods_receipt_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_goods_receipt_lines_po_line_id_fkey"
            columns: ["po_line_id"]
            isOneToOne: false
            referencedRelation: "construction_purchase_order_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_goods_receipt_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_goods_receipt_notes: {
        Row: {
          branch_id: string
          business_id: string
          client_key: string
          created_at: string
          created_by: string
          delivery_note_id: string | null
          grn_number: string
          id: string
          location_id: string
          notes: string | null
          po_id: string
          project_ref: string
          receipt_date: string
          site_id: string
        }
        ComputedFields: never
        Insert: {
          branch_id: string
          business_id: string
          client_key: string
          created_at?: string
          created_by: string
          delivery_note_id?: string | null
          grn_number: string
          id?: string
          location_id: string
          notes?: string | null
          po_id: string
          project_ref: string
          receipt_date: string
          site_id: string
        }
        Update: {
          branch_id?: string
          business_id?: string
          client_key?: string
          created_at?: string
          created_by?: string
          delivery_note_id?: string | null
          grn_number?: string
          id?: string
          location_id?: string
          notes?: string | null
          po_id?: string
          project_ref?: string
          receipt_date?: string
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "construction_goods_receipt_notes_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_goods_receipt_notes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_goods_receipt_notes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_goods_receipt_notes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_goods_receipt_notes_delivery_note_id_fkey"
            columns: ["delivery_note_id"]
            isOneToOne: false
            referencedRelation: "construction_delivery_notes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_goods_receipt_notes_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_goods_receipt_notes_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "construction_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_goods_receipt_notes_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "construction_procurement_sites"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_material_issues: {
        Row: {
          branch_id: string
          business_id: string
          client_key: string
          currency: string
          evidence_reference: string
          id: string
          issue_date: string
          issued_at: string
          issued_by: string
          issued_to: string | null
          location_id: string
          notes: string | null
          product_id: string
          project_id: string | null
          project_ref: string
          quantity: number
          quantity_base: number
          site_id: string
          stock_movement_id: string
          total_cost_base: number
          unit_cost_base: number
          uom: string
        }
        ComputedFields: never
        Insert: {
          branch_id: string
          business_id: string
          client_key: string
          currency: string
          evidence_reference: string
          id?: string
          issue_date: string
          issued_at?: string
          issued_by: string
          issued_to?: string | null
          location_id: string
          notes?: string | null
          product_id: string
          project_id?: string | null
          project_ref: string
          quantity: number
          quantity_base: number
          site_id: string
          stock_movement_id: string
          total_cost_base: number
          unit_cost_base: number
          uom: string
        }
        Update: {
          branch_id?: string
          business_id?: string
          client_key?: string
          currency?: string
          evidence_reference?: string
          id?: string
          issue_date?: string
          issued_at?: string
          issued_by?: string
          issued_to?: string | null
          location_id?: string
          notes?: string | null
          product_id?: string
          project_id?: string | null
          project_ref?: string
          quantity?: number
          quantity_base?: number
          site_id?: string
          stock_movement_id?: string
          total_cost_base?: number
          unit_cost_base?: number
          uom?: string
        }
        Relationships: [
          {
            foreignKeyName: "construction_material_issues_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_material_issues_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_material_issues_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_material_issues_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_material_issues_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_material_issues_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_material_issues_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "construction_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_material_issues_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_material_issues_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "construction_procurement_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_material_issues_stock_movement_id_fkey"
            columns: ["stock_movement_id"]
            isOneToOne: false
            referencedRelation: "stock_movements"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_material_returns: {
        Row: {
          branch_id: string
          business_id: string
          client_key: string
          condition: string
          created_at: string
          created_by: string
          currency: string
          evidence_reference: string
          id: string
          location_id: string
          notes: string | null
          product_id: string
          project_id: string | null
          project_ref: string
          quantity: number
          quantity_base: number
          reason: string
          received_by: string | null
          return_date: string
          site_id: string
          source_issue_id: string
          stock_movement_id: string
          total_cost_base: number
          unit_cost_base: number
          uom: string
        }
        ComputedFields: never
        Insert: {
          branch_id: string
          business_id: string
          client_key: string
          condition: string
          created_at?: string
          created_by: string
          currency: string
          evidence_reference: string
          id?: string
          location_id: string
          notes?: string | null
          product_id: string
          project_id?: string | null
          project_ref: string
          quantity: number
          quantity_base: number
          reason: string
          received_by?: string | null
          return_date: string
          site_id: string
          source_issue_id: string
          stock_movement_id: string
          total_cost_base: number
          unit_cost_base: number
          uom: string
        }
        Update: {
          branch_id?: string
          business_id?: string
          client_key?: string
          condition?: string
          created_at?: string
          created_by?: string
          currency?: string
          evidence_reference?: string
          id?: string
          location_id?: string
          notes?: string | null
          product_id?: string
          project_id?: string | null
          project_ref?: string
          quantity?: number
          quantity_base?: number
          reason?: string
          received_by?: string | null
          return_date?: string
          site_id?: string
          source_issue_id?: string
          stock_movement_id?: string
          total_cost_base?: number
          unit_cost_base?: number
          uom?: string
        }
        Relationships: [
          {
            foreignKeyName: "construction_material_returns_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_material_returns_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_material_returns_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_material_returns_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_material_returns_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_material_returns_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_material_returns_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "construction_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_material_returns_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_material_returns_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "construction_procurement_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_material_returns_source_issue_id_fkey"
            columns: ["source_issue_id"]
            isOneToOne: false
            referencedRelation: "construction_material_issues"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_material_returns_stock_movement_id_fkey"
            columns: ["stock_movement_id"]
            isOneToOne: false
            referencedRelation: "stock_movements"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_procurement_capabilities: {
        Row: {
          code: string
          description: string
        }
        ComputedFields: never
        Insert: {
          code: string
          description: string
        }
        Update: {
          code?: string
          description?: string
        }
        Relationships: []
      }
      construction_procurement_grants: {
        Row: {
          business_id: string
          capability: string
          grant_reason: string
          granted_at: string
          granted_by: string
          id: string
          revoked_at: string | null
          revoked_by: string | null
          revoked_reason: string | null
          source: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          business_id: string
          capability: string
          grant_reason: string
          granted_at?: string
          granted_by: string
          id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          source?: string
          user_id: string
        }
        Update: {
          business_id?: string
          capability?: string
          grant_reason?: string
          granted_at?: string
          granted_by?: string
          id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "construction_procurement_grants_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_procurement_grants_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_procurement_grants_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_procurement_grants_capability_fkey"
            columns: ["capability"]
            isOneToOne: false
            referencedRelation: "construction_procurement_capabilities"
            referencedColumns: ["code"]
          },
        ]
      }
      construction_procurement_sites: {
        Row: {
          branch_id: string
          business_id: string
          created_at: string
          created_by: string
          id: string
          is_active: boolean
          location_id: string
          project_id: string | null
          project_ref: string
          site_code: string
          site_name: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          branch_id: string
          business_id: string
          created_at?: string
          created_by: string
          id?: string
          is_active?: boolean
          location_id: string
          project_id?: string | null
          project_ref: string
          site_code: string
          site_name: string
          updated_at?: string
        }
        Update: {
          branch_id?: string
          business_id?: string
          created_at?: string
          created_by?: string
          id?: string
          is_active?: boolean
          location_id?: string
          project_id?: string | null
          project_ref?: string
          site_code?: string
          site_name?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "construction_procurement_sites_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_procurement_sites_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_procurement_sites_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_procurement_sites_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_procurement_sites_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_procurement_sites_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "construction_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_procurement_sites_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_product_uom_conversions: {
        Row: {
          approved_at: string
          approved_by: string
          business_id: string
          evidence_reference: string
          factor: number
          from_uom: string
          id: string
          is_active: boolean
          product_id: string
          to_uom: string
        }
        ComputedFields: never
        Insert: {
          approved_at?: string
          approved_by: string
          business_id: string
          evidence_reference: string
          factor: number
          from_uom: string
          id?: string
          is_active?: boolean
          product_id: string
          to_uom: string
        }
        Update: {
          approved_at?: string
          approved_by?: string
          business_id?: string
          evidence_reference?: string
          factor?: number
          from_uom?: string
          id?: string
          is_active?: boolean
          product_id?: string
          to_uom?: string
        }
        Relationships: [
          {
            foreignKeyName: "construction_product_uom_conversions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_product_uom_conversions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_product_uom_conversions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_product_uom_conversions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_projects: {
        Row: {
          boq_locked_at: string | null
          budget: number
          business_id: string
          client_id: string | null
          client_name: string
          contract_sum: number
          created_at: string
          created_by: string
          end_date: string | null
          id: string
          name: string
          retention_pct: number
          start_date: string | null
          status: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          boq_locked_at?: string | null
          budget?: number
          business_id: string
          client_id?: string | null
          client_name?: string
          contract_sum?: number
          created_at?: string
          created_by: string
          end_date?: string | null
          id?: string
          name: string
          retention_pct?: number
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          boq_locked_at?: string | null
          budget?: number
          business_id?: string
          client_id?: string | null
          client_name?: string
          contract_sum?: number
          created_at?: string
          created_by?: string
          end_date?: string | null
          id?: string
          name?: string
          retention_pct?: number
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "construction_projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "projects_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
      construction_purchase_order_events: {
        Row: {
          action: string
          actor: string | null
          business_id: string
          created_at: string
          detail: string | null
          id: number
          po_id: string
        }
        ComputedFields: never
        Insert: {
          action: string
          actor?: string | null
          business_id: string
          created_at?: string
          detail?: string | null
          id?: number
          po_id: string
        }
        Update: {
          action?: string
          actor?: string | null
          business_id?: string
          created_at?: string
          detail?: string | null
          id?: number
          po_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "construction_purchase_order_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_purchase_order_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_purchase_order_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_purchase_order_events_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "construction_purchase_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_purchase_order_lines: {
        Row: {
          business_id: string
          created_at: string
          expected_unit_price: number | null
          id: string
          line_note: string | null
          line_number: number
          po_id: string
          product_id: string
          quantity_ordered: number
          quantity_ordered_base: number
          uom: string
        }
        ComputedFields: never
        Insert: {
          business_id: string
          created_at?: string
          expected_unit_price?: number | null
          id?: string
          line_note?: string | null
          line_number: number
          po_id: string
          product_id: string
          quantity_ordered: number
          quantity_ordered_base: number
          uom: string
        }
        Update: {
          business_id?: string
          created_at?: string
          expected_unit_price?: number | null
          id?: string
          line_note?: string | null
          line_number?: number
          po_id?: string
          product_id?: string
          quantity_ordered?: number
          quantity_ordered_base?: number
          uom?: string
        }
        Relationships: [
          {
            foreignKeyName: "construction_purchase_order_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_purchase_order_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_purchase_order_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_purchase_order_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "construction_purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_purchase_order_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_purchase_orders: {
        Row: {
          authorized_at: string | null
          authorized_by: string | null
          branch_id: string
          business_id: string
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          client_key: string
          created_at: string
          created_by: string
          currency: string
          id: string
          notes: string | null
          po_number: string
          project_id: string | null
          project_ref: string
          site_id: string
          status: string
          supplier_contact_id: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          authorized_at?: string | null
          authorized_by?: string | null
          branch_id: string
          business_id: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_key: string
          created_at?: string
          created_by: string
          currency: string
          id?: string
          notes?: string | null
          po_number: string
          project_id?: string | null
          project_ref: string
          site_id: string
          status?: string
          supplier_contact_id: string
          updated_at?: string
        }
        Update: {
          authorized_at?: string | null
          authorized_by?: string | null
          branch_id?: string
          business_id?: string
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_key?: string
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          notes?: string | null
          po_number?: string
          project_id?: string | null
          project_ref?: string
          site_id?: string
          status?: string
          supplier_contact_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "construction_purchase_orders_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_purchase_orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_purchase_orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_purchase_orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_purchase_orders_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "construction_purchase_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "construction_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_purchase_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_purchase_orders_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "construction_procurement_sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_purchase_orders_supplier_contact_id_fkey"
            columns: ["supplier_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_receipt_bill_allocations: {
        Row: {
          bill_quantity: number
          bill_quantity_base: number
          bill_uom: string
          business_id: string
          client_key: string
          exception_evidence: string | null
          exception_reason: string | null
          expense_id: string
          expense_line_id: string
          grn_line_id: string
          id: string
          is_exception: boolean
          matched_at: string
          matched_by: string
          receipt_quantity: number
          receipt_quantity_base: number
          receipt_uom: string
        }
        ComputedFields: never
        Insert: {
          bill_quantity: number
          bill_quantity_base: number
          bill_uom: string
          business_id: string
          client_key: string
          exception_evidence?: string | null
          exception_reason?: string | null
          expense_id: string
          expense_line_id: string
          grn_line_id: string
          id?: string
          is_exception?: boolean
          matched_at?: string
          matched_by: string
          receipt_quantity: number
          receipt_quantity_base: number
          receipt_uom: string
        }
        Update: {
          bill_quantity?: number
          bill_quantity_base?: number
          bill_uom?: string
          business_id?: string
          client_key?: string
          exception_evidence?: string | null
          exception_reason?: string | null
          expense_id?: string
          expense_line_id?: string
          grn_line_id?: string
          id?: string
          is_exception?: boolean
          matched_at?: string
          matched_by?: string
          receipt_quantity?: number
          receipt_quantity_base?: number
          receipt_uom?: string
        }
        Relationships: [
          {
            foreignKeyName: "construction_receipt_bill_allocations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_receipt_bill_allocations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_receipt_bill_allocations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_receipt_bill_allocations_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_receipt_bill_allocations_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "v_ai_expense_docs"
            referencedColumns: ["expense_id"]
          },
          {
            foreignKeyName: "construction_receipt_bill_allocations_expense_line_id_fkey"
            columns: ["expense_line_id"]
            isOneToOne: false
            referencedRelation: "expense_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_receipt_bill_allocations_grn_line_id_fkey"
            columns: ["grn_line_id"]
            isOneToOne: false
            referencedRelation: "construction_goods_receipt_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_receipt_cost_bases: {
        Row: {
          allocation_id: string
          bill_unit_cost: number | null
          business_id: string
          claimed_at: string
          claimed_by: string
          client_key: string
          cost_currency: string
          discount_deducted: number
          evidence_reference: string
          exchange_rate_used: number
          expense_line_id: string
          grn_line_id: string
          id: string
          nonrecoverable_tax: number
          quantity_base: number
          unit_cost_base: number
          vat_recoverable: boolean
        }
        ComputedFields: never
        Insert: {
          allocation_id: string
          bill_unit_cost?: number | null
          business_id: string
          claimed_at?: string
          claimed_by: string
          client_key: string
          cost_currency: string
          discount_deducted?: number
          evidence_reference: string
          exchange_rate_used?: number
          expense_line_id: string
          grn_line_id: string
          id?: string
          nonrecoverable_tax?: number
          quantity_base: number
          unit_cost_base: number
          vat_recoverable?: boolean
        }
        Update: {
          allocation_id?: string
          bill_unit_cost?: number | null
          business_id?: string
          claimed_at?: string
          claimed_by?: string
          client_key?: string
          cost_currency?: string
          discount_deducted?: number
          evidence_reference?: string
          exchange_rate_used?: number
          expense_line_id?: string
          grn_line_id?: string
          id?: string
          nonrecoverable_tax?: number
          quantity_base?: number
          unit_cost_base?: number
          vat_recoverable?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "construction_receipt_cost_bases_allocation_id_fkey"
            columns: ["allocation_id"]
            isOneToOne: false
            referencedRelation: "construction_receipt_bill_allocations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_receipt_cost_bases_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_receipt_cost_bases_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_receipt_cost_bases_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_receipt_cost_bases_expense_line_id_fkey"
            columns: ["expense_line_id"]
            isOneToOne: false
            referencedRelation: "expense_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_receipt_cost_bases_grn_line_id_fkey"
            columns: ["grn_line_id"]
            isOneToOne: false
            referencedRelation: "construction_goods_receipt_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_receipt_inspections: {
        Row: {
          business_id: string
          certificate_reference: string | null
          client_key: string
          evidence_reference: string
          grn_line_id: string
          id: string
          inspected_at: string
          inspected_by: string
          inspection_date: string
          method: string
          notes: string | null
          outcome: string
          quantity_inspected: number
          quantity_inspected_base: number
        }
        ComputedFields: never
        Insert: {
          business_id: string
          certificate_reference?: string | null
          client_key: string
          evidence_reference: string
          grn_line_id: string
          id?: string
          inspected_at?: string
          inspected_by: string
          inspection_date: string
          method: string
          notes?: string | null
          outcome: string
          quantity_inspected: number
          quantity_inspected_base: number
        }
        Update: {
          business_id?: string
          certificate_reference?: string | null
          client_key?: string
          evidence_reference?: string
          grn_line_id?: string
          id?: string
          inspected_at?: string
          inspected_by?: string
          inspection_date?: string
          method?: string
          notes?: string | null
          outcome?: string
          quantity_inspected?: number
          quantity_inspected_base?: number
        }
        Relationships: [
          {
            foreignKeyName: "construction_receipt_inspections_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_receipt_inspections_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_receipt_inspections_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_receipt_inspections_grn_line_id_fkey"
            columns: ["grn_line_id"]
            isOneToOne: false
            referencedRelation: "construction_goods_receipt_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_receipt_line_reclassifications: {
        Row: {
          accepted_after_base: number
          accepted_before_base: number
          business_id: string
          client_key: string
          evidence_reference: string
          from_bucket: string
          grn_line_id: string
          id: string
          inspection_id: string
          quantity: number
          quantity_base: number
          reason: string
          reclassified_at: string
          reclassified_by: string
          to_bucket: string
        }
        ComputedFields: never
        Insert: {
          accepted_after_base: number
          accepted_before_base: number
          business_id: string
          client_key: string
          evidence_reference: string
          from_bucket: string
          grn_line_id: string
          id?: string
          inspection_id: string
          quantity: number
          quantity_base: number
          reason: string
          reclassified_at?: string
          reclassified_by: string
          to_bucket: string
        }
        Update: {
          accepted_after_base?: number
          accepted_before_base?: number
          business_id?: string
          client_key?: string
          evidence_reference?: string
          from_bucket?: string
          grn_line_id?: string
          id?: string
          inspection_id?: string
          quantity?: number
          quantity_base?: number
          reason?: string
          reclassified_at?: string
          reclassified_by?: string
          to_bucket?: string
        }
        Relationships: [
          {
            foreignKeyName: "construction_receipt_line_reclassifications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_receipt_line_reclassifications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_receipt_line_reclassifications_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_receipt_line_reclassifications_grn_line_id_fkey"
            columns: ["grn_line_id"]
            isOneToOne: false
            referencedRelation: "construction_goods_receipt_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_receipt_line_reclassifications_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "construction_receipt_inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      construction_receipt_posting_policies: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          approved_evidence: string | null
          approved_reason: string | null
          business_id: string
          cost_basis_source: string | null
          gl_posting_enabled: boolean
          movement_posting_enabled: boolean
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          approved_evidence?: string | null
          approved_reason?: string | null
          business_id: string
          cost_basis_source?: string | null
          gl_posting_enabled?: boolean
          movement_posting_enabled?: boolean
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          approved_evidence?: string | null
          approved_reason?: string | null
          business_id?: string
          cost_basis_source?: string | null
          gl_posting_enabled?: boolean
          movement_posting_enabled?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "construction_receipt_posting_policies_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_receipt_posting_policies_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_receipt_posting_policies_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
      construction_supplier_invoice_references: {
        Row: {
          business_id: string
          exception_evidence: string | null
          exception_of: string | null
          exception_reason: string | null
          expense_id: string
          id: string
          recorded_at: string
          recorded_by: string
          reference_normalized: string
          reference_raw: string
          source: string
          status: string
          supplier_contact_id: string
        }
        ComputedFields: never
        Insert: {
          business_id: string
          exception_evidence?: string | null
          exception_of?: string | null
          exception_reason?: string | null
          expense_id: string
          id?: string
          recorded_at?: string
          recorded_by: string
          reference_normalized: string
          reference_raw: string
          source?: string
          status?: string
          supplier_contact_id: string
        }
        Update: {
          business_id?: string
          exception_evidence?: string | null
          exception_of?: string | null
          exception_reason?: string | null
          expense_id?: string
          id?: string
          recorded_at?: string
          recorded_by?: string
          reference_normalized?: string
          reference_raw?: string
          source?: string
          status?: string
          supplier_contact_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "construction_supplier_invoice_referenc_supplier_contact_id_fkey"
            columns: ["supplier_contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_supplier_invoice_references_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_supplier_invoice_references_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_supplier_invoice_references_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "construction_supplier_invoice_references_exception_of_fkey"
            columns: ["exception_of"]
            isOneToOne: false
            referencedRelation: "construction_supplier_invoice_references"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_supplier_invoice_references_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "construction_supplier_invoice_references_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "v_ai_expense_docs"
            referencedColumns: ["expense_id"]
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
        ComputedFields: never
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
            foreignKeyName: "contacts_ap_account_id_fkey"
            columns: ["ap_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
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
            foreignKeyName: "contacts_ar_account_id_fkey"
            columns: ["ar_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "contacts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
        ComputedFields: never
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
        ComputedFields: never
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
          {
            foreignKeyName: "departments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "departments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
        ComputedFields: never
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
            foreignKeyName: "depreciation_schedules_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "depreciation_schedules_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "depreciation_schedules_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "depreciation_schedules_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_movements"
            referencedColumns: ["entry_id"]
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
        ComputedFields: never
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
            foreignKeyName: "employee_allowances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "employee_allowances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
        ComputedFields: never
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
            foreignKeyName: "employee_deductions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "employee_deductions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
          {
            foreignKeyName: "employee_deductions_liability_account_id_fkey"
            columns: ["liability_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
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
        ComputedFields: never
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
            foreignKeyName: "employees_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "employees_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
            foreignKeyName: "employees_paye_liability_account_id_fkey"
            columns: ["paye_liability_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_salary_account_id_fkey"
            columns: ["salary_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_salary_account_id_fkey"
            columns: ["salary_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
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
        ComputedFields: never
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
            foreignKeyName: "exchange_rates_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "exchange_rates_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
        }
        ComputedFields: never
        Insert: {
          account_id?: string | null
          business_id: string
          created_at?: string
          description: string
          discount_amount?: number
          discount_percent?: number
          expense_id: string
          id?: string
          line_number: number
          line_subtotal?: never
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
          discount_amount?: number
          discount_percent?: number
          expense_id?: string
          id?: string
          line_number?: number
          line_subtotal?: never
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
            foreignKeyName: "expense_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
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
            foreignKeyName: "expense_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "expense_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "expense_lines_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_lines_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "v_ai_expense_docs"
            referencedColumns: ["expense_id"]
          },
          {
            foreignKeyName: "expense_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_payments: {
        Row: {
          amount: number
          bank_account_id: string | null
          business_id: string
          client_key: string | null
          created_at: string
          created_by: string | null
          currency: string
          exchange_rate: number
          exchange_rate_used: number | null
          expense_id: string
          functional_amount: number | null
          functional_currency: string | null
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
        ComputedFields: never
        Insert: {
          amount: number
          bank_account_id?: string | null
          business_id: string
          client_key?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          exchange_rate?: number
          exchange_rate_used?: never
          expense_id: string
          functional_amount?: number | null
          functional_currency?: string | null
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
          client_key?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          exchange_rate?: number
          exchange_rate_used?: never
          expense_id?: string
          functional_amount?: number | null
          functional_currency?: string | null
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
            foreignKeyName: "expense_payments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
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
            foreignKeyName: "expense_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "expense_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
            foreignKeyName: "expense_payments_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "v_ai_expense_docs"
            referencedColumns: ["expense_id"]
          },
          {
            foreignKeyName: "expense_payments_functional_currency_fkey"
            columns: ["functional_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "expense_payments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_payments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_movements"
            referencedColumns: ["entry_id"]
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
          client_key: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          department_id: string | null
          discount_amount: number
          discount_percent: number
          due_date: string | null
          exchange_rate: number
          exchange_rate_used: number | null
          expense_date: string
          expense_number: string
          expense_type: string
          functional_amount: number | null
          functional_currency: string | null
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
        ComputedFields: never
        Insert: {
          amount_paid?: number
          ap_account_id?: string | null
          approved_at?: string | null
          approved_by?: string | null
          branch_id?: string | null
          business_id: string
          client_key?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          department_id?: string | null
          discount_amount?: number
          discount_percent?: number
          due_date?: string | null
          exchange_rate?: number
          exchange_rate_used?: never
          expense_date?: string
          expense_number: string
          expense_type?: string
          functional_amount?: number | null
          functional_currency?: string | null
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
          client_key?: string | null
          contact_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          department_id?: string | null
          discount_amount?: number
          discount_percent?: number
          due_date?: string | null
          exchange_rate?: number
          exchange_rate_used?: never
          expense_date?: string
          expense_number?: string
          expense_type?: string
          functional_amount?: number | null
          functional_currency?: string | null
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
            foreignKeyName: "expenses_ap_account_id_fkey"
            columns: ["ap_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
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
            foreignKeyName: "expenses_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "expenses_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "expenses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
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
            foreignKeyName: "expenses_functional_currency_fkey"
            columns: ["functional_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "expenses_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_movements"
            referencedColumns: ["entry_id"]
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
        }
        ComputedFields: never
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
          depreciable_amount?: never
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
          is_depreciable?: boolean
          last_depreciation_date?: string | null
          location?: string | null
          name: string
          net_book_value?: never
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
          depreciable_amount?: never
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
          is_depreciable?: boolean
          last_depreciation_date?: string | null
          location?: string | null
          name?: string
          net_book_value?: never
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
            foreignKeyName: "fixed_assets_accumulated_dep_account_id_fkey"
            columns: ["accumulated_dep_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
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
            foreignKeyName: "fixed_assets_asset_account_id_fkey"
            columns: ["asset_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
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
            foreignKeyName: "fixed_assets_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "fixed_assets_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
            foreignKeyName: "fixed_assets_dep_expense_account_id_fkey"
            columns: ["dep_expense_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
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
            foreignKeyName: "fixed_assets_disposal_journal_id_fkey"
            columns: ["disposal_journal_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_movements"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "fixed_assets_purchase_journal_id_fkey"
            columns: ["purchase_journal_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_purchase_journal_id_fkey"
            columns: ["purchase_journal_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_movements"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "fixed_assets_revaluation_surplus_account_fkey"
            columns: ["revaluation_surplus_account"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_revaluation_surplus_account_fkey"
            columns: ["revaluation_surplus_account"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
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
        ComputedFields: never
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
            foreignKeyName: "fx_revaluations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "fx_revaluations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "fx_revaluations_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fx_revaluations_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_movements"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "fx_revaluations_reversal_entry_id_fkey"
            columns: ["reversal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fx_revaluations_reversal_entry_id_fkey"
            columns: ["reversal_entry_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_movements"
            referencedColumns: ["entry_id"]
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
        ComputedFields: never
        Insert: {
          average_cost?: number
          business_id: string
          id?: string
          last_movement_at?: string | null
          location_id: string
          product_id: string
          quantity_available?: never
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
          quantity_available?: never
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
            foreignKeyName: "inventory_balances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "inventory_balances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
          location_type: string
          name: string
          project_id: string | null
        }
        ComputedFields: never
        Insert: {
          branch_id?: string | null
          business_id: string
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          location_type?: string
          name: string
          project_id?: string | null
        }
        Update: {
          branch_id?: string | null
          business_id?: string
          code?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_default?: boolean
          location_type?: string
          name?: string
          project_id?: string | null
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
          {
            foreignKeyName: "inventory_locations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "inventory_locations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "inventory_locations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "construction_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_locations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_approval_policies: {
        Row: {
          business_id: string
          enabled: boolean
          roles: string[]
          threshold: number | null
          updated_at: string
          updated_by: string | null
        }
        ComputedFields: never
        Insert: {
          business_id: string
          enabled?: boolean
          roles?: string[]
          threshold?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          business_id?: string
          enabled?: boolean
          roles?: string[]
          threshold?: number | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_approval_policies_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_approval_policies_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "invoice_approval_policies_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
      invoice_approvals: {
        Row: {
          approved_at: string
          approved_by: string
          business_id: string
          id: string
          invoice_id: string
          note: string | null
          revoked_at: string | null
          revoked_reason: string | null
        }
        ComputedFields: never
        Insert: {
          approved_at?: string
          approved_by: string
          business_id: string
          id?: string
          invoice_id: string
          note?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
        }
        Update: {
          approved_at?: string
          approved_by?: string
          business_id?: string
          id?: string
          invoice_id?: string
          note?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_approvals_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_approvals_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "invoice_approvals_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "invoice_approvals_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_approvals_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ai_overdue_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_approvals_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ai_revenue_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_approvals_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ai_upcoming_receivables"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_approvals_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ar_ageing"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      invoice_delivery_events: {
        Row: {
          business_id: string
          event_type: string
          id: string
          invoice_id: string
          metadata: NonNullable<Json>
          occurred_at: string
          reminder_stage: string | null
        }
        ComputedFields: never
        Insert: {
          business_id: string
          event_type: string
          id?: string
          invoice_id: string
          metadata?: NonNullable<Json>
          occurred_at?: string
          reminder_stage?: string | null
        }
        Update: {
          business_id?: string
          event_type?: string
          id?: string
          invoice_id?: string
          metadata?: NonNullable<Json>
          occurred_at?: string
          reminder_stage?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_delivery_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_delivery_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "invoice_delivery_events_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "invoice_delivery_events_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_delivery_events_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ai_overdue_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_delivery_events_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ai_revenue_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_delivery_events_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ai_upcoming_receivables"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_delivery_events_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ar_ageing"
            referencedColumns: ["invoice_id"]
          },
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
        }
        ComputedFields: never
        Insert: {
          account_id?: string | null
          business_id: string
          created_at?: string
          description: string
          discount_amount?: number
          discount_percent?: number
          id?: string
          invoice_id: string
          line_number: number
          line_subtotal?: never
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
          discount_amount?: number
          discount_percent?: number
          id?: string
          invoice_id?: string
          line_number?: number
          line_subtotal?: never
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
            foreignKeyName: "invoice_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
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
            foreignKeyName: "invoice_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "invoice_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
            referencedRelation: "v_ai_overdue_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ai_revenue_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ai_upcoming_receivables"
            referencedColumns: ["invoice_id"]
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
          client_key: string | null
          created_at: string
          created_by: string | null
          currency: string
          exchange_rate: number
          exchange_rate_used: number | null
          functional_amount: number | null
          functional_currency: string | null
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
        ComputedFields: never
        Insert: {
          amount: number
          bank_account_id?: string | null
          business_id: string
          client_key?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          exchange_rate?: number
          exchange_rate_used?: never
          functional_amount?: number | null
          functional_currency?: string | null
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
          client_key?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          exchange_rate?: number
          exchange_rate_used?: never
          functional_amount?: number | null
          functional_currency?: string | null
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
            foreignKeyName: "invoice_payments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
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
            foreignKeyName: "invoice_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "invoice_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "invoice_payments_currency_fkey"
            columns: ["currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "invoice_payments_functional_currency_fkey"
            columns: ["functional_currency"]
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
            referencedRelation: "v_ai_overdue_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ai_revenue_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoice_payments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ai_upcoming_receivables"
            referencedColumns: ["invoice_id"]
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
            foreignKeyName: "invoice_payments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_movements"
            referencedColumns: ["entry_id"]
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
          accent_colour: string | null
          amount_due: number | null
          amount_paid: number
          ar_account_id: string | null
          branch_id: string | null
          business_id: string
          client_key: string | null
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
          exchange_rate_used: number | null
          functional_amount: number | null
          functional_currency: string | null
          id: string
          invoice_number: string
          invoice_type: string
          issue_date: string
          journal_entry_id: string | null
          lpo_number: string | null
          notes: string | null
          original_amount: number | null
          original_currency: string | null
          payload_hash: string | null
          payment_provider: string | null
          payment_reference: string | null
          po_number: string | null
          pos_shift_id: string | null
          project_code: string | null
          rate_date: string | null
          rate_is_stale: boolean
          revenue_account_id: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["invoice_status"]
          submitted_by: string | null
          subtotal: number
          taxable_amount: number
          template: string
          terms: string | null
          total_amount: number
          updated_at: string
          vat_amount: number
          viewed_at: string | null
          wht_amount: number
        }
        ComputedFields: never
        Insert: {
          accent_colour?: string | null
          amount_due?: never
          amount_paid?: number
          ar_account_id?: string | null
          branch_id?: string | null
          business_id: string
          client_key?: string | null
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
          exchange_rate_used?: never
          functional_amount?: number | null
          functional_currency?: string | null
          id?: string
          invoice_number: string
          invoice_type?: string
          issue_date?: string
          journal_entry_id?: string | null
          lpo_number?: string | null
          notes?: string | null
          original_amount?: number | null
          original_currency?: string | null
          payload_hash?: string | null
          payment_provider?: string | null
          payment_reference?: string | null
          po_number?: string | null
          pos_shift_id?: string | null
          project_code?: string | null
          rate_date?: string | null
          rate_is_stale?: boolean
          revenue_account_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          submitted_by?: string | null
          subtotal?: number
          taxable_amount?: number
          template?: string
          terms?: string | null
          total_amount?: number
          updated_at?: string
          vat_amount?: number
          viewed_at?: string | null
          wht_amount?: number
        }
        Update: {
          accent_colour?: string | null
          amount_due?: never
          amount_paid?: number
          ar_account_id?: string | null
          branch_id?: string | null
          business_id?: string
          client_key?: string | null
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
          exchange_rate_used?: never
          functional_amount?: number | null
          functional_currency?: string | null
          id?: string
          invoice_number?: string
          invoice_type?: string
          issue_date?: string
          journal_entry_id?: string | null
          lpo_number?: string | null
          notes?: string | null
          original_amount?: number | null
          original_currency?: string | null
          payload_hash?: string | null
          payment_provider?: string | null
          payment_reference?: string | null
          po_number?: string | null
          pos_shift_id?: string | null
          project_code?: string | null
          rate_date?: string | null
          rate_is_stale?: boolean
          revenue_account_id?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["invoice_status"]
          submitted_by?: string | null
          subtotal?: number
          taxable_amount?: number
          template?: string
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
            foreignKeyName: "invoices_ar_account_id_fkey"
            columns: ["ar_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
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
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
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
            referencedRelation: "v_ai_overdue_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoices_credit_note_for_fkey"
            columns: ["credit_note_for"]
            isOneToOne: false
            referencedRelation: "v_ai_revenue_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "invoices_credit_note_for_fkey"
            columns: ["credit_note_for"]
            isOneToOne: false
            referencedRelation: "v_ai_upcoming_receivables"
            referencedColumns: ["invoice_id"]
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
            foreignKeyName: "invoices_functional_currency_fkey"
            columns: ["functional_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "invoices_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_movements"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "invoices_original_currency_fkey"
            columns: ["original_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "invoices_pos_shift_id_fkey"
            columns: ["pos_shift_id"]
            isOneToOne: false
            referencedRelation: "pos_shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_revenue_account_id_fkey"
            columns: ["revenue_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_revenue_account_id_fkey"
            columns: ["revenue_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
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
          posting_key: string | null
          reference: string | null
          reversal_of: string | null
          reversed_by: string | null
          source_id: string | null
          source_type: string | null
          status: Database["public"]["Enums"]["journal_status"]
        }
        ComputedFields: never
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
          posting_key?: string | null
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
          posting_key?: string | null
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
            foreignKeyName: "journal_entries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "journal_entries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
            foreignKeyName: "journal_entries_reversal_of_fkey"
            columns: ["reversal_of"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_movements"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "journal_entries_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_reversed_by_fkey"
            columns: ["reversed_by"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_movements"
            referencedColumns: ["entry_id"]
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
          exchange_rate_used: number | null
          functional_amount: number | null
          functional_currency: string | null
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
        ComputedFields: never
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
          exchange_rate_used?: never
          functional_amount?: number | null
          functional_currency?: string | null
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
          exchange_rate_used?: never
          functional_amount?: number | null
          functional_currency?: string | null
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
            foreignKeyName: "journal_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
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
            foreignKeyName: "journal_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "journal_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
            foreignKeyName: "journal_lines_functional_currency_fkey"
            columns: ["functional_currency"]
            isOneToOne: false
            referencedRelation: "currencies"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "journal_lines_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_lines_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_movements"
            referencedColumns: ["entry_id"]
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
      loan_repayments: {
        Row: {
          amount: number
          bank_account_id: string | null
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          interest_portion: number
          journal_entry_id: string | null
          loan_id: string
          notes: string | null
          principal_portion: number
          reference: string | null
          repayment_date: string
        }
        ComputedFields: never
        Insert: {
          amount: number
          bank_account_id?: string | null
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          interest_portion: number
          journal_entry_id?: string | null
          loan_id: string
          notes?: string | null
          principal_portion: number
          reference?: string | null
          repayment_date: string
        }
        Update: {
          amount?: number
          bank_account_id?: string | null
          business_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          interest_portion?: number
          journal_entry_id?: string | null
          loan_id?: string
          notes?: string | null
          principal_portion?: number
          reference?: string | null
          repayment_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "loan_repayments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_repayments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_repayments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_repayments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "loan_repayments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "loan_repayments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loan_repayments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_movements"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "loan_repayments_loan_id_fkey"
            columns: ["loan_id"]
            isOneToOne: false
            referencedRelation: "loans"
            referencedColumns: ["id"]
          },
        ]
      }
      loans: {
        Row: {
          business_id: string
          created_at: string
          created_by: string | null
          description: string | null
          drawdown_journal_id: string | null
          first_payment_date: string | null
          id: string
          interest_expense_account_id: string | null
          interest_rate_pct: number | null
          lender_name: string
          loan_account_id: string
          principal_amount: number
          start_date: string
          status: string
          term_months: number | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          business_id: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          drawdown_journal_id?: string | null
          first_payment_date?: string | null
          id?: string
          interest_expense_account_id?: string | null
          interest_rate_pct?: number | null
          lender_name: string
          loan_account_id: string
          principal_amount: number
          start_date: string
          status?: string
          term_months?: number | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          drawdown_journal_id?: string | null
          first_payment_date?: string | null
          id?: string
          interest_expense_account_id?: string | null
          interest_rate_pct?: number | null
          lender_name?: string
          loan_account_id?: string
          principal_amount?: number
          start_date?: string
          status?: string
          term_months?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "loans_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "loans_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "loans_drawdown_journal_id_fkey"
            columns: ["drawdown_journal_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_drawdown_journal_id_fkey"
            columns: ["drawdown_journal_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_movements"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "loans_interest_expense_account_id_fkey"
            columns: ["interest_expense_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_interest_expense_account_id_fkey"
            columns: ["interest_expense_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_loan_account_id_fkey"
            columns: ["loan_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loans_loan_account_id_fkey"
            columns: ["loan_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturing_bom_lines: {
        Row: {
          bom_id: string
          component_bom_id: string | null
          component_product_id: string | null
          created_at: string
          id: string
          notes: string | null
          quantity: number
          scrap_pct: number
          unit_of_measure: string | null
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          bom_id: string
          component_bom_id?: string | null
          component_product_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          quantity: number
          scrap_pct?: number
          unit_of_measure?: string | null
          updated_at?: string
        }
        Update: {
          bom_id?: string
          component_bom_id?: string | null
          component_product_id?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          quantity?: number
          scrap_pct?: number
          unit_of_measure?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manufacturing_bom_lines_bom_id_fkey"
            columns: ["bom_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_boms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_bom_lines_component_bom_id_fkey"
            columns: ["component_bom_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_boms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_bom_lines_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturing_boms: {
        Row: {
          bom_locked_at: string | null
          business_id: string
          created_at: string
          created_by: string
          id: string
          notes: string | null
          product_id: string
          status: string
          updated_at: string
          version: number
        }
        ComputedFields: never
        Insert: {
          bom_locked_at?: string | null
          business_id: string
          created_at?: string
          created_by: string
          id?: string
          notes?: string | null
          product_id: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          bom_locked_at?: string | null
          business_id?: string
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          product_id?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "manufacturing_boms_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_boms_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "manufacturing_boms_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "manufacturing_boms_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturing_capabilities: {
        Row: {
          code: string
          description: string
        }
        ComputedFields: never
        Insert: {
          code: string
          description: string
        }
        Update: {
          code?: string
          description?: string
        }
        Relationships: []
      }
      manufacturing_capability_grants: {
        Row: {
          business_id: string
          capability: string
          grant_reason: string
          granted_at: string
          granted_by: string
          id: string
          revoked_at: string | null
          revoked_by: string | null
          revoked_reason: string | null
          user_id: string
        }
        ComputedFields: never
        Insert: {
          business_id: string
          capability: string
          grant_reason: string
          granted_at?: string
          granted_by: string
          id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          user_id: string
        }
        Update: {
          business_id?: string
          capability?: string
          grant_reason?: string
          granted_at?: string
          granted_by?: string
          id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manufacturing_capability_grants_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_capability_grants_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "manufacturing_capability_grants_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "manufacturing_capability_grants_capability_fkey"
            columns: ["capability"]
            isOneToOne: false
            referencedRelation: "manufacturing_capabilities"
            referencedColumns: ["code"]
          },
        ]
      }
      manufacturing_material_transactions: {
        Row: {
          component_product_id: string
          from_location_id: string | null
          id: string
          notes: string | null
          quantity: number
          recorded_at: string
          recorded_by: string
          run_id: string | null
          to_location_id: string | null
          transaction_type: string
          work_order_id: string
        }
        ComputedFields: never
        Insert: {
          component_product_id: string
          from_location_id?: string | null
          id?: string
          notes?: string | null
          quantity: number
          recorded_at?: string
          recorded_by: string
          run_id?: string | null
          to_location_id?: string | null
          transaction_type: string
          work_order_id: string
        }
        Update: {
          component_product_id?: string
          from_location_id?: string | null
          id?: string
          notes?: string | null
          quantity?: number
          recorded_at?: string
          recorded_by?: string
          run_id?: string | null
          to_location_id?: string | null
          transaction_type?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manufacturing_material_transactions_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_material_transactions_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_material_transactions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_production_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_material_transactions_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_material_transactions_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturing_production_runs: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string
          id: string
          notes: string | null
          output_quantity: number
          run_number: number
          scrap_quantity: number
          started_at: string | null
          status: string
          work_order_id: string
        }
        ComputedFields: never
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          notes?: string | null
          output_quantity: number
          run_number: number
          scrap_quantity?: number
          started_at?: string | null
          status?: string
          work_order_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          output_quantity?: number
          run_number?: number
          scrap_quantity?: number
          started_at?: string | null
          status?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manufacturing_production_runs_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturing_work_order_lines: {
        Row: {
          actual_quantity_consumed: number
          component_product_id: string
          created_at: string
          id: string
          notes: string | null
          planned_quantity: number
          scrap_pct: number
          unit_of_measure: string | null
          updated_at: string
          work_order_id: string
        }
        ComputedFields: never
        Insert: {
          actual_quantity_consumed?: number
          component_product_id: string
          created_at?: string
          id?: string
          notes?: string | null
          planned_quantity: number
          scrap_pct?: number
          unit_of_measure?: string | null
          updated_at?: string
          work_order_id: string
        }
        Update: {
          actual_quantity_consumed?: number
          component_product_id?: string
          created_at?: string
          id?: string
          notes?: string | null
          planned_quantity?: number
          scrap_pct?: number
          unit_of_measure?: string | null
          updated_at?: string
          work_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manufacturing_work_order_lines_component_product_id_fkey"
            columns: ["component_product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_work_order_lines_work_order_id_fkey"
            columns: ["work_order_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_work_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      manufacturing_work_orders: {
        Row: {
          actual_end_date: string | null
          actual_start_date: string | null
          bom_id: string
          business_id: string
          completed_quantity: number
          created_at: string
          created_by: string
          from_location_id: string | null
          id: string
          notes: string | null
          planned_end_date: string | null
          planned_quantity: number
          planned_start_date: string | null
          product_id: string
          scrapped_quantity: number
          status: string
          to_location_id: string | null
          updated_at: string
          work_order_number: string
        }
        ComputedFields: never
        Insert: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          bom_id: string
          business_id: string
          completed_quantity?: number
          created_at?: string
          created_by: string
          from_location_id?: string | null
          id?: string
          notes?: string | null
          planned_end_date?: string | null
          planned_quantity: number
          planned_start_date?: string | null
          product_id: string
          scrapped_quantity?: number
          status?: string
          to_location_id?: string | null
          updated_at?: string
          work_order_number: string
        }
        Update: {
          actual_end_date?: string | null
          actual_start_date?: string | null
          bom_id?: string
          business_id?: string
          completed_quantity?: number
          created_at?: string
          created_by?: string
          from_location_id?: string | null
          id?: string
          notes?: string | null
          planned_end_date?: string | null
          planned_quantity?: number
          planned_start_date?: string | null
          product_id?: string
          scrapped_quantity?: number
          status?: string
          to_location_id?: string | null
          updated_at?: string
          work_order_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "manufacturing_work_orders_bom_id_fkey"
            columns: ["bom_id"]
            isOneToOne: false
            referencedRelation: "manufacturing_boms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_work_orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_work_orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "manufacturing_work_orders_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "manufacturing_work_orders_from_location_id_fkey"
            columns: ["from_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_work_orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manufacturing_work_orders_to_location_id_fkey"
            columns: ["to_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
            referencedColumns: ["id"]
          },
        ]
      }
      offline_queue_reconciliations: {
        Row: {
          business_id: string
          captured_at: string | null
          client_key: string
          created_at: string
          denial_code: string | null
          denial_message: string | null
          disposition: string
          exception_class: string
          id: string
          operation_type: string
          origin_device_id: string | null
          origin_user_id: string | null
          reason: string
          reconciled_by: string
          replayed_document_id: string | null
          revalidation: NonNullable<Json>
        }
        ComputedFields: never
        Insert: {
          business_id: string
          captured_at?: string | null
          client_key: string
          created_at?: string
          denial_code?: string | null
          denial_message?: string | null
          disposition: string
          exception_class: string
          id?: string
          operation_type: string
          origin_device_id?: string | null
          origin_user_id?: string | null
          reason: string
          reconciled_by: string
          replayed_document_id?: string | null
          revalidation?: NonNullable<Json>
        }
        Update: {
          business_id?: string
          captured_at?: string | null
          client_key?: string
          created_at?: string
          denial_code?: string | null
          denial_message?: string | null
          disposition?: string
          exception_class?: string
          id?: string
          operation_type?: string
          origin_device_id?: string | null
          origin_user_id?: string | null
          reason?: string
          reconciled_by?: string
          replayed_document_id?: string | null
          revalidation?: NonNullable<Json>
        }
        Relationships: [
          {
            foreignKeyName: "offline_queue_reconciliations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "offline_queue_reconciliations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "offline_queue_reconciliations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
      partner_admins: {
        Row: {
          created_at: string
          partner_id: string
          role: string
          user_id: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          partner_id: string
          role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          partner_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_admins_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_clients: {
        Row: {
          business_id: string
          created_at: string | null
          partner_id: string
        }
        ComputedFields: never
        Insert: {
          business_id: string
          created_at?: string | null
          partner_id: string
        }
        Update: {
          business_id?: string
          created_at?: string | null
          partner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_clients_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "partner_clients_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "partner_clients_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "partner_clients_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_feature_flags: {
        Row: {
          enabled: boolean | null
          feature_key: string
          partner_id: string
        }
        ComputedFields: never
        Insert: {
          enabled?: boolean | null
          feature_key: string
          partner_id: string
        }
        Update: {
          enabled?: boolean | null
          feature_key?: string
          partner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "partner_feature_flags_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_invoices: {
        Row: {
          amount: number | null
          client_count: number
          created_at: string | null
          currency: string | null
          due_date: string | null
          id: string
          invoice_number: string | null
          notes: string | null
          partner_id: string | null
          period_end: string | null
          period_start: string | null
          status: string | null
          updated_at: string | null
        }
        ComputedFields: never
        Insert: {
          amount?: number | null
          client_count?: number
          created_at?: string | null
          currency?: string | null
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          notes?: string | null
          partner_id?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number | null
          client_count?: number
          created_at?: string | null
          currency?: string | null
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          notes?: string | null
          partner_id?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "partner_invoices_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      partners: {
        Row: {
          allow_client_visibility: boolean
          app_name: string | null
          billing_contact_name: string | null
          billing_currency: string
          billing_email: string | null
          client_limit: number | null
          created_at: string | null
          custom_domain: string | null
          domain: string | null
          id: string
          is_active: boolean | null
          logo_url: string | null
          name: string
          onboarding_subtitle: string | null
          onboarding_title: string | null
          price_per_client: number
          primary_colour: string | null
          slug: string | null
          support_email: string | null
          support_phone: string | null
          updated_at: string | null
        }
        ComputedFields: never
        Insert: {
          allow_client_visibility?: boolean
          app_name?: string | null
          billing_contact_name?: string | null
          billing_currency?: string
          billing_email?: string | null
          client_limit?: number | null
          created_at?: string | null
          custom_domain?: string | null
          domain?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name: string
          onboarding_subtitle?: string | null
          onboarding_title?: string | null
          price_per_client?: number
          primary_colour?: string | null
          slug?: string | null
          support_email?: string | null
          support_phone?: string | null
          updated_at?: string | null
        }
        Update: {
          allow_client_visibility?: boolean
          app_name?: string | null
          billing_contact_name?: string | null
          billing_currency?: string
          billing_email?: string | null
          client_limit?: number | null
          created_at?: string | null
          custom_domain?: string | null
          domain?: string | null
          id?: string
          is_active?: boolean | null
          logo_url?: string | null
          name?: string
          onboarding_subtitle?: string | null
          onboarding_title?: string | null
          price_per_client?: number
          primary_colour?: string | null
          slug?: string | null
          support_email?: string | null
          support_phone?: string | null
          updated_at?: string | null
        }
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
        }
        ComputedFields: never
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
          {
            foreignKeyName: "paye_bands_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "paye_bands_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
        ComputedFields: never
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
            foreignKeyName: "payroll_employee_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "payroll_employee_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
          client_key: string | null
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
        ComputedFields: never
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          business_id: string
          client_key?: string | null
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
          client_key?: string | null
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
            foreignKeyName: "payroll_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "payroll_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "payroll_runs_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_runs_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_movements"
            referencedColumns: ["entry_id"]
          },
        ]
      }
      phone_accounts: {
        Row: {
          business_id: string | null
          created_at: string
          created_by: string | null
          phone: string
          temporary_password: boolean
          user_id: string
        }
        ComputedFields: never
        Insert: {
          business_id?: string | null
          created_at?: string
          created_by?: string | null
          phone: string
          temporary_password?: boolean
          user_id: string
        }
        Update: {
          business_id?: string | null
          created_at?: string
          created_by?: string | null
          phone?: string
          temporary_password?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phone_accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "phone_accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
      pos_approvals: {
        Row: {
          action: string
          amount: number | null
          authorized_at: string | null
          authorized_by: string | null
          business_id: string
          consumed_at: string | null
          consumed_by: string | null
          created_at: string
          document_id: string
          expires_at: string
          id: string
          requested_by: string
          token: string
        }
        ComputedFields: never
        Insert: {
          action: string
          amount?: number | null
          authorized_at?: string | null
          authorized_by?: string | null
          business_id: string
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          document_id: string
          expires_at: string
          id?: string
          requested_by: string
          token?: string
        }
        Update: {
          action?: string
          amount?: number | null
          authorized_at?: string | null
          authorized_by?: string | null
          business_id?: string
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          document_id?: string
          expires_at?: string
          id?: string
          requested_by?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_approvals_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_approvals_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "pos_approvals_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "pos_approvals_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_approvals_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "v_ai_overdue_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "pos_approvals_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "v_ai_revenue_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "pos_approvals_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "v_ai_upcoming_receivables"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "pos_approvals_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "v_ar_ageing"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      pos_cash_movements: {
        Row: {
          amount: number
          branch_id: string | null
          business_id: string
          command_key: string | null
          created_at: string
          id: string
          movement_type: string
          reason: string
          shift_id: string | null
          user_id: string | null
          user_name: string | null
        }
        ComputedFields: never
        Insert: {
          amount: number
          branch_id?: string | null
          business_id: string
          command_key?: string | null
          created_at?: string
          id?: string
          movement_type: string
          reason: string
          shift_id?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Update: {
          amount?: number
          branch_id?: string | null
          business_id?: string
          command_key?: string | null
          created_at?: string
          id?: string
          movement_type?: string
          reason?: string
          shift_id?: string | null
          user_id?: string | null
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_cash_movements_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_cash_movements_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_cash_movements_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "pos_cash_movements_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "pos_cash_movements_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "pos_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_corrections: {
        Row: {
          amount: number
          approval_id: string | null
          business_id: string
          command_key: string
          command_type: string
          created_at: string
          created_by: string
          currency: string
          document_id: string
          id: string
          journal_entry_id: string | null
          lines: NonNullable<Json>
          reason: string | null
        }
        ComputedFields: never
        Insert: {
          amount?: number
          approval_id?: string | null
          business_id: string
          command_key: string
          command_type: string
          created_at?: string
          created_by: string
          currency: string
          document_id: string
          id?: string
          journal_entry_id?: string | null
          lines?: NonNullable<Json>
          reason?: string | null
        }
        Update: {
          amount?: number
          approval_id?: string | null
          business_id?: string
          command_key?: string
          command_type?: string
          created_at?: string
          created_by?: string
          currency?: string
          document_id?: string
          id?: string
          journal_entry_id?: string | null
          lines?: NonNullable<Json>
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_corrections_approval_id_fkey"
            columns: ["approval_id"]
            isOneToOne: false
            referencedRelation: "pos_approvals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_corrections_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_corrections_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "pos_corrections_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "pos_corrections_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_corrections_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "v_ai_overdue_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "pos_corrections_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "v_ai_revenue_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "pos_corrections_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "v_ai_upcoming_receivables"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "pos_corrections_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "v_ar_ageing"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      pos_price_overrides: {
        Row: {
          authorized_at: string | null
          authorized_by: string | null
          business_id: string
          consumed_at: string | null
          consumed_by: string | null
          consumed_invoice_id: string | null
          created_at: string
          expires_at: string
          id: string
          kind: string
          max_discount_percent: number | null
          product_id: string | null
          reason: string | null
          requested_by: string
          token: string
          unit_price: number | null
        }
        ComputedFields: never
        Insert: {
          authorized_at?: string | null
          authorized_by?: string | null
          business_id: string
          consumed_at?: string | null
          consumed_by?: string | null
          consumed_invoice_id?: string | null
          created_at?: string
          expires_at: string
          id?: string
          kind: string
          max_discount_percent?: number | null
          product_id?: string | null
          reason?: string | null
          requested_by: string
          token?: string
          unit_price?: number | null
        }
        Update: {
          authorized_at?: string | null
          authorized_by?: string | null
          business_id?: string
          consumed_at?: string | null
          consumed_by?: string | null
          consumed_invoice_id?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          kind?: string
          max_discount_percent?: number | null
          product_id?: string | null
          reason?: string | null
          requested_by?: string
          token?: string
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_price_overrides_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_price_overrides_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "pos_price_overrides_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "pos_price_overrides_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_settings: {
        Row: {
          business_id: string
          cashier_max_discount_percent: number
          created_at: string
          custom_role_permissions: NonNullable<Json>
          enabled_payment_methods: NonNullable<Json>
          id: string
          manager_max_discount_percent: number
          receipt_footer: string
          receipt_header: string | null
          require_approval_for_refund: boolean
          require_approval_for_void: boolean
          require_explanation_variance_threshold: number
          show_tax_on_receipt: boolean
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          business_id: string
          cashier_max_discount_percent?: number
          created_at?: string
          custom_role_permissions?: NonNullable<Json>
          enabled_payment_methods?: NonNullable<Json>
          id?: string
          manager_max_discount_percent?: number
          receipt_footer?: string
          receipt_header?: string | null
          require_approval_for_refund?: boolean
          require_approval_for_void?: boolean
          require_explanation_variance_threshold?: number
          show_tax_on_receipt?: boolean
          updated_at?: string
        }
        Update: {
          business_id?: string
          cashier_max_discount_percent?: number
          created_at?: string
          custom_role_permissions?: NonNullable<Json>
          enabled_payment_methods?: NonNullable<Json>
          id?: string
          manager_max_discount_percent?: number
          receipt_footer?: string
          receipt_header?: string | null
          require_approval_for_refund?: boolean
          require_approval_for_void?: boolean
          require_explanation_variance_threshold?: number
          show_tax_on_receipt?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_settings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_settings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "pos_settings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
      pos_shift_closes: {
        Row: {
          actual_cash: number
          branch_id: string | null
          business_id: string
          cash_in_total: number
          cash_out_total: number
          cash_tenders: number
          cashier_id: string | null
          closed_at: string
          closed_by: string
          command_key: string
          created_at: string
          expected_cash: number
          id: string
          notes: string | null
          opened_at: string
          opening_cash: number
          other_tenders: number
          payload: NonNullable<Json>
          refund_total: number
          report_number: string
          sales_count: number
          shift_id: string
          tender_breakdown: NonNullable<Json>
          terminal_id: string | null
          variance: number
          variance_reason: string | null
        }
        ComputedFields: never
        Insert: {
          actual_cash: number
          branch_id?: string | null
          business_id: string
          cash_in_total: number
          cash_out_total: number
          cash_tenders: number
          cashier_id?: string | null
          closed_at: string
          closed_by: string
          command_key: string
          created_at?: string
          expected_cash: number
          id?: string
          notes?: string | null
          opened_at: string
          opening_cash: number
          other_tenders: number
          payload: NonNullable<Json>
          refund_total: number
          report_number: string
          sales_count: number
          shift_id: string
          tender_breakdown?: NonNullable<Json>
          terminal_id?: string | null
          variance: number
          variance_reason?: string | null
        }
        Update: {
          actual_cash?: number
          branch_id?: string | null
          business_id?: string
          cash_in_total?: number
          cash_out_total?: number
          cash_tenders?: number
          cashier_id?: string | null
          closed_at?: string
          closed_by?: string
          command_key?: string
          created_at?: string
          expected_cash?: number
          id?: string
          notes?: string | null
          opened_at?: string
          opening_cash?: number
          other_tenders?: number
          payload?: NonNullable<Json>
          refund_total?: number
          report_number?: string
          sales_count?: number
          shift_id?: string
          tender_breakdown?: NonNullable<Json>
          terminal_id?: string | null
          variance?: number
          variance_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_shift_closes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_shift_closes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "pos_shift_closes_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "pos_shift_closes_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "pos_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_shift_late_adjustments: {
        Row: {
          amount: number
          business_id: string
          command_key: string
          created_at: string
          detected_at: string
          id: string
          invoice_id: string | null
          reason: string
          shift_id: string
        }
        ComputedFields: never
        Insert: {
          amount: number
          business_id: string
          command_key: string
          created_at?: string
          detected_at: string
          id?: string
          invoice_id?: string | null
          reason: string
          shift_id: string
        }
        Update: {
          amount?: number
          business_id?: string
          command_key?: string
          created_at?: string
          detected_at?: string
          id?: string
          invoice_id?: string | null
          reason?: string
          shift_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pos_shift_late_adjustments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_shift_late_adjustments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "pos_shift_late_adjustments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "pos_shift_late_adjustments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_shift_late_adjustments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ai_overdue_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "pos_shift_late_adjustments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ai_revenue_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "pos_shift_late_adjustments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ai_upcoming_receivables"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "pos_shift_late_adjustments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ar_ageing"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "pos_shift_late_adjustments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "pos_shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_shifts: {
        Row: {
          actual_cash: number | null
          branch_id: string | null
          business_id: string
          cash_in_amount: number
          cash_out_amount: number
          cash_sales_amount: number
          cash_variance: number | null
          cashier_id: string | null
          cashier_name: string | null
          closed_at: string | null
          created_at: string
          expected_cash: number
          id: string
          notes: string | null
          open_command_key: string | null
          opened_at: string
          opening_cash: number
          other_sales_amount: number
          refunds_amount: number
          status: string
          terminal_id: string | null
          total_sales_amount: number
          updated_at: string
          variance_reason: string | null
        }
        ComputedFields: never
        Insert: {
          actual_cash?: number | null
          branch_id?: string | null
          business_id: string
          cash_in_amount?: number
          cash_out_amount?: number
          cash_sales_amount?: number
          cash_variance?: number | null
          cashier_id?: string | null
          cashier_name?: string | null
          closed_at?: string | null
          created_at?: string
          expected_cash?: number
          id?: string
          notes?: string | null
          open_command_key?: string | null
          opened_at?: string
          opening_cash?: number
          other_sales_amount?: number
          refunds_amount?: number
          status?: string
          terminal_id?: string | null
          total_sales_amount?: number
          updated_at?: string
          variance_reason?: string | null
        }
        Update: {
          actual_cash?: number | null
          branch_id?: string | null
          business_id?: string
          cash_in_amount?: number
          cash_out_amount?: number
          cash_sales_amount?: number
          cash_variance?: number | null
          cashier_id?: string | null
          cashier_name?: string | null
          closed_at?: string | null
          created_at?: string
          expected_cash?: number
          id?: string
          notes?: string | null
          open_command_key?: string | null
          opened_at?: string
          opening_cash?: number
          other_sales_amount?: number
          refunds_amount?: number
          status?: string
          terminal_id?: string | null
          total_sales_amount?: number
          updated_at?: string
          variance_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_shifts_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_shifts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_shifts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "pos_shifts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "pos_shifts_terminal_id_fkey"
            columns: ["terminal_id"]
            isOneToOne: false
            referencedRelation: "pos_terminals"
            referencedColumns: ["id"]
          },
        ]
      }
      pos_terminals: {
        Row: {
          branch_id: string
          business_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          preferred_location_id: string | null
        }
        ComputedFields: never
        Insert: {
          branch_id: string
          business_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          preferred_location_id?: string | null
        }
        Update: {
          branch_id?: string
          business_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          preferred_location_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pos_terminals_branch_id_fkey"
            columns: ["branch_id"]
            isOneToOne: false
            referencedRelation: "branches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_terminals_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pos_terminals_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "pos_terminals_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "pos_terminals_preferred_location_id_fkey"
            columns: ["preferred_location_id"]
            isOneToOne: false
            referencedRelation: "inventory_locations"
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
        ComputedFields: never
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
            foreignKeyName: "product_categories_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "product_categories_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
          cost_price: number | null
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
        ComputedFields: never
        Insert: {
          barcode?: string | null
          business_id: string
          category_id?: string | null
          cogs_account_id?: string | null
          cost_price?: number | null
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
          cost_price?: number | null
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
            foreignKeyName: "products_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "products_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
            foreignKeyName: "products_cogs_account_id_fkey"
            columns: ["cogs_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
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
            foreignKeyName: "products_inventory_account_id_fkey"
            columns: ["inventory_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
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
            foreignKeyName: "products_purchase_account_id_fkey"
            columns: ["purchase_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_sales_account_id_fkey"
            columns: ["sales_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_sales_account_id_fkey"
            columns: ["sales_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          full_name: string | null
          id: string
        }
        ComputedFields: never
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
      project_boq_lines: {
        Row: {
          created_at: string
          description: string
          id: string
          line_number: string
          project_id: string
          quantity: number
          rate: number
          sort_order: number
          total_value: number
          unit: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          description?: string
          id?: string
          line_number: string
          project_id: string
          quantity?: number
          rate?: number
          sort_order?: number
          total_value?: number
          unit?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          line_number?: string
          project_id?: string
          quantity?: number
          rate?: number
          sort_order?: number
          total_value?: number
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_boq_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "construction_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_boq_lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_retention_ledger: {
        Row: {
          amount: number
          created_at: string
          created_by: string
          description: string | null
          id: string
          invoice_id: string | null
          project_id: string
          type: string
          valuation_id: string | null
        }
        ComputedFields: never
        Insert: {
          amount: number
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          invoice_id?: string | null
          project_id: string
          type: string
          valuation_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          invoice_id?: string | null
          project_id?: string
          type?: string
          valuation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_retention_ledger_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_retention_ledger_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ai_overdue_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "project_retention_ledger_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ai_revenue_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "project_retention_ledger_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ai_upcoming_receivables"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "project_retention_ledger_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ar_ageing"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "project_retention_ledger_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "construction_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_retention_ledger_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_retention_ledger_valuation_id_fkey"
            columns: ["valuation_id"]
            isOneToOne: false
            referencedRelation: "project_valuations"
            referencedColumns: ["id"]
          },
        ]
      }
      project_status_log: {
        Row: {
          changed_at: string
          changed_by: string
          from_status: string
          id: string
          project_id: string
          reason: string | null
          to_status: string
        }
        ComputedFields: never
        Insert: {
          changed_at?: string
          changed_by: string
          from_status: string
          id?: string
          project_id: string
          reason?: string | null
          to_status: string
        }
        Update: {
          changed_at?: string
          changed_by?: string
          from_status?: string
          id?: string
          project_id?: string
          reason?: string | null
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_status_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "construction_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_status_log_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_valuation_lines: {
        Row: {
          boq_line_id: string
          cumulative_pct: number
          cumulative_value: number
          id: string
          notes: string | null
          period_value: number
          previous_cumulative_value: number
          valuation_id: string
        }
        ComputedFields: never
        Insert: {
          boq_line_id: string
          cumulative_pct: number
          cumulative_value?: number
          id?: string
          notes?: string | null
          period_value?: number
          previous_cumulative_value?: number
          valuation_id: string
        }
        Update: {
          boq_line_id?: string
          cumulative_pct?: number
          cumulative_value?: number
          id?: string
          notes?: string | null
          period_value?: number
          previous_cumulative_value?: number
          valuation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_valuation_lines_boq_line_id_fkey"
            columns: ["boq_line_id"]
            isOneToOne: false
            referencedRelation: "project_boq_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_valuation_lines_valuation_id_fkey"
            columns: ["valuation_id"]
            isOneToOne: false
            referencedRelation: "project_valuations"
            referencedColumns: ["id"]
          },
        ]
      }
      project_valuations: {
        Row: {
          created_at: string
          created_by: string
          gross_amount: number
          id: string
          invoice_id: string | null
          net_amount: number
          notes: string | null
          period_end: string | null
          period_start: string | null
          previous_cumulative: number
          project_id: string
          retention_amount: number
          status: string
          updated_at: string
          valuation_date: string
          valuation_number: number
        }
        ComputedFields: never
        Insert: {
          created_at?: string
          created_by: string
          gross_amount?: number
          id?: string
          invoice_id?: string | null
          net_amount?: number
          notes?: string | null
          period_end?: string | null
          period_start?: string | null
          previous_cumulative?: number
          project_id: string
          retention_amount?: number
          status?: string
          updated_at?: string
          valuation_date?: string
          valuation_number: number
        }
        Update: {
          created_at?: string
          created_by?: string
          gross_amount?: number
          id?: string
          invoice_id?: string | null
          net_amount?: number
          notes?: string | null
          period_end?: string | null
          period_start?: string | null
          previous_cumulative?: number
          project_id?: string
          retention_amount?: number
          status?: string
          updated_at?: string
          valuation_date?: string
          valuation_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "project_valuations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_valuations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ai_overdue_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "project_valuations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ai_revenue_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "project_valuations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ai_upcoming_receivables"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "project_valuations_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ar_ageing"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "project_valuations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "construction_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "project_valuations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_invoices: {
        Row: {
          active: boolean
          auto_send: boolean
          business_id: string
          created_at: string
          frequency: string
          id: string
          next_run_date: string
          template_invoice_id: string
        }
        ComputedFields: never
        Insert: {
          active?: boolean
          auto_send?: boolean
          business_id: string
          created_at?: string
          frequency: string
          id?: string
          next_run_date: string
          template_invoice_id: string
        }
        Update: {
          active?: boolean
          auto_send?: boolean
          business_id?: string
          created_at?: string
          frequency?: string
          id?: string
          next_run_date?: string
          template_invoice_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "recurring_invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "recurring_invoices_template_invoice_id_fkey"
            columns: ["template_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_invoices_template_invoice_id_fkey"
            columns: ["template_invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ai_overdue_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "recurring_invoices_template_invoice_id_fkey"
            columns: ["template_invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ai_revenue_invoices"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "recurring_invoices_template_invoice_id_fkey"
            columns: ["template_invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ai_upcoming_receivables"
            referencedColumns: ["invoice_id"]
          },
          {
            foreignKeyName: "recurring_invoices_template_invoice_id_fkey"
            columns: ["template_invoice_id"]
            isOneToOne: false
            referencedRelation: "v_ar_ageing"
            referencedColumns: ["invoice_id"]
          },
        ]
      }
      share_transactions: {
        Row: {
          amount: number
          bank_account_id: string | null
          business_id: string
          created_at: string
          created_by: string | null
          id: string
          journal_entry_id: string | null
          notes: string | null
          reference: string | null
          share_account_id: string
          shareholder_name: string
          shares_count: number | null
          transaction_type: string
        }
        ComputedFields: never
        Insert: {
          amount: number
          bank_account_id?: string | null
          business_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          journal_entry_id?: string | null
          notes?: string | null
          reference?: string | null
          share_account_id: string
          shareholder_name: string
          shares_count?: number | null
          transaction_type: string
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
          reference?: string | null
          share_account_id?: string
          shareholder_name?: string
          shares_count?: number | null
          transaction_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "share_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_transactions_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_transactions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_transactions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "share_transactions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "share_transactions_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_transactions_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_movements"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "share_transactions_share_account_id_fkey"
            columns: ["share_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "share_transactions_share_account_id_fkey"
            columns: ["share_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          business_id: string
          client_key: string | null
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
        ComputedFields: never
        Insert: {
          business_id: string
          client_key?: string | null
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
          total_cost?: never
          unit_cost?: number
        }
        Update: {
          business_id?: string
          client_key?: string | null
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
          total_cost?: never
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
            foreignKeyName: "stock_movements_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "stock_movements_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
        ComputedFields: never
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
            foreignKeyName: "stock_transfer_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "stock_transfer_lines_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "stock_transfer_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
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
        ComputedFields: never
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
            foreignKeyName: "stock_transfers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "stock_transfers_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
      subscription_payments: {
        Row: {
          amount: number
          billing_cycle: string
          business_id: string
          checkout_url: string | null
          created_at: string
          currency: string
          gateway: string
          gateway_reference: string | null
          id: string
          initiated_by: string | null
          plan_expires_at: string | null
          raw_response: Json | null
          status: string
          target_plan_tier: string
          tx_ref: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          amount: number
          billing_cycle: string
          business_id: string
          checkout_url?: string | null
          created_at?: string
          currency?: string
          gateway?: string
          gateway_reference?: string | null
          id?: string
          initiated_by?: string | null
          plan_expires_at?: string | null
          raw_response?: Json | null
          status?: string
          target_plan_tier: string
          tx_ref: string
          updated_at?: string
        }
        Update: {
          amount?: number
          billing_cycle?: string
          business_id?: string
          checkout_url?: string | null
          created_at?: string
          currency?: string
          gateway?: string
          gateway_reference?: string | null
          id?: string
          initiated_by?: string | null
          plan_expires_at?: string | null
          raw_response?: Json | null
          status?: string
          target_plan_tier?: string
          tx_ref?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "subscription_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
      subscription_reminders_sent: {
        Row: {
          business_id: string
          days_before: number
          id: string
          plan_expires_at: string
          sent_at: string
        }
        ComputedFields: never
        Insert: {
          business_id: string
          days_before: number
          id?: string
          plan_expires_at: string
          sent_at?: string
        }
        Update: {
          business_id?: string
          days_before?: number
          id?: string
          plan_expires_at?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_reminders_sent_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_reminders_sent_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "subscription_reminders_sent_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          business_id: string
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          id: string
          plan_tier: string
          status: string
          updated_at: string | null
        }
        ComputedFields: never
        Insert: {
          business_id: string
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan_tier: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          business_id?: string
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan_tier?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "subscriptions_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
      support_agent_usage: {
        Row: {
          count: number
          user_id: string
          window_start: string
        }
        ComputedFields: never
        Insert: {
          count?: number
          user_id: string
          window_start: string
        }
        Update: {
          count?: number
          user_id?: string
          window_start?: string
        }
        Relationships: []
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
        ComputedFields: never
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
            foreignKeyName: "tax_alerts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "tax_alerts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
        ComputedFields: never
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
            foreignKeyName: "tax_configurations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "tax_configurations_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "tax_configurations_tax_payable_account_id_fkey"
            columns: ["tax_payable_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_configurations_tax_payable_account_id_fkey"
            columns: ["tax_payable_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_configurations_tax_receivable_account_id_fkey"
            columns: ["tax_receivable_account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_configurations_tax_receivable_account_id_fkey"
            columns: ["tax_receivable_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
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
        ComputedFields: never
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
            foreignKeyName: "tax_payments_bank_account_id_fkey"
            columns: ["bank_account_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_accounts"
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
            foreignKeyName: "tax_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "tax_payments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "tax_payments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_payments_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_movements"
            referencedColumns: ["entry_id"]
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
        ComputedFields: never
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
            foreignKeyName: "tax_returns_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "tax_returns_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "tax_returns_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tax_returns_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "v_ai_cash_movements"
            referencedColumns: ["entry_id"]
          },
        ]
      }
      usage_counters: {
        Row: {
          business_id: string
          id: string
          period_end: string
          period_start: string
          transaction_count: number | null
          updated_at: string | null
        }
        ComputedFields: never
        Insert: {
          business_id: string
          id?: string
          period_end: string
          period_start: string
          transaction_count?: number | null
          updated_at?: string | null
        }
        Update: {
          business_id?: string
          id?: string
          period_end?: string
          period_start?: string
          transaction_count?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_counters_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_counters_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "usage_counters_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
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
          is_platform_admin: boolean
          phone: string | null
          preferred_currency:
            | Database["public"]["Enums"]["currency_code"]
            | null
          preferred_language: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          avatar_url?: string | null
          created_at?: string
          deletion_finalized_at?: string | null
          deletion_requested_at?: string | null
          full_name: string
          id: string
          is_platform_admin?: boolean
          phone?: string | null
          preferred_currency?:
            | Database["public"]["Enums"]["currency_code"]
            | null
          preferred_language?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          deletion_finalized_at?: string | null
          deletion_requested_at?: string | null
          full_name?: string
          id?: string
          is_platform_admin?: boolean
          phone?: string | null
          preferred_currency?:
            | Database["public"]["Enums"]["currency_code"]
            | null
          preferred_language?: string
          updated_at?: string
        }
        Relationships: []
      }
      webhook_deliveries: {
        Row: {
          attempt: number
          attempts: number | null
          created_at: string | null
          delivered_at: string | null
          event: string
          id: string
          payload: Json | null
          response_body: string | null
          status_code: number | null
          webhook_id: string
        }
        ComputedFields: never
        Insert: {
          attempt?: number
          attempts?: number | null
          created_at?: string | null
          delivered_at?: string | null
          event: string
          id?: string
          payload?: Json | null
          response_body?: string | null
          status_code?: number | null
          webhook_id: string
        }
        Update: {
          attempt?: number
          attempts?: number | null
          created_at?: string | null
          delivered_at?: string | null
          event?: string
          id?: string
          payload?: Json | null
          response_body?: string | null
          status_code?: number | null
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "webhooks"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks: {
        Row: {
          business_id: string
          consecutive_failures: number
          created_at: string | null
          created_by: string | null
          events: string[]
          id: string
          is_active: boolean | null
          last_triggered_at: string | null
          secret: string
          updated_at: string
          url: string
        }
        ComputedFields: never
        Insert: {
          business_id: string
          consecutive_failures?: number
          created_at?: string | null
          created_by?: string | null
          events: string[]
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          secret?: string
          updated_at?: string
          url: string
        }
        Update: {
          business_id?: string
          consecutive_failures?: number
          created_at?: string | null
          created_by?: string | null
          events?: string[]
          id?: string
          is_active?: boolean | null
          last_triggered_at?: string | null
          secret?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhooks_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "webhooks_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
    }
    Views: {
      business_members: {
        Row: {
          branch_id: string | null
          business_id: string
          is_active: boolean
          role: Database["public"]["Enums"]["user_role"]
          user_id: string
        }
        ComputedFields: never
        Insert: {
          branch_id?: string | null
          business_id?: string | null
          is_active?: boolean | null
          role?: Database["public"]["Enums"]["user_role"] | null
          user_id?: string | null
        }
        Update: {
          branch_id?: string | null
          business_id?: string | null
          is_active?: boolean | null
          role?: Database["public"]["Enums"]["user_role"] | null
          user_id?: string | null
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
          {
            foreignKeyName: "business_users_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "business_users_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
      projects: {
        Row: {
          boq_locked_at: string | null
          budget: number
          business_id: string
          client_id: string | null
          client_name: string
          contract_sum: number
          created_at: string
          created_by: string
          end_date: string | null
          id: string
          name: string
          retention_pct: number
          start_date: string | null
          status: string
          updated_at: string
        }
        ComputedFields: never
        Insert: {
          boq_locked_at?: string | null
          budget?: number | null
          business_id?: string | null
          client_id?: string | null
          client_name?: string | null
          contract_sum?: number | null
          created_at?: string | null
          created_by?: string | null
          end_date?: string | null
          id?: string | null
          name?: string | null
          retention_pct?: number | null
          start_date?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          boq_locked_at?: string | null
          budget?: number | null
          business_id?: string | null
          client_id?: string | null
          client_name?: string | null
          contract_sum?: number | null
          created_at?: string | null
          created_by?: string | null
          end_date?: string | null
          id?: string | null
          name?: string | null
          retention_pct?: number | null
          start_date?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "construction_projects_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "projects_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
      v_ai_anomalies: {
        Row: {
          amount: number | null
          branch_id: string | null
          business_id: string | null
          description: string | null
          occurred_on: string | null
          reference: string | null
          severity: string | null
          type: string | null
        }
        ComputedFields: never
        Relationships: []
      }
      v_ai_cash_accounts: {
        Row: {
          branch_id: string | null
          business_id: string
          code: string
          id: string
          name: string
          opening_balance: number | null
        }
        ComputedFields: never
        Insert: {
          branch_id?: string | null
          business_id?: string | null
          code?: string | null
          id?: string | null
          name?: string | null
          opening_balance?: never
        }
        Update: {
          branch_id?: string | null
          business_id?: string | null
          code?: string | null
          id?: string | null
          name?: string | null
          opening_balance?: never
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
            foreignKeyName: "accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
      v_ai_cash_movements: {
        Row: {
          branch_id: string | null
          business_id: string
          entry_date: string
          entry_id: string
          month: string | null
          net_cash: number | null
        }
        ComputedFields: never
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
            foreignKeyName: "journal_entries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "journal_entries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
      v_ai_customer_concentration: {
        Row: {
          branch_id: string | null
          business_id: string | null
          concentration_pct: number | null
          customer_count: number | null
          top_contact_id: string | null
          top_customer: string | null
          top_customer_revenue: number | null
          total_revenue: number | null
        }
        ComputedFields: never
        Relationships: []
      }
      v_ai_expense_docs: {
        Row: {
          amount_base: number | null
          amount_outstanding: number | null
          branch_id: string | null
          business_id: string
          contact_id: string | null
          due_date: string | null
          exchange_rate: number | null
          expense_date: string
          expense_id: string
          expense_number: string
          expense_type: string
          status: string
        }
        ComputedFields: never
        Insert: {
          amount_base?: never
          amount_outstanding?: never
          branch_id?: string | null
          business_id?: string | null
          contact_id?: string | null
          due_date?: string | null
          exchange_rate?: never
          expense_date?: string | null
          expense_id?: string | null
          expense_number?: string | null
          expense_type?: string | null
          status?: string | null
        }
        Update: {
          amount_base?: never
          amount_outstanding?: never
          branch_id?: string | null
          business_id?: string | null
          contact_id?: string | null
          due_date?: string | null
          exchange_rate?: never
          expense_date?: string | null
          expense_id?: string | null
          expense_number?: string | null
          expense_type?: string | null
          status?: string | null
        }
        Relationships: [
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
            foreignKeyName: "expenses_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "expenses_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "expenses_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      v_ai_kpis: {
        Row: {
          avg_days_to_pay: number | null
          branch_id: string | null
          business_id: string | null
          cash_balance: number | null
          expense_ratio_pct: number | null
          expenses_mtd: number | null
          net_profit_mtd: number | null
          open_invoice_count: number | null
          overdue_total: number | null
          payables_total: number | null
          period_end: string | null
          period_start: string | null
          profit_margin_pct: number | null
          receivables_total: number | null
          revenue_mtd: number | null
        }
        ComputedFields: never
        Relationships: []
      }
      v_ai_monthly_trend: {
        Row: {
          branch_id: string | null
          business_id: string | null
          cash_in: number | null
          cash_out: number | null
          cumulative_cash: number | null
          expenses: number | null
          month: string | null
          month_start: string | null
          net_cash: number | null
          profit: number | null
          revenue: number | null
        }
        ComputedFields: never
        Relationships: []
      }
      v_ai_overdue_invoices: {
        Row: {
          amount_outstanding: number | null
          branch_id: string | null
          business_id: string
          contact_id: string
          customer: string | null
          days_overdue: number | null
          due_date: string | null
          invoice_id: string
          invoice_number: string
          issue_date: string
        }
        ComputedFields: never
        Relationships: [
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
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      v_ai_revenue_invoices: {
        Row: {
          amount_base: number | null
          amount_outstanding: number | null
          branch_id: string | null
          business_id: string
          contact_id: string
          due_date: string | null
          invoice_id: string
          invoice_number: string
          issue_date: string
          status: string | null
        }
        ComputedFields: never
        Insert: {
          amount_base?: never
          amount_outstanding?: never
          branch_id?: string | null
          business_id?: string | null
          contact_id?: string | null
          due_date?: string | null
          invoice_id?: string | null
          invoice_number?: string | null
          issue_date?: string | null
          status?: never
        }
        Update: {
          amount_base?: never
          amount_outstanding?: never
          branch_id?: string | null
          business_id?: string | null
          contact_id?: string | null
          due_date?: string | null
          invoice_id?: string | null
          invoice_number?: string | null
          issue_date?: string | null
          status?: never
        }
        Relationships: [
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
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      v_ai_top_customers: {
        Row: {
          branch_id: string | null
          business_id: string | null
          contact_id: string | null
          customer: string | null
          invoice_count: number | null
          last_invoice_date: string | null
          outstanding: number | null
          revenue: number | null
          share_pct: number | null
        }
        ComputedFields: never
        Relationships: []
      }
      v_ai_top_expenses: {
        Row: {
          account_code: string | null
          amount: number | null
          branch_id: string | null
          business_id: string
          category: string | null
          document_count: number | null
          month: string | null
        }
        ComputedFields: never
        Relationships: [
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
            foreignKeyName: "expenses_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "expenses_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
      v_ai_upcoming_payables: {
        Row: {
          amount: number | null
          branch_id: string | null
          business_id: string | null
          counterparty: string | null
          due_date: string | null
          label: string | null
          source: string | null
        }
        ComputedFields: never
        Relationships: []
      }
      v_ai_upcoming_receivables: {
        Row: {
          amount_outstanding: number | null
          branch_id: string | null
          bucket: string | null
          business_id: string
          customer: string | null
          days_until_due: number | null
          due_date: string | null
          invoice_id: string
          invoice_number: string
        }
        ComputedFields: never
        Relationships: [
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
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
      v_ar_ageing: {
        Row: {
          ageing_bucket: string | null
          amount_due: number | null
          amount_paid: number
          business_id: string
          contact_id: string
          contact_name: string | null
          currency: string
          days_overdue: number | null
          due_date: string | null
          invoice_id: string
          invoice_number: string
          issue_date: string
          total_amount: number
        }
        ComputedFields: never
        Relationships: [
          {
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "invoices_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "invoices_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
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
          accumulated_depreciation: number
          acquisition_cost: number
          acquisition_date: string
          asset_number: string
          branch: string | null
          business_id: string
          category: string | null
          department: string | null
          depreciable_amount: number | null
          depreciation_method: Database["public"]["Enums"]["depreciation_method"]
          last_depreciation_date: string | null
          name: string
          net_book_value: number | null
          residual_value: number
          status: Database["public"]["Enums"]["asset_status"]
        }
        ComputedFields: never
        Relationships: [
          {
            foreignKeyName: "fixed_assets_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fixed_assets_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "fixed_assets_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
      v_cash_flow: {
        Row: {
          business_id: string
          financing: number | null
          investing: number | null
          net_change: number | null
          operating: number | null
          period: string | null
        }
        ComputedFields: never
        Relationships: [
          {
            foreignKeyName: "journal_entries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "journal_entries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "journal_entries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
      v_inventory_balance_ledger_drift: {
        Row: {
          balance_updated_at: string | null
          business_id: string | null
          difference: number | null
          last_ledger_movement_at: string | null
          ledger_quantity: number | null
          location_id: string | null
          movement_count: number | null
          product_id: string | null
          quantity_on_hand: number | null
        }
        ComputedFields: never
        Relationships: []
      }
      v_inventory_ledger_variance: {
        Row: {
          business_id: string
          business_name: string
          inventory_ledger_balance: number | null
          status: string | null
          stock_on_hand_value: number | null
          variance: number | null
        }
        ComputedFields: never
        Relationships: []
      }
      v_partner_client_usage: {
        Row: {
          business_id: string
          business_name: string
          invoice_count: number | null
          is_active: boolean
          journal_entry_count: number | null
          last_activity_at: string | null
          onboarded_at: string | null
          partner_id: string
          plan_tier: string
          user_count: number | null
        }
        ComputedFields: never
        Relationships: [
          {
            foreignKeyName: "partner_clients_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "partners"
            referencedColumns: ["id"]
          },
        ]
      }
      v_reorder_alerts: {
        Row: {
          average_cost: number
          business_id: string
          estimated_reorder_cost: number | null
          location_name: string | null
          product_id: string
          product_name: string
          quantity_available: number | null
          quantity_on_hand: number
          quantity_reserved: number
          reorder_level: number | null
          reorder_quantity: number | null
          sku: string | null
        }
        ComputedFields: never
        Relationships: [
          {
            foreignKeyName: "inventory_balances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_balances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "inventory_balances_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "inventory_balances_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      v_trial_balance: {
        Row: {
          account_subtype: Database["public"]["Enums"]["account_subtype"] | null
          account_type: Database["public"]["Enums"]["account_type"]
          balance: number | null
          business_id: string
          code: string
          name: string
          normal_balance: string
          total_credits: number | null
          total_debits: number | null
        }
        ComputedFields: never
        Relationships: [
          {
            foreignKeyName: "accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_inventory_ledger_variance"
            referencedColumns: ["business_id"]
          },
          {
            foreignKeyName: "accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "v_partner_client_usage"
            referencedColumns: ["business_id"]
          },
        ]
      }
    }
    Functions: {
      act_on_approval: {
        Args: { p_action: string; p_comments?: string | null; p_request_id: string }
        Returns: Json
      }
      can_approve_step: {
        Args: { p_request_id: string; p_user_id: string }
        Returns: boolean
      }
      get_approval_state: {
        Args: { p_business_id: string; p_document_id: string; p_document_type: string }
        Returns: Json
      }
      requires_approval: {
        Args: { p_business_id: string; p_document_type: string }
        Returns: boolean
      }
      resubmit_approval: {
        Args: { p_request_id: string }
        Returns: Json
      }
      save_approval_workflow: {
        Args: {
          p_business_id: string
          p_document_type: string
          p_is_active: boolean
          p_name: string
          p_steps: Json
        }
        Returns: string
      }
      start_approval_workflow: {
        Args: { p_business_id: string; p_document_id: string; p_document_type: string }
        Returns: Json
      }
      _ledgr_account_by_code: {
        Args: { p_business_id: string; p_code: string }
        Returns: string
      }
      _ledgr_apply_stock_movement_delta: {
        Args: {
          p_business_id: string
          p_location_id: string
          p_moved_at: string
          p_product_id: string
          p_quantity: number
          p_unit_cost: number
        }
        Returns: undefined
      }
      _ledgr_assert_account: {
        Args: { p_account_id: string; p_business_id: string; p_role: string }
        Returns: string
      }
      _ledgr_assert_period_open: {
        Args: { p_business: string; p_date: string; p_what: string }
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
        Args: { p_business_id: string; p_invoice: Json; p_lines: Json }
        Returns: undefined
      }
      _ledgr_assert_usage_limit: {
        Args: { p_business_id: string }
        Returns: undefined
      }
      _ledgr_closed_period: {
        Args: { p_business: string; p_date: string }
        Returns: {
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
        SetofOptions: {
          from: "*"
          to: "accounting_periods"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _ledgr_complete_pos_sale: {
        Args: { p_business_id: string; p_invoice_id: string }
        Returns: Json
      }
      _ledgr_construction_actor: {
        Args: { p_business: string; p_capability: string }
        Returns: string
      }
      _ledgr_construction_assert_bill_not_inventoried: {
        Args: { p_business: string; p_expense: string }
        Returns: undefined
      }
      _ledgr_construction_base_uom: {
        Args: { p_business: string; p_product: string }
        Returns: string
      }
      _ledgr_construction_bill: {
        Args: { p_business: string; p_expense: string }
        Returns: {
          amount_paid: number
          ap_account_id: string | null
          approved_at: string | null
          approved_by: string | null
          branch_id: string | null
          business_id: string
          client_key: string | null
          contact_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          department_id: string | null
          discount_amount: number
          discount_percent: number
          due_date: string | null
          exchange_rate: number
          exchange_rate_used: number | null
          expense_date: string
          expense_number: string
          expense_type: string
          functional_amount: number | null
          functional_currency: string | null
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
        SetofOptions: {
          from: "*"
          to: "expenses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _ledgr_construction_billing_contact: {
        Args: { p_business_id: string; p_client_name: string }
        Returns: string
      }
      _ledgr_construction_capability: {
        Args: { p_business: string; p_capability: string; p_user: string }
        Returns: boolean
      }
      _ledgr_construction_date: {
        Args: { p_label: string; p_value: string }
        Returns: string
      }
      _ledgr_construction_normalize_reference: {
        Args: { p_text: string }
        Returns: string
      }
      _ledgr_construction_reason_present: {
        Args: { p_reason: string }
        Returns: boolean
      }
      _ledgr_construction_site: {
        Args: { p_business: string; p_site: string }
        Returns: {
          branch_id: string
          business_id: string
          created_at: string
          created_by: string
          id: string
          is_active: boolean
          location_id: string
          project_id: string | null
          project_ref: string
          site_code: string
          site_name: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "construction_procurement_sites"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      _ledgr_construction_text: {
        Args: { p_label: string; p_value: string }
        Returns: string
      }
      _ledgr_construction_to_base: {
        Args: {
          p_business: string
          p_label: string
          p_product: string
          p_quantity: number
          p_uom: string
        }
        Returns: number
      }
      _ledgr_construction_uuid: {
        Args: { p_label: string; p_value: string }
        Returns: string
      }
      _ledgr_consume_pos_approval: {
        Args: {
          p_action: string
          p_business_id: string
          p_document_id: string
          p_token: string
        }
        Returns: string
      }
      _ledgr_consume_price_override: {
        Args: {
          p_business_id: string
          p_kind: string
          p_percent: number
          p_product_id: string
          p_tokens: string[]
          p_unit_price: number
        }
        Returns: boolean
      }
      _ledgr_correction_preflight: {
        Args: {
          p_action: string
          p_approval_token: string
          p_business_id: string
          p_document_id: string
        }
        Returns: {
          approval_id: string
          doc_branch_id: string
          doc_currency: string
          doc_department_id: string
          doc_exchange_rate: number
          doc_invoice_number: string
          doc_original_amount: number
          doc_status: string
          doc_total_amount: number
        }[]
      }
      _ledgr_create_business_with_owner_core: {
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
      _ledgr_invoice_needs_approval: {
        Args: { p_business: string; p_submitter: string; p_total: number }
        Returns: boolean
      }
      _ledgr_is_pos_supervisor: {
        Args: { p_business_id: string; p_user: string }
        Returns: boolean
      }
      _ledgr_member_role: {
        Args: { p_business: string; p_user: string }
        Returns: string
      }
      _ledgr_period_is_open: {
        Args: { p_business: string; p_date: string }
        Returns: boolean
      }
      _ledgr_pos_actor_name: { Args: { p_uid: string }; Returns: string }
      _ledgr_pos_discount_cap: {
        Args: { p_business_id: string; p_user: string }
        Returns: number
      }
      _ledgr_pos_payload_hash: { Args: { p_payload: Json }; Returns: string }
      _ledgr_pos_stock_location: {
        Args: { p_branch_id: string; p_business_id: string }
        Returns: string
      }
      _ledgr_pos_tender_account: {
        Args: { p_business_id: string; p_explicit?: string; p_method: string }
        Returns: string
      }
      _ledgr_post_cogs:
        | {
            Args: {
              p_branch_id: string
              p_business_id: string
              p_cost_lines: Json
              p_department_id: string
              p_invoice_id: string
              p_invoice_number: string
              p_issue_date: string
            }
            Returns: string
          }
        | {
            Args: {
              p_branch_id: string
              p_business_id: string
              p_cost_lines: Json
              p_department_id: string
              p_invoice_id: string
              p_invoice_number: string
              p_issue_date: string
              p_posting_key: string
            }
            Returns: string
          }
      _ledgr_post_entry:
        | {
            Args: {
              p_branch_id: string
              p_business_id: string
              p_currency: string
              p_department_id: string
              p_description: string
              p_entry_date: string
              p_entry_number: string
              p_exchange_rate: number
              p_lines: Json
              p_source_id: string
              p_source_type: string
            }
            Returns: string
          }
        | {
            Args: {
              p_branch_id: string
              p_business_id: string
              p_currency: string
              p_department_id: string
              p_description: string
              p_entry_date: string
              p_entry_number: string
              p_exchange_rate: number
              p_lines: Json
              p_posting_key: string
              p_source_id: string
              p_source_type: string
            }
            Returns: string
          }
      _ledgr_post_entry_keyed: {
        Args: {
          p_branch_id: string
          p_business_id: string
          p_currency: string
          p_department_id: string
          p_description: string
          p_entry_date: string
          p_exchange_rate: number
          p_lines: Json
          p_posting_key: string
          p_source_id: string
          p_source_type: string
        }
        Returns: string
      }
      _ledgr_project_next_status: {
        Args: { p_status: string }
        Returns: string
      }
      _ledgr_project_valuation_actor: {
        Args: { p_business_id: string; p_required_capabilities?: string[] }
        Returns: string
      }
      _ledgr_project_valuation_payload: {
        Args: { p_valuation_id: string }
        Returns: Json
      }
      _ledgr_rebuild_project_valuation_lines: {
        Args: {
          p_lines: Json
          p_notes: string
          p_project_id: string
          p_valuation_id: string
          p_valuation_number: number
        }
        Returns: {
          gross_amount: number
          previous_cumulative: number
        }[]
      }
      _ledgr_resolve_construction_client: {
        Args: { p_project_id: string }
        Returns: string
      }
      _ledgr_resolve_sale_contact: {
        Args: { p_business_id: string; p_contact_id: string; p_customer: Json }
        Returns: string
      }
      _ledgr_revoke_invoice_approval: {
        Args: { p_invoice: string; p_reason: string }
        Returns: undefined
      }
      _ledgr_source_id_type: { Args: { p_table: string }; Returns: string }
      _ledgr_stock_location: {
        Args: { p_branch_id: string; p_business_id: string }
        Returns: string
      }
      _ledgr_try_uuid: { Args: { p: string }; Returns: string }
      _mfg_dashboard_authorized: {
        Args: { p_business_id: string }
        Returns: boolean
      }
      _mfg_wo_actor: { Args: { p_business_id: string }; Returns: string }
      _mfg_wo_backflush: {
        Args: {
          p_actor: string
          p_batch_label: string
          p_date: string
          p_output_qty: number
          p_run_id: string
          p_work_order_id: string
        }
        Returns: number
      }
      _mfg_wo_location: {
        Args: { p_business_id: string; p_location_type: string }
        Returns: string
      }
      _mfg_wo_movement: {
        Args: {
          p_actor: string
          p_business_id: string
          p_location_id: string
          p_movement_date: string
          p_movement_type: string
          p_notes: string
          p_product_id: string
          p_quantity: number
          p_reference: string
          p_source_id: string
          p_unit_cost: number
        }
        Returns: string
      }
      _mfg_wo_next_number: { Args: { p_business_id: string }; Returns: string }
      _mfg_wo_post_entry: {
        Args: {
          p_amount: number
          p_branch_id: string
          p_business_id: string
          p_credit_account_id: string
          p_credit_note: string
          p_debit_account_id: string
          p_debit_note: string
          p_description: string
          p_entry_date: string
          p_posting_key: string
          p_source_id: string
        }
        Returns: string
      }
      _mfg_wo_stock_account: {
        Args: {
          p_business_id: string
          p_code: string
          p_fallback_code: string
          p_role: string
        }
        Returns: string
      }
      _mfg_wo_wip_account: { Args: { p_business_id: string }; Returns: string }
      _mfg_wo_writer: {
        Args: { p_action: string; p_business_id: string }
        Returns: string
      }
      accept_invitation: { Args: { p_token: string }; Returns: Json }
      accept_invitation_membership: {
        Args: {
          p_expected_invitation: Json
          p_invitation_id: string
          p_recipient_id: string
        }
        Returns: Json
      }
      add_partner_admin: {
        Args: {
          p_partner_id: string
          p_role?: string
          p_user_email_or_id: string
        }
        Returns: undefined
      }
      ai_context:
        | { Args: { p_business_id: string }; Returns: Json }
        | {
            Args: { p_branch_id: string; p_business_id: string }
            Returns: Json
          }
      apply_subscription_payment: {
        Args: {
          p_gateway_reference: string
          p_raw_response: Json
          p_status: string
          p_tx_ref: string
        }
        Returns: {
          amount: number
          billing_cycle: string
          business_id: string
          checkout_url: string | null
          created_at: string
          currency: string
          gateway: string
          gateway_reference: string | null
          id: string
          initiated_by: string | null
          plan_expires_at: string | null
          raw_response: Json | null
          status: string
          target_plan_tier: string
          tx_ref: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "subscription_payments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      approve_construction_receipt_posting_policy: {
        Args: {
          p_business_id: string
          p_enable: boolean
          p_evidence: string
          p_reason: string
        }
        Returns: Json
      }
      approve_invoice: {
        Args: { p_invoice_id: string; p_note?: string }
        Returns: Json
      }
      audit_chain_hash: {
        Args: {
          p_business_id: string
          p_event_type: string
          p_new_values: Json
          p_notes: string
          p_occurred_at: string
          p_old_values: Json
          p_prev_hash: string
          p_resource_id: string
          p_resource_ref: string
          p_resource_type: string
          p_user_id: string
        }
        Returns: string
      }
      authorize_construction_purchase_order: {
        Args: { p_po_id: string }
        Returns: Json
      }
      authorize_pos_approval: { Args: { p_token: string }; Returns: Json }
      authorize_pos_price_override: { Args: { p_token: string }; Returns: Json }
      backfill_and_recalculate_inventory: {
        Args: { p_business_id?: string }
        Returns: {
          adjustments_inserted: number
          balances_updated: number
          out_business_id: string
          purchases_backfilled: number
          sales_backfilled: number
        }[]
      }
      bulk_upsert_boq_lines: {
        Args: { p_lines: Json; p_project_id: string }
        Returns: {
          created_at: string
          description: string
          id: string
          line_number: string
          project_id: string
          quantity: number
          rate: number
          sort_order: number
          total_value: number
          unit: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "project_boq_lines"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      business_partner_id: { Args: { bid: string }; Returns: string }
      can_access_branch: {
        Args: { p_branch_id: string; p_business_id: string }
        Returns: boolean
      }
      can_access_location: {
        Args: { p_business_id: string; p_location_id: string }
        Returns: boolean
      }
      can_admin_business_data: {
        Args: { p_business_id: string }
        Returns: boolean
      }
      can_operate_pos: { Args: { p_business_id: string }; Returns: boolean }
      can_read_audit: { Args: { p_business_id: string }; Returns: boolean }
      can_read_partner_client: {
        Args: { bid: string; pid: string }
        Returns: boolean
      }
      can_read_partner_peer_business: {
        Args: { bid: string }
        Returns: boolean
      }
      can_view_payroll: { Args: { p_business_id: string }; Returns: boolean }
      can_write_business_data: {
        Args: { p_business_id: string }
        Returns: boolean
      }
      can_write_contacts_data: {
        Args: { p_business_id: string }
        Returns: boolean
      }
      can_write_expense_data: {
        Args: { p_business_id: string }
        Returns: boolean
      }
      can_write_ledger_directly: {
        Args: { p_business_id: string }
        Returns: boolean
      }
      can_write_payroll: { Args: { p_business_id: string }; Returns: boolean }
      can_write_sales_data: {
        Args: { p_business_id: string }
        Returns: boolean
      }
      cancel_construction_purchase_order: {
        Args: { p_po_id: string; p_reason: string }
        Returns: Json
      }
      clear_partner_admins: { Args: { p_partner_id: string }; Returns: number }
      close_accounting_period: {
        Args: { p_period_id: string; p_reason?: string }
        Returns: Json
      }
      close_pos_shift_command: { Args: { p_payload: Json }; Returns: Json }
      construction_procurement_capabilities_for: {
        Args: { p_business_id: string }
        Returns: string[]
      }
      construction_procurement_open_items: {
        Args: { p_business_id: string }
        Returns: Json
      }
      construction_project_material_cost: {
        Args: { p_business_id: string }
        Returns: {
          currency: string
          first_issue_date: string
          issue_count: number
          last_issue_date: string
          material_cost: number
          project_ref: string
          quantity_base: number
        }[]
      }
      construction_supplier_reference_visible: {
        Args: { p_business_id: string; p_expense_id: string }
        Returns: boolean
      }
      consume_api_rate_limit: {
        Args: { p_bucket: string; p_limit: number; p_window_start: string }
        Returns: boolean
      }
      create_api_journal_entry: {
        Args: { p_business_id: string; p_entry: Json; p_lines: Json }
        Returns: Json
      }
      create_boq_line: {
        Args: {
          p_description: string
          p_line_number: string
          p_project_id: string
          p_quantity: number
          p_rate: number
          p_sort_order: number
          p_unit: string
        }
        Returns: {
          created_at: string
          description: string
          id: string
          line_number: string
          project_id: string
          quantity: number
          rate: number
          sort_order: number
          total_value: number
          unit: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "project_boq_lines"
          isOneToOne: true
          isSetofReturn: false
        }
      }
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
          p_operating_models?: string[]
          p_organisation_type?: string
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
      create_construction_purchase_order: {
        Args: { p_client_key: string; p_payload: Json }
        Returns: Json
      }
      create_invoice_with_lines: {
        Args: { p_client_key?: string; p_invoice: Json; p_lines: Json }
        Returns: Json
      }
      create_project: {
        Args: {
          p_budget: number
          p_business_id: string
          p_client_id?: string
          p_client_name: string
          p_contract_sum: number
          p_end_date: string
          p_name: string
          p_retention_pct: number
          p_start_date: string
        }
        Returns: {
          boq_locked_at: string | null
          budget: number
          business_id: string
          client_id: string | null
          client_name: string
          contract_sum: number
          created_at: string
          created_by: string
          end_date: string | null
          id: string
          name: string
          retention_pct: number
          start_date: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "construction_projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_project_purchase_order: {
        Args: { p_client_key: string; p_payload: Json; p_project_id: string }
        Returns: Json
      }
      create_valuation: {
        Args: {
          p_lines: Json
          p_notes?: string
          p_period_end: string
          p_period_start: string
          p_project_id: string
          p_valuation_date: string
        }
        Returns: Json
      }
      current_partner_ids: { Args: { uid: string }; Returns: string[] }
      current_user_role: {
        Args: { p_business_id: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      delete_boq_line: { Args: { p_line_id: string }; Returns: undefined }
      diagnose_user_login: {
        Args: { p_user_email_or_id: string }
        Returns: {
          check_name: string
          detail: string
          status: string
        }[]
      }
      effective_plan_tier: {
        Args: { p_plan_expires_at: string; p_plan_tier: string }
        Returns: string
      }
      find_user_by_email: { Args: { p_email: string }; Returns: string }
      generate_invoice_from_valuation: {
        Args: { p_valuation_id: string }
        Returns: Json
      }
      get_boq_summary: {
        Args: { p_project_id: string }
        Returns: {
          contract_sum: number
          is_locked: boolean
          line_count: number
          total_boq_value: number
          variance: number
        }[]
      }
      get_cost_breakdown_by_project: {
        Args: { p_business_id: string }
        Returns: {
          budget: number
          net_cost: number
          project_id: string
          project_name: string
          total_issued_value: number
          total_po_value: number
          total_returned_value: number
          variance: number
        }[]
      }
      get_dashboard_metrics:
        | {
            Args: { p_business_id: string }
            Returns: {
              active_projects: number
              avg_completion_pct: number
              outstanding_receivables: number
              projects_over_budget: number
              total_billed_this_period: number
              total_contract_value: number
              total_costs_this_period: number
              total_paid_this_period: number
              total_retention_held: number
            }[]
          }
        | {
            Args: { p_business_id: string; p_months: number }
            Returns: {
              active_projects: number
              avg_completion_pct: number
              outstanding_receivables: number
              projects_over_budget: number
              total_billed_this_period: number
              total_contract_value: number
              total_costs_this_period: number
              total_paid_this_period: number
              total_retention_held: number
            }[]
          }
      get_enum_values: { Args: { p_enum_name: string }; Returns: string[] }
      get_portfolio_summary: {
        Args: { p_business_id: string }
        Returns: {
          active_projects: number
          avg_completion_pct: number
          outstanding_receivables: number
          projects_over_budget: number
          total_billed: number
          total_contract_value: number
          total_costs: number
          total_paid: number
          total_projects: number
          total_retention_held: number
        }[]
      }
      get_pos_shift_report: { Args: { p_shift_id: string }; Returns: Json }
      get_project_cost_summary: {
        Args: { p_project_id: string }
        Returns: {
          net_cost: number
          total_issued_value: number
          total_po_value: number
          total_returned_value: number
        }[]
      }
      get_project_pnl: {
        Args: { p_project_id: string }
        Returns: {
          billing_pct: number
          boq_total: number
          budget: number
          client_name: string
          completion_pct: number
          contract_sum: number
          cost_variance: number
          profit_margin: number
          project_name: string
          retention_balance: number
          retention_pct: number
          status: string
          total_billed: number
          total_costs: number
          total_issued_value: number
          total_paid: number
          total_po_value: number
          total_retention_released: number
          total_retention_withheld: number
          total_returned_value: number
        }[]
      }
      get_project_valuation_trend: {
        Args: { p_project_id: string }
        Returns: {
          cumulative_billed: number
          gross_amount: number
          net_amount: number
          retention_amount: number
          valuation_date: string
          valuation_number: number
        }[]
      }
      get_retention_aging: {
        Args: { p_business_id: string }
        Returns: {
          client_name: string
          days_held: number
          oldest_retention_date: string
          project_id: string
          project_name: string
          project_status: string
          retention_balance: number
        }[]
      }
      get_retention_summary: {
        Args: { p_project_id: string }
        Returns: {
          balance_held: number
          can_release: boolean
          retention_pct: number
          total_released: number
          total_withheld: number
        }[]
      }
      get_user_role: {
        Args: { p_business_id: string }
        Returns: Database["public"]["Enums"]["user_role"]
      }
      get_valuation_history: { Args: { p_project_id: string }; Returns: Json }
      get_valuation_trend: {
        Args: { p_project_id: string }
        Returns: {
          cumulative_billed: number
          gross_amount: number
          net_amount: number
          retention_amount: number
          valuation_date: string
          valuation_number: number
        }[]
      }
      grant_construction_procurement_capability: {
        Args: {
          p_business_id: string
          p_capability: string
          p_reason: string
          p_user_id: string
        }
        Returns: Json
      }
      grant_user_business_access: {
        Args: {
          p_business_id: string
          p_role?: string
          p_user_email_or_id: string
        }
        Returns: {
          out_action: string
          out_business_id: string
          out_role: string
          out_user_id: string
        }[]
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
      is_business_member: { Args: { p_business_id: string }; Returns: boolean }
      is_partner_admin: { Args: { pid: string; uid: string }; Returns: boolean }
      is_partner_business_admin: { Args: { bid: string }; Returns: boolean }
      is_platform_admin: { Args: { uid: string }; Returns: boolean }
      issue_construction_materials_to_project: {
        Args: { p_client_key: string; p_payload: Json }
        Returns: Json
      }
      issue_project_materials: {
        Args: { p_client_key: string; p_payload: Json; p_project_id: string }
        Returns: Json
      }
      ledgr_monthly_document_count: {
        Args: { p_business_id: string }
        Returns: number
      }
      link_site_to_project: {
        Args: { p_location_id: string; p_project_id: string }
        Returns: {
          branch_id: string | null
          business_id: string
          code: string | null
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          location_type: string
          name: string
          project_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "inventory_locations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      list_all_businesses: {
        Args: Record<PropertyKey, never>
        Returns: {
          out_business_id: string
          out_business_name: string
          out_created_at: string
          out_email: string
          out_owner_emails: string
          out_owner_names: string
          out_phone: string
          out_plan_tier: string
          out_trading_name: string
        }[]
      }
      list_partner_admins: {
        Args: { p_partner_id: string }
        Returns: {
          out_created_at: string
          out_email: string
          out_name: string
          out_role: string
          out_user_id: string
        }[]
      }
      log_manual_audit_event:
        | {
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
        | {
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
      manufacturing_bom_activate: {
        Args: { p_bom_id: string }
        Returns: undefined
      }
      manufacturing_bom_cost: { Args: { p_bom_id: string }; Returns: number }
      manufacturing_bom_new_version: {
        Args: { p_bom_id: string }
        Returns: string
      }
      save_bom_version: {
        Args: {
          p_bom_id: string | null
          p_business_id: string
          p_components: Json
          p_notes: string | null
          p_product_id: string
        }
        Returns: string
      }
      manufacturing_cost_variance: {
        Args: {
          p_business_id: string
          p_end_date?: string
          p_start_date?: string
        }
        Returns: {
          actual_cost: number
          planned_cost: number
          product_name: string
          variance: number
          variance_pct: number
          work_order_id: string
          work_order_number: string
        }[]
      }
      manufacturing_dashboard_metrics: {
        Args: {
          p_business_id: string
          p_end_date?: string
          p_start_date?: string
        }
        Returns: Json
      }
      manufacturing_production_summary: {
        Args: {
          p_business_id: string
          p_end_date?: string
          p_start_date?: string
        }
        Returns: {
          cost_per_unit: number
          product_id: string
          product_name: string
          production_run_count: number
          total_completed: number
          total_material_cost: number
          total_planned: number
          total_scrapped: number
          work_order_count: number
          yield_pct: number
        }[]
      }
      manufacturing_throughput_trend: {
        Args: {
          p_business_id: string
          p_end_date?: string
          p_granularity?: string
          p_start_date?: string
        }
        Returns: {
          output_quantity: number
          period_start: string
          scrap_quantity: number
          work_order_count: number
        }[]
      }
      manufacturing_wip_aging: {
        Args: { p_business_id: string }
        Returns: {
          age_bucket: string
          completed_quantity: number
          days_in_wip: number
          planned_quantity: number
          product_name: string
          status: string
          wip_cost: number
          work_order_id: string
          work_order_number: string
        }[]
      }
      manufacturing_wo_cancel: {
        Args: { p_work_order_id: string }
        Returns: undefined
      }
      manufacturing_wo_close: {
        Args: { p_work_order_id: string }
        Returns: undefined
      }
      manufacturing_wo_complete: {
        Args: { p_work_order_id: string }
        Returns: undefined
      }
      manufacturing_wo_create: {
        Args: {
          p_business_id: string
          p_from_location_id: string
          p_notes: string
          p_planned_end: string
          p_planned_qty: number
          p_planned_start: string
          p_product_id: string
          p_to_location_id: string
        }
        Returns: string
      }
      manufacturing_wo_record_consumption: {
        Args: {
          p_component_id: string
          p_from_location_id: string
          p_notes: string
          p_quantity: number
          p_run_id: string
          p_work_order_id: string
        }
        Returns: string
      }
      manufacturing_wo_record_return: {
        Args: {
          p_component_id: string
          p_notes: string
          p_quantity: number
          p_run_id: string
          p_to_location_id: string
          p_work_order_id: string
        }
        Returns: string
      }
      manufacturing_wo_record_run: {
        Args: {
          p_notes: string
          p_output_qty: number
          p_scrap_qty: number
          p_work_order_id: string
        }
        Returns: string
      }
      manufacturing_wo_release: {
        Args: { p_work_order_id: string }
        Returns: undefined
      }
      manufacturing_wo_start: {
        Args: { p_work_order_id: string }
        Returns: undefined
      }
      manufacturing_wo_yield: {
        Args: { p_work_order_id: string }
        Returns: {
          completed_quantity: number
          component_actual_quantity: number
          component_name: string
          component_planned_quantity: number
          component_product_id: string
          consumption_variance: number
          consumption_variance_pct: number
          planned_quantity: number
          scrapped_quantity: number
          status: string
          work_order_id: string
          work_order_number: string
          yield_pct: number
        }[]
      }
      manufacturing_yield_by_product: {
        Args: {
          p_business_id: string
          p_end_date?: string
          p_start_date?: string
        }
        Returns: {
          product_id: string
          product_name: string
          total_output: number
          total_scrap: number
          work_order_count: number
          yield_pct: number
        }[]
      }
      match_construction_bill_line_to_receipt: {
        Args: { p_client_key: string; p_payload: Json }
        Returns: Json
      }
      next_journal_entry_number: {
        Args: { p_business_id?: string }
        Returns: string
      }
      open_pos_shift_command: { Args: { p_payload: Json }; Returns: Json }
      plan_tier_rank: { Args: { tier: string }; Returns: number }
      pos_stock_availability: {
        Args: { p_branch_id?: string; p_business_id: string }
        Returns: Json
      }
      post_construction_receipt_movement: {
        Args: { p_grn_id: string }
        Returns: Json
      }
      post_pos_sale: { Args: { p_payload: Json }; Returns: Json }
      provision_construction_coa_accounts: {
        Args: { p_business_id: string }
        Returns: string
      }
      provision_construction_defaults: {
        Args: { p_business_id: string; p_owner_user_id: string }
        Returns: Json
      }
      provision_manufacturing_coa_accounts: {
        Args: { p_business_id: string }
        Returns: string
      }
      provision_manufacturing_defaults: {
        Args: { p_business_id: string; p_owner_user_id: string }
        Returns: Json
      }
      reclassify_construction_receipt_line: {
        Args: { p_client_key: string; p_payload: Json }
        Returns: Json
      }
      reconcile_offline_queue_item: { Args: { p_request: Json }; Returns: Json }
      record_business_terms_acceptance: {
        Args: { p_business_id: string; p_terms_version: string }
        Returns: string
      }
      record_construction_delivery_note: {
        Args: { p_client_key: string; p_payload: Json }
        Returns: Json
      }
      record_construction_delivery_note_exception: {
        Args: { p_client_key: string; p_payload: Json }
        Returns: Json
      }
      record_construction_goods_receipt: {
        Args: { p_client_key: string; p_payload: Json }
        Returns: Json
      }
      record_construction_receipt_cost_basis: {
        Args: {
          p_client_key: string
          p_evidence: string
          p_expense_line_id: string
          p_grn_line_id: string
          p_quantity: number
        }
        Returns: Json
      }
      record_construction_receipt_inspection: {
        Args: { p_client_key: string; p_payload: Json }
        Returns: Json
      }
      record_expense_payment: {
        Args: { p_client_key: string; p_payment: Json }
        Returns: Json
      }
      record_inventory_journal_movement: {
        Args: { p_payload: Json }
        Returns: Json
      }
      record_invoice_payment: {
        Args: { p_client_key: string; p_payment: Json }
        Returns: Json
      }
      record_pos_cash_movement_command: {
        Args: { p_payload: Json }
        Returns: Json
      }
      record_sale_stock_and_cogs: {
        Args: { p_invoice_id: string; p_lines: Json }
        Returns: Json
      }
      refund_pos_sale_command: { Args: { p_payload: Json }; Returns: Json }
      register_construction_procurement_site: {
        Args: {
          p_branch_id: string
          p_business_id: string
          p_location_id: string
          p_project_ref: string
          p_site_code: string
          p_site_name: string
        }
        Returns: Json
      }
      register_construction_product_uom_conversion: {
        Args: {
          p_business_id: string
          p_evidence_reference: string
          p_factor: number
          p_from_uom: string
          p_product_id: string
          p_to_uom: string
        }
        Returns: Json
      }
      register_construction_supplier_invoice_reference: {
        Args: { p_expense_id: string }
        Returns: Json
      }
      register_construction_supplier_invoice_reference_exception: {
        Args: {
          p_evidence: string
          p_exception_of: string
          p_expense_id: string
          p_reason: string
        }
        Returns: Json
      }
      release_construction_receipt_hold: {
        Args: { p_hold_id: string; p_reason: string }
        Returns: Json
      }
      release_retention: {
        Args: { p_amount: number; p_description: string; p_project_id: string }
        Returns: Json
      }
      remove_partner_admin: {
        Args: { p_partner_id: string; p_user_email_or_id: string }
        Returns: undefined
      }
      reopen_accounting_period: {
        Args: { p_period_id: string; p_reason: string }
        Returns: Json
      }
      reorder_boq_lines: {
        Args: { p_line_ids: string[]; p_project_id: string }
        Returns: {
          created_at: string
          description: string
          id: string
          line_number: string
          project_id: string
          quantity: number
          rate: number
          sort_order: number
          total_value: number
          unit: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "project_boq_lines"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      request_pos_approval: {
        Args: {
          p_action: string
          p_amount?: number
          p_business_id: string
          p_document_id: string
          p_reason?: string
          p_ttl_minutes?: number
        }
        Returns: Json
      }
      request_pos_price_override: {
        Args: {
          p_business_id: string
          p_kind: string
          p_max_discount_percent?: number
          p_product_id?: string
          p_reason?: string
          p_ttl_minutes?: number
          p_unit_price?: number
        }
        Returns: Json
      }
      reserve_next_document_number: {
        Args: { p_business_id: string; p_kind: string }
        Returns: string
      }
      return_construction_materials_to_store: {
        Args: { p_client_key: string; p_payload: Json }
        Returns: Json
      }
      return_project_materials: {
        Args: { p_client_key: string; p_payload: Json; p_project_id: string }
        Returns: Json
      }
      revoke_construction_procurement_capability: {
        Args: { p_grant_id: string; p_reason: string }
        Returns: Json
      }
      save_quick_expense: { Args: { p_payload: Json }; Returns: Json }
      save_quick_sale: { Args: { p_payload: Json }; Returns: Json }
      seed_new_business:
        | {
            Args: { p_biz: Json }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.seed_new_business(p_biz => uuid), public.seed_new_business(p_biz => jsonb). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
        | {
            Args: { p_biz: string }
            Returns: {
              error: true
            } & "Could not choose the best candidate function between: public.seed_new_business(p_biz => uuid), public.seed_new_business(p_biz => jsonb). Try renaming the parameters or the function itself in the database so function overloading can be resolved"
          }
      set_construction_procurement_site_status: {
        Args: { p_active: boolean; p_reason?: string; p_site_id: string }
        Returns: Json
      }
      set_invoice_approval_policy: {
        Args: {
          p_business_id: string
          p_enabled: boolean
          p_roles?: string[]
          p_threshold: number
        }
        Returns: Json
      }
      set_user_business_access: {
        Args: {
          p_business_ids: string[]
          p_revoke_others?: boolean
          p_role?: string
          p_user_email_or_id: string
        }
        Returns: {
          out_action: string
          out_business_id: string
          out_business_name: string
          out_role: string
        }[]
      }
      show_limit: { Args: Record<PropertyKey, never>; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      submit_valuation: { Args: { p_valuation_id: string }; Returns: Json }
      transition_project_status: {
        Args: { p_new_status: string; p_project_id: string; p_reason?: string }
        Returns: {
          boq_locked_at: string | null
          budget: number
          business_id: string
          client_id: string | null
          client_name: string
          contract_sum: number
          created_at: string
          created_by: string
          end_date: string | null
          id: string
          name: string
          retention_pct: number
          start_date: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "construction_projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      unlink_site_from_project: {
        Args: { p_location_id: string }
        Returns: {
          branch_id: string | null
          business_id: string
          code: string | null
          created_at: string
          id: string
          is_active: boolean
          is_default: boolean
          location_type: string
          name: string
          project_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "inventory_locations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_boq_line: {
        Args: {
          p_description: string
          p_line_id: string
          p_line_number: string
          p_quantity: number
          p_rate: number
          p_sort_order: number
          p_unit: string
        }
        Returns: {
          created_at: string
          description: string
          id: string
          line_number: string
          project_id: string
          quantity: number
          rate: number
          sort_order: number
          total_value: number
          unit: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "project_boq_lines"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_business_operating_models: {
        Args: { p_business_id: string; p_operating_models: string[] }
        Returns: string[]
      }
      update_construction_procurement_site: {
        Args: {
          p_project_id?: string
          p_project_ref?: string
          p_set_project?: boolean
          p_site_id: string
          p_site_name?: string
        }
        Returns: Json
      }
      update_project: {
        Args: {
          p_budget: number
          p_client_id?: string
          p_client_name: string
          p_contract_sum: number
          p_end_date: string
          p_name: string
          p_project_id: string
          p_retention_pct: number
          p_start_date: string
        }
        Returns: {
          boq_locked_at: string | null
          budget: number
          business_id: string
          client_id: string | null
          client_name: string
          contract_sum: number
          created_at: string
          created_by: string
          end_date: string | null
          id: string
          name: string
          retention_pct: number
          start_date: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "construction_projects"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      update_valuation: {
        Args: {
          p_lines: Json
          p_notes?: string
          p_period_end: string
          p_period_start: string
          p_valuation_date: string
          p_valuation_id: string
        }
        Returns: Json
      }
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
      void_pos_sale_command: { Args: { p_payload: Json }; Returns: Json }
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
        | "contra_ar"
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
        | "issue_out"
        | "construction_return_in"
        | "manufacturing_issue"
        | "manufacturing_return"
        | "manufacturing_receipt"
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
        | "data_entry"
        | "supervisor"
        | "inventory_manager"
        | "sales_clerk"
        | "purchasing_officer"
        | "warehouse_worker"
        | "sales_manager"
        | "customer_service_rep"
        | "tax_compliance_officer"
        | "treasury_manager"
        | "asset_manager"
        | "board_member"
        | "branch_manager"
        | "cashier"
        | "manager"
        | "stock_clerk"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
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
        "contra_ar",
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
        "issue_out",
        "construction_return_in",
        "manufacturing_issue",
        "manufacturing_return",
        "manufacturing_receipt",
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
        "data_entry",
        "supervisor",
        "inventory_manager",
        "sales_clerk",
        "purchasing_officer",
        "warehouse_worker",
        "sales_manager",
        "customer_service_rep",
        "tax_compliance_officer",
        "treasury_manager",
        "asset_manager",
        "board_member",
        "branch_manager",
        "cashier",
        "manager",
        "stock_clerk",
      ],
    },
  },
} as const
