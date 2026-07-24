import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Copy, Check } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { apiKeyService, ApiKey } from '@/services/api/ApiKeyService';

export function ApiKeysPage() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const queryClient = useQueryClient();
  const [newKeyName, setNewKeyName] = useState('');
  const [generatedKey, setGeneratedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: keys = [], isLoading } = useQuery({
    queryKey: ['api-keys', businessId],
    queryFn: () => apiKeyService.listApiKeys(businessId!),
    enabled: !!businessId,
  });

  const createMutation = useMutation({
    mutationFn: () => apiKeyService.createApiKey(businessId!, newKeyName),
    onSuccess: (data) => {
      setGeneratedKey(data.key);
      setNewKeyName('');
      queryClient.invalidateQueries({ queryKey: ['api-keys', businessId] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => apiKeyService.revokeApiKey(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys', businessId] }),
  });

  const copyKey = () => {
    if (generatedKey) {
      navigator.clipboard.writeText(generatedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!businessId) return <div className="p-8">No business selected.</div>;

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-semibold mb-6">API Keys</h1>

      {/* Generate new key */}
      <div className="mb-8 p-6 border rounded-2xl bg-white">
        <h3 className="font-medium mb-3">Create New API Key</h3>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Key name (e.g. Zapier Integration)"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            className="flex-1 border rounded-lg px-4 py-2"
          />
          <button
            onClick={() => createMutation.mutate()}
            disabled={!newKeyName.trim() || createMutation.isPending}
            className="bg-brand-500 text-white px-6 rounded-lg flex items-center gap-2 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" /> Generate
          </button>
        </div>

        {generatedKey && (
          <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-emerald-700">Your new API key</span>
              <button onClick={copyKey} className="text-xs flex items-center gap-1 text-emerald-700">
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <code className="font-mono text-sm break-all">{generatedKey}</code>
            <p className="text-xs text-emerald-600 mt-2">Save this key now — it will not be shown again.</p>
          </div>
        )}
      </div>

      {/* Existing keys */}
      <div>
        <h3 className="font-medium mb-3">Active Keys</h3>
        {isLoading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : keys.length === 0 ? (
          <p className="text-sm text-gray-500">No API keys yet.</p>
        ) : (
          <div className="space-y-3">
            {keys.map((key: ApiKey) => (
              <div key={key.id} className="flex items-center justify-between border rounded-xl p-4">
                <div>
                  <div className="font-medium">{key.name}</div>
                  <div className="text-xs text-gray-500 font-mono">{key.key_prefix}••••••••</div>
                  {key.last_used_at && (
                    <div className="text-xs text-gray-400">Last used: {new Date(key.last_used_at).toLocaleDateString()}</div>
                  )}
                </div>
                <button
                  onClick={() => revokeMutation.mutate(key.id)}
                  className="text-red-600 hover:text-red-700 flex items-center gap-1 text-sm"
                >
                  <Trash2 className="h-4 w-4" /> Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}