import { supabase } from '@/lib/supabase';

export interface ApiKey {
  id: string;
  business_id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

type UntypedSupabase = typeof supabase & {
  from: (relation: string) => {
    select: (columns?: string) => unknown;
    update: (values: Record<string, unknown>) => unknown;
  };
};

const db = supabase as UntypedSupabase;

export class ApiKeyService {
  async createApiKey(businessId: string, name: string): Promise<{ key: string; record: ApiKey }> {
    const { data, error } = await supabase.functions.invoke('create-api-key', {
      body: { business_id: businessId, name },
    });
    if (error) throw error;
    return data;
  }

  async listApiKeys(businessId: string): Promise<ApiKey[]> {
    const query = db.from('api_keys').select('*') as {
      eq: (column: string, value: unknown) => {
        is: (column: string, value: unknown) => {
          order: (column: string, options: { ascending: boolean }) => Promise<{ data: ApiKey[] | null; error: unknown }>;
        };
      };
    };

    const { data, error } = await query
      .eq('business_id', businessId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async revokeApiKey(keyId: string): Promise<void> {
    const query = db.from('api_keys').update({ revoked_at: new Date().toISOString() }) as {
      eq: (column: string, value: unknown) => Promise<{ error: unknown }>;
    };

    const { error } = await query.eq('id', keyId);
    if (error) throw error;
  }
}

export const apiKeyService = new ApiKeyService();
