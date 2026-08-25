import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Clock, CheckCircle, XCircle } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { webhookService, type Webhook, type WebhookDelivery } from '@/services/webhook/WebhookService';
import { ApiKeysPage } from '@/pages/ApiKeysPage';
import { queryKeys } from '@/lib/queryKeys';

const AVAILABLE_EVENTS = [
  'invoice.created',
  'invoice.paid',
  'expense.created',
  'payroll.run',
  'tax.due_soon',
  'journal_entry.created',
];

export function WebhookSettings() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const queryClient = useQueryClient();

  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [selectedWebhook, setSelectedWebhook] = useState<Webhook | null>(null);
  const activeSelectedWebhook = selectedWebhook?.business_id === businessId
    ? selectedWebhook
    : null;

  const { data: webhooks = [] } = useQuery({
    queryKey: ['webhooks', businessId],
    queryFn: () => webhookService.listWebhooks(businessId!),
    enabled: !!businessId,
  });

  const { data: deliveries = [] } = useQuery({
    queryKey: queryKeys.webhookDeliveries(businessId ?? '', activeSelectedWebhook?.id ?? ''),
    queryFn: () => webhookService.getDeliveries(activeSelectedWebhook!.id),
    enabled: Boolean(businessId && activeSelectedWebhook),
  });

  const createMutation = useMutation({
    mutationFn: () => webhookService.registerWebhook(businessId!, url, selectedEvents),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', businessId] });
      setUrl('');
      setSelectedEvents([]);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => webhookService.deleteWebhook(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks', businessId] });
      setSelectedWebhook(null);
    },
  });

  const toggleEvent = (event: string) => {
    setSelectedEvents(prev =>
      prev.includes(event)
        ? prev.filter(e => e !== event)
        : [...prev, event]
    );
  };

  if (!businessId) return null;

  return (
    <div className="space-y-8">
      <ApiKeysPage compact />

      {/* Register new webhook */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <Plus className="h-5 w-5" /> Register Webhook
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL</label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://yourapp.com/webhooks/ledgr"
              className="w-full rounded-lg border px-4 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Events to subscribe to</label>
            <div className="flex flex-wrap gap-2">
              {AVAILABLE_EVENTS.map(event => (
                <button
                  key={event}
                  onClick={() => toggleEvent(event)}
                  className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                    selectedEvents.includes(event)
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white hover:bg-gray-50'
                  }`}
                >
                  {event}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => createMutation.mutate()}
            disabled={!url || selectedEvents.length === 0 || createMutation.isPending}
            className="rounded-lg bg-brand-600 px-6 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {createMutation.isPending ? 'Registering...' : 'Register Webhook'}
          </button>
        </div>
      </div>

      {/* Active Webhooks */}
      <div>
        <h3 className="mb-4 text-lg font-semibold">Active Webhooks</h3>
        
        {webhooks.length === 0 ? (
          <p className="text-sm text-gray-500">No webhooks registered yet.</p>
        ) : (
          <div className="space-y-3">
            {webhooks.map((wh: Webhook) => (
              <div
                key={wh.id}
                onClick={() => setSelectedWebhook(wh)}
                className={`rounded-xl border p-4 cursor-pointer transition-all ${
                  selectedWebhook?.id === wh.id ? 'border-brand-500 bg-brand-50' : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-mono text-sm text-gray-600">{wh.url}</div>
                    <div className="mt-1 flex gap-1 flex-wrap">
                      {wh.events.map(ev => (
                        <span key={ev} className="text-[10px] px-2 py-0.5 bg-gray-200 rounded">{ev}</span>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(wh.id); }}
                    className="text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Delivery Log */}
      {activeSelectedWebhook && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Clock className="h-4 w-4" /> Delivery Log — {activeSelectedWebhook.url}
            </h3>
            <button onClick={() => setSelectedWebhook(null)} className="text-xs text-gray-500">Close</button>
          </div>

          {deliveries.length === 0 ? (
            <p className="text-sm text-gray-500">No deliveries yet.</p>
          ) : (
            <div className="space-y-3 text-sm">
              {deliveries.map((d: WebhookDelivery) => (
                <div key={d.id} className="rounded-lg border p-3 bg-gray-50">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      {d.status_code && d.status_code < 400 ? (
                        <CheckCircle className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-600" />
                      )}
                      <span className="font-mono">{d.event}</span>
                      <span className="text-gray-500">Attempt #{d.attempt}</span>
                    </div>
                    <div className="text-gray-500">
                      {new Date(d.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-gray-600">
                    Status: <span className="font-mono">{d.status_code || 'Failed'}</span>
                  </div>
                  {d.response_body && (
                    <pre className="mt-2 text-[10px] bg-white p-2 rounded overflow-x-auto max-h-24">
                      {d.response_body}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}