import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Copy, Check } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { apiKeyService } from '@/services/api/ApiKeyService';
import type { ApiKey } from '@/services/api/ApiKeyService';
import { useLocaleFormat } from '@/i18n';

export function ApiKeysPage({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const format = useLocaleFormat();
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

  if (!businessId) return <div className="p-8">{t('api.noBusinessSelected')}</div>;

  return (
    <div className={compact ? 'space-y-6' : 'mx-auto max-w-4xl p-8'}>
      <h1 className="mb-6 text-2xl font-semibold">{t('api.apiKeys')}</h1>

      {/* Generate new key */}
      <div className="mb-8 rounded-2xl border bg-white p-6">
        <h3 className="mb-3 font-medium">{t('api.createNewApiKey')}</h3>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder={t('api.keyNamePlaceholder')}
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            className="flex-1 rounded-lg border px-4 py-2"
          />
          <button
            onClick={() => createMutation.mutate()}
            disabled={!newKeyName.trim() || createMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-6 text-white disabled:opacity-60"
          >
            <Plus className="h-4 w-4" /> {t('api.generate')}
          </button>
        </div>

        {generatedKey && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-emerald-700">{t('api.yourNewApiKey')}</span>
              <button onClick={copyKey} className="flex items-center gap-1 text-xs text-emerald-700">
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? t('api.copied') : t('api.copy')}
              </button>
            </div>
            <code className="break-all font-mono text-sm">{generatedKey}</code>
            <p className="mt-2 text-xs text-emerald-800">{t('api.saveKeyWarning')}</p>
          </div>
        )}
      </div>

      {/* Existing keys */}
      <div>
        <h3 className="mb-3 font-medium">{t('api.activeKeys')}</h3>
        {isLoading ? (
          <div className="text-sm text-gray-500">{t('common.loading')}</div>
        ) : keys.length === 0 ? (
          <p className="text-sm text-gray-500">{t('api.noApiKeys')}</p>
        ) : (
          <div className="space-y-3">
            {keys.map((key: ApiKey) => (
              <div key={key.id} className="flex items-center justify-between rounded-xl border p-4">
                <div>
                  <div className="font-medium">{key.name}</div>
                  <div className="font-mono text-xs text-gray-500">{key.key_prefix}••••••••</div>
                  {key.last_used_at && (
                    <div className="text-xs text-gray-600">{t('api.lastUsed', { date: format.date(key.last_used_at) })}</div>
                  )}
                </div>
                <button
                  onClick={() => revokeMutation.mutate(key.id)}
                  className="flex items-center gap-1 text-sm text-red-600 hover:text-red-700"
                >
                  <Trash2 className="h-4 w-4" /> {t('api.revoke')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
