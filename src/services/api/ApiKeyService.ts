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

export class ApiKeyService {
  async createApiKey(businessId: string, name: string): Promise<{ key: string; record: ApiKey }> {
    const { data, error } = await supabase.functions.invoke('create-api-key', {
      body: { business_id: businessId, name },
    });
    if (error) throw error;
    if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
    return data as { key: string; record: ApiKey };
  }

  async listApiKeys(businessId: string): Promise<ApiKey[]> {
    const { data, error } = await supabase
      .from('api_keys')
      .select('id, business_id, name, key_prefix, last_used_at, created_at, revoked_at')
      .eq('business_id', businessId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async revokeApiKey(keyId: string): Promise<void> {
    const { error } = await supabase
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', keyId);
    if (error) throw error;
  }
}

export const apiKeyService = new ApiKeyService();
