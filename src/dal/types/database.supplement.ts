/**
 * Hand-written schema types for tables that `supabase gen types` has not yet
 * picked up.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `database.generated.ts` is stale relative to `supabase/migrations/`. It is
 * missing every table added by:
 *   • 20260727000001_public_api_webhooks.sql   — api_keys, api_usage, webhooks,
 *                                                webhook_deliveries
 *   • 20260727000002_white_label_partners.sql  — partners, partner_feature_flags,
 *                                                partner_clients
 *   • 20260727000003_partner_billing.sql       — partner_invoices
 *   • 20260727000004_..._hardening.sql         — partner_admins,
 *                                                v_partner_client_usage
 *
 * Because those relations were absent from the `Database` type, every consumer
 * had to launder its queries through an untyped client
 * (`supabase as unknown as { from: (t: string) => any }`). That is what made
 * the `journal_entries.total_debits` bug possible: casting the table name
 * disables Supabase's column checking, so a column that does not exist reads
 * as valid TypeScript and fails only at runtime.
 *
 * MAINTENANCE
 * -----------
 * This file is a stopgap, not a parallel source of truth. Once someone with
 * database access runs:
 *
 *   npx supabase gen types typescript --project-id <ref> > src/dal/types/database.generated.ts
 *
 * these definitions will be present in the generated output. At that point
 * delete this file and the merge in `database.ts` — the compiler will flag any
 * drift between the two, since the merge is a plain intersection.
 *
 * Column definitions below were transcribed from the migrations listed above,
 * including the ALTERs in the hardening migration. Nullability follows the DDL:
 * a column is optional in Insert when it has a DEFAULT or is nullable.
 */

export type SupplementalTables = {
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
    }
    Insert: {
      id?: string
      business_id: string
      name: string
      key_hash: string
      key_prefix: string
      last_used_at?: string | null
      created_by?: string | null
      created_at?: string
      revoked_at?: string | null
    }
    Update: {
      id?: string
      business_id?: string
      name?: string
      key_hash?: string
      key_prefix?: string
      last_used_at?: string | null
      created_by?: string | null
      created_at?: string
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
    ]
  }
  api_usage: {
    Row: {
      id: string
      api_key_id: string | null
      api_key: string | null
      count: number
      window_start: string
      created_at: string
    }
    Insert: {
      id?: string
      api_key_id?: string | null
      api_key?: string | null
      count?: number
      window_start?: string
      created_at?: string
    }
    Update: {
      id?: string
      api_key_id?: string | null
      api_key?: string | null
      count?: number
      window_start?: string
      created_at?: string
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
    }
    Insert: {
      id?: string
      business_id: string
      url: string
      events?: string[]
      secret?: string
      is_active?: boolean
      last_triggered_at?: string | null
      created_by?: string | null
      created_at?: string
      updated_at?: string
    }
    Update: {
      id?: string
      business_id?: string
      url?: string
      events?: string[]
      secret?: string
      is_active?: boolean
      last_triggered_at?: string | null
      created_by?: string | null
      created_at?: string
      updated_at?: string
    }
    Relationships: [
      {
        foreignKeyName: "webhooks_business_id_fkey"
        columns: ["business_id"]
        isOneToOne: false
        referencedRelation: "businesses"
        referencedColumns: ["id"]
      },
    ]
  }
  webhook_deliveries: {
    Row: {
      id: string
      webhook_id: string
      event: string
      payload: unknown
      status_code: number | null
      response_body: string | null
      attempt: number
      delivered_at: string | null
      created_at: string
    }
    Insert: {
      id?: string
      webhook_id: string
      event: string
      payload: unknown
      status_code?: number | null
      response_body?: string | null
      attempt?: number
      delivered_at?: string | null
      created_at?: string
    }
    Update: {
      id?: string
      webhook_id?: string
      event?: string
      payload?: unknown
      status_code?: number | null
      response_body?: string | null
      attempt?: number
      delivered_at?: string | null
      created_at?: string
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
      // added by 20260727000004
      slug: string | null
      custom_domain: string | null
      onboarding_title: string | null
      onboarding_subtitle: string | null
      support_phone: string | null
      allow_client_visibility: boolean
      billing_contact_name: string | null
      price_per_client: number
      billing_currency: string
    }
    Insert: {
      id?: string
      name: string
      domain?: string | null
      logo_url?: string | null
      primary_colour?: string | null
      support_email?: string | null
      app_name?: string | null
      client_limit?: number | null
      is_active?: boolean | null
      billing_email?: string | null
      created_at?: string | null
      updated_at?: string | null
      slug?: string | null
      custom_domain?: string | null
      onboarding_title?: string | null
      onboarding_subtitle?: string | null
      support_phone?: string | null
      allow_client_visibility?: boolean
      billing_contact_name?: string | null
      price_per_client?: number
      billing_currency?: string
    }
    Update: {
      id?: string
      name?: string
      domain?: string | null
      logo_url?: string | null
      primary_colour?: string | null
      support_email?: string | null
      app_name?: string | null
      client_limit?: number | null
      is_active?: boolean | null
      billing_email?: string | null
      created_at?: string | null
      updated_at?: string | null
      slug?: string | null
      custom_domain?: string | null
      onboarding_title?: string | null
      onboarding_subtitle?: string | null
      support_phone?: string | null
      allow_client_visibility?: boolean
      billing_contact_name?: string | null
      price_per_client?: number
      billing_currency?: string
    }
    Relationships: []
  }
  partner_feature_flags: {
    Row: {
      partner_id: string
      feature_key: string
      enabled: boolean | null
    }
    Insert: {
      partner_id: string
      feature_key: string
      enabled?: boolean | null
    }
    Update: {
      partner_id?: string
      feature_key?: string
      enabled?: boolean | null
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
  partner_clients: {
    Row: {
      partner_id: string
      business_id: string
      created_at: string | null
    }
    Insert: {
      partner_id: string
      business_id: string
      created_at?: string | null
    }
    Update: {
      partner_id?: string
      business_id?: string
      created_at?: string | null
    }
    Relationships: [
      {
        foreignKeyName: "partner_clients_partner_id_fkey"
        columns: ["partner_id"]
        isOneToOne: false
        referencedRelation: "partners"
        referencedColumns: ["id"]
      },
      {
        foreignKeyName: "partner_clients_business_id_fkey"
        columns: ["business_id"]
        isOneToOne: false
        referencedRelation: "businesses"
        referencedColumns: ["id"]
      },
    ]
  }
  partner_admins: {
    Row: {
      partner_id: string
      user_id: string
      role: string
      created_at: string
    }
    Insert: {
      partner_id: string
      user_id: string
      role?: string
      created_at?: string
    }
    Update: {
      partner_id?: string
      user_id?: string
      role?: string
      created_at?: string
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
  partner_invoices: {
    Row: {
      id: string
      partner_id: string | null
      amount: number | null
      currency: string | null
      status: string | null
      created_at: string | null
      updated_at: string | null
      // added by 20260727000004
      invoice_number: string | null
      period_start: string | null
      period_end: string | null
      due_date: string | null
      client_count: number
      notes: string | null
    }
    Insert: {
      id?: string
      partner_id?: string | null
      amount?: number | null
      currency?: string | null
      status?: string | null
      created_at?: string | null
      updated_at?: string | null
      invoice_number?: string | null
      period_start?: string | null
      period_end?: string | null
      due_date?: string | null
      client_count?: number
      notes?: string | null
    }
    Update: {
      id?: string
      partner_id?: string | null
      amount?: number | null
      currency?: string | null
      status?: string | null
      created_at?: string | null
      updated_at?: string | null
      invoice_number?: string | null
      period_start?: string | null
      period_end?: string | null
      due_date?: string | null
      client_count?: number
      notes?: string | null
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
  // Added by 20260803000000_marketing_agent.sql (Marketing Assistant, Phase 0).
  // status is the marketing_post_status enum; typed as a literal union here
  // because the enum isn't in the generated Enums map yet.
  marketing_posts: {
    Row: {
      id: string
      business_id: string
      created_by: string | null
      kind: string
      channel: string
      status: 'draft' | 'approved' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'archived'
      title: string | null
      content_json: Record<string, unknown>
      scheduled_for: string | null
      published_at: string | null
      external_id: string | null
      error: string | null
      created_at: string
      updated_at: string
    }
    Insert: {
      id?: string
      business_id: string
      created_by?: string | null
      kind?: string
      channel?: string
      status?: 'draft' | 'approved' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'archived'
      title?: string | null
      content_json?: Record<string, unknown>
      scheduled_for?: string | null
      published_at?: string | null
      external_id?: string | null
      error?: string | null
      created_at?: string
      updated_at?: string
    }
    Update: {
      id?: string
      business_id?: string
      created_by?: string | null
      kind?: string
      channel?: string
      status?: 'draft' | 'approved' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'archived'
      title?: string | null
      content_json?: Record<string, unknown>
      scheduled_for?: string | null
      published_at?: string | null
      external_id?: string | null
      error?: string | null
      created_at?: string
      updated_at?: string
    }
    Relationships: [
      {
        foreignKeyName: "marketing_posts_business_id_fkey"
        columns: ["business_id"]
        isOneToOne: false
        referencedRelation: "businesses"
        referencedColumns: ["id"]
      },
    ]
  }
}

export type SupplementalViews = {
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
    Relationships: [
      {
        foreignKeyName: "partner_clients_partner_id_fkey"
        columns: ["partner_id"]
        isOneToOne: false
        referencedRelation: "partners"
        referencedColumns: ["id"]
      },
      {
        foreignKeyName: "partner_clients_business_id_fkey"
        columns: ["business_id"]
        isOneToOne: false
        referencedRelation: "businesses"
        referencedColumns: ["id"]
      },
    ]
  }
}
