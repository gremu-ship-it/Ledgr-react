import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { Search, ShieldCheck, CheckCircle2, Loader2, KeyRound, Clock } from 'lucide-react';
import { pushSuccess, pushError } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { subscriptionPaymentService, type ManualPaymentMethod } from '@/services/billing/SubscriptionPaymentService';
import { PLANS, type PlanTier } from '@/lib/billing/plans';
import { handleError } from '@/lib/errorHandler';

interface BusinessSearchResult {
  id: string;
  name: string;
  plan_tier: string;
  plan_expires_at: string | null;
}

const PAYMENT_METHODS: { value: ManualPaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank_transfer', label: 'Bank Transfer' },
  { value: 'mobile_money', label: 'Mobile Money (sent directly)' },
  { value: 'other', label: 'Other' },
];

/**
 * Internal tool for platform admins to activate a plan for a business that
 * paid outside PayChangu — cash, bank transfer, mobile money sent directly
 * to the business's own account, etc. Not linked from anywhere in normal
 * navigation; only reachable at /admin/billing and only usable by accounts
 * with user_profiles.is_platform_admin = true (both client-gated via
 * useIsPlatformAdmin and, more importantly, re-checked server-side by the
 * grant-manual-subscription Edge Function).
 */
export function AdminBillingPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState('');
  const [directId, setDirectId] = useState('');
  const [selected, setSelected] = useState<BusinessSearchResult | null>(null);
  const [targetTier, setTargetTier] = useState<Exclude<PlanTier, 'free'>>('growth');
  const [durationDays, setDurationDays] = useState(31);
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<ManualPaymentMethod>('bank_transfer');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Support deep linking: /admin/billing?business=UUID or ?id=UUID
  useEffect(() => {
    const businessId = searchParams.get('business') || searchParams.get('id');
    if (businessId && !selected) {
      (async () => {
        try {
          const { data, error } = await supabase
            .from('businesses')
            .select('id, name, plan_tier, plan_expires_at')
            .eq('id', businessId)
            .maybeSingle();
          if (data && !error) {
            setSelected(data as BusinessSearchResult);
            setDirectId('');
            setSearchParams({}, { replace: true });
          }
        } catch {
          // ignore — user can still paste the ID manually
        }
      })();
    }
  }, [searchParams, selected, setSearchParams]);

  const { data: results = [], isFetching } = useQuery({
    queryKey: ['admin-business-search', search],
    queryFn: async (): Promise<BusinessSearchResult[]> => {
      const { data, error } = await supabase
        .from('businesses')
        .select('id, name, plan_tier, plan_expires_at')
        .ilike('name', `%${search}%`)
        .order('name')
        .limit(20);
      if (error) throw error;
      return (data ?? []) as BusinessSearchResult[];
    },
    enabled: search.trim().length >= 2,
  });

  const grantMutation = useMutation({
    mutationFn: () =>
      subscriptionPaymentService.grantManualSubscription({
        business_id: selected!.id,
        target_plan_tier: targetTier,
        duration_days: durationDays,
        amount: Number(amount) || 0,
        payment_method: paymentMethod,
        reference: reference || undefined,
        notes: notes || undefined,
      }),
    onSuccess: (result) => {
      setSuccessMessage(
        `${result.business_name} upgraded to ${PLANS[result.plan_tier as PlanTier]?.name ?? result.plan_tier} until ${new Date(result.plan_expires_at).toLocaleDateString()}.`,
      );
      queryClient.invalidateQueries({ queryKey: ['admin-business-search'] });
      queryClient.invalidateQueries({ queryKey: ['business', selected?.id] });
      queryClient.invalidateQueries({ queryKey: ['usage', selected?.id] });
      queryClient.invalidateQueries({ queryKey: ['subscription-payments', selected?.id] });
      setSelected(null);
      setAmount('');
      setReference('');
      setNotes('');
    },
  });

  // Quick grant helpers (for the selected business)
  const quickGrant = async (tier: Exclude<PlanTier, 'free'>, days: number) => {
    if (!selected) return;

    const planName = PLANS[tier].name;

    try {
      await subscriptionPaymentService.grantManualSubscription({
        business_id: selected.id,
        target_plan_tier: tier,
        duration_days: days,
        amount: PLANS[tier].priceMWK,
        payment_method: 'cash',
        notes: `Quick ${planName} grant (${days} days)`,
      });

      pushSuccess(`${planName} granted`, `${planName} activated for ${days} days`, { businessId: selected.id });
      queryClient.invalidateQueries({ queryKey: ['admin-business-search'] });
      queryClient.invalidateQueries({ queryKey: ['business', selected.id] });
      queryClient.invalidateQueries({ queryKey: ['usage', selected.id] });
      setSelected(null);
    } catch (e: unknown) {
      handleError(e, { module: 'AdminBillingPage', operation: 'grantPlan', notify: false, businessId: selected.id });
      const message = e instanceof Error ? e.message : 'Could not grant plan';
      pushError('Grant failed', message, { businessId: selected.id });
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-center gap-2">
        <ShieldCheck className="h-6 w-6 text-brand-600" />
        <h1 className="text-2xl font-semibold text-gray-900">Admin · Grant Manual Subscription</h1>
      </div>
      <p className="mb-6 text-sm text-gray-500">
        Use this when a business has paid you outside PayChangu (cash, bank transfer, or mobile money sent
        directly) and needs their plan activated by hand. This is recorded in the same payment history as a
        normal PayChangu payment, tagged as a manual grant.
      </p>

      {successMessage && (
        <div className="mb-6 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
          {successMessage}
        </div>
      )}

      {!selected && (
        <div className="space-y-6">
          {/* Search by name */}
          <div className="rounded-2xl border bg-white p-6">
            <label className="mb-2 block text-sm font-medium text-gray-700">Search business by name</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setDirectId(''); }}
                placeholder="Start typing a business name…"
                className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>

            {isFetching && <p className="mt-3 text-xs text-gray-600">Searching…</p>}

            {results.length > 0 && (
              <ul className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-100">
                {results.map((b) => (
                  <li key={b.id}>
                    <button
                      onClick={() => setSelected(b)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-gray-50"
                    >
                      <span className="font-medium text-gray-900">{b.name}</span>
                      <span className="text-xs text-gray-600">
                        Current: <span className="capitalize">{b.plan_tier}</span>
                        {b.plan_expires_at ? ` · expires ${new Date(b.plan_expires_at).toLocaleDateString()}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {search.trim().length >= 2 && !isFetching && results.length === 0 && (
              <p className="mt-3 text-xs text-gray-600">No businesses matched "{search}".</p>
            )}
          </div>

          {/* Direct ID input — very useful for known UUIDs (e.g. from support tickets) */}
          <div className="rounded-2xl border bg-white p-6">
            <label className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
              <KeyRound className="h-4 w-4" />
              Load business directly by ID (UUID)
            </label>
            <div className="flex gap-2">
              <input
                value={directId}
                onChange={(e) => {
                  setDirectId(e.target.value.trim());
                  setSearch('');
                }}
                placeholder="0fa55867-dee3-4b9b-9d4d-131d1c3aa3d8"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <button
                onClick={async () => {
                  if (!directId) return;
                  try {
                    const { data, error } = await supabase
                      .from('businesses')
                      .select('id, name, plan_tier, plan_expires_at')
                      .eq('id', directId)
                      .maybeSingle();

                    if (error) throw error;
                    if (data) {
                      setSelected(data as BusinessSearchResult);
                      setDirectId('');
                    } else {
                      alert('No business found with that ID.');
                    }
                  } catch (err) {
                    handleError(err, { module: 'AdminBillingPage', operation: 'loadBusinessById', notify: false });
                    alert('Failed to load business: ' + (err instanceof Error ? err.message : 'Unknown error'));
                  }
                }}
                disabled={!directId}
                className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
              >
                Load
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-gray-400">
              Paste the exact business UUID (useful when you have the ID from logs, support, or the business owner).
            </p>
          </div>
        </div>
      )}

      {selected && (
        <div className="rounded-2xl border bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold text-gray-900">{selected.name}</div>
              <div className="font-mono text-[10px] text-gray-700 break-all">{selected.id}</div>
              <div className="mt-0.5 text-xs text-gray-600">
                Current plan: <span className="capitalize font-medium text-gray-600">{selected.plan_tier}</span>
                {selected.plan_expires_at ? ` · expires ${new Date(selected.plan_expires_at).toLocaleDateString()}` : ''}
              </div>
            </div>
            <button 
              onClick={() => {
                setSelected(null);
                setDirectId('');
                setSearch('');
              }} 
              className="text-xs font-medium text-gray-500 hover:text-gray-700"
            >
              Change business
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Grant plan</label>
              <select
                value={targetTier}
                onChange={(e) => {
                  const newTier = e.target.value as Exclude<PlanTier, 'free'>;
                  setTargetTier(newTier);
                  // Auto-fill suggested amount when plan changes
                  if (!amount || amount === String(PLANS[targetTier].priceMWK)) {
                    setAmount(String(PLANS[newTier].priceMWK));
                  }
                }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              >
                <option value="growth">Growth</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Access duration (days)</label>
              <input
                type="number"
                min={1}
                max={3660}
                value={durationDays}
                onChange={(e) => setDurationDays(Number(e.target.value))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
              <p className="mt-1 text-[11px] text-gray-400">31 ≈ 1 month, 365 ≈ 1 year</p>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Amount received (MWK)</label>
              <input
                type="number"
                min={0}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={String(PLANS[targetTier].priceMWK)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Payment method</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as ManualPaymentMethod)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Reference (optional)</label>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="Bank ref / receipt number"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm font-medium text-gray-700">Notes (optional)</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Any extra context for the audit trail…"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
            </div>
          </div>

          {grantMutation.isError && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {grantMutation.error instanceof Error ? grantMutation.error.message : 'Failed to grant plan.'}
            </div>
          )}

          <button
            onClick={() => grantMutation.mutate()}
            disabled={grantMutation.isPending}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 py-3 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {grantMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Granting…
              </>
            ) : (
              `Grant ${PLANS[targetTier].name} for ${durationDays} days`
            )}
          </button>

          {/* Quick grant shortcuts for the selected business */}
          <div className="mt-6 border-t pt-4">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              <Clock className="h-3.5 w-3.5" /> Quick grants
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(['growth', 'pro', 'enterprise'] as const).map((tier) => (
                <div key={tier} className="space-y-1">
                  <div className="text-xs font-medium text-gray-600">{PLANS[tier].name}</div>
                  <div className="flex gap-1">
                    {[31, 90, 365].map((d) => (
                      <button
                        key={d}
                        onClick={() => quickGrant(tier, d)}
                        disabled={grantMutation.isPending}
                        className="flex-1 rounded-lg border border-gray-300 bg-white py-1 text-xs font-medium hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50"
                      >
                        {d}d
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick deep link for support / future reference */}
          <div className="mt-4 text-center">
            <a
              href={`/admin/billing?business=${selected.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-brand-600 hover:underline"
            >
              Bookmarkable link for this business →
            </a>
          </div>

          {/* Helpful diagnostic SQL for this business */}
          <div className="mt-4 rounded-lg bg-gray-50 p-3 text-xs">
            <div className="mb-1 font-medium text-gray-500">
              Quick diagnostic SQL (copy-paste into Supabase SQL editor)
            </div>
            <div className="space-y-2">
              <div>
                <div className="text-[10px] text-gray-700 mb-0.5">Business + plan status</div>
                <code className="block font-mono text-[10px] bg-white border p-2 rounded text-gray-700 break-all">
                  {`SELECT id, name, plan_tier, plan_expires_at, plan_updated_at FROM businesses WHERE id = '${selected.id}';`}
                </code>
                <button
                  onClick={() => {
                    const sql = `SELECT id, name, plan_tier, plan_expires_at, plan_updated_at FROM businesses WHERE id = '${selected.id}';`;
                    navigator.clipboard.writeText(sql);
                  }}
                  className="mt-1 text-[10px] text-brand-600 hover:underline"
                >
                  Copy
                </button>
              </div>

              <div>
                <div className="text-[10px] text-gray-700 mb-0.5">Payment / grant history</div>
                <code className="block font-mono text-[10px] bg-white border p-2 rounded text-gray-700 break-all">
                  {`SELECT tx_ref, gateway, target_plan_tier, status, amount, plan_expires_at, created_at FROM subscription_payments WHERE business_id = '${selected.id}' ORDER BY created_at DESC;`}
                </code>
                <button
                  onClick={() => {
                    const sql = `SELECT tx_ref, gateway, target_plan_tier, status, amount, plan_expires_at, created_at FROM subscription_payments WHERE business_id = '${selected.id}' ORDER BY created_at DESC;`;
                    navigator.clipboard.writeText(sql);
                  }}
                  className="mt-1 text-[10px] text-brand-600 hover:underline"
                >
                  Copy
                </button>
              </div>
            </div>
            <p className="mt-2 text-[10px] text-red-600 font-medium">
              ⚠️ <strong>Important:</strong> UUIDs <strong>must</strong> be in single quotes. Example of the correct syntax:
              <br />
              <code className="font-mono">WHERE id = '655ad01b-ea0c-45fb-8387-c30f5b0ab12d';</code>
            </p>
          </div>
        </div>
      )}

      <p className="mt-6 text-xs text-gray-600">
        Ledgr internal tool — platform admins only. You can also open directly with <code className="font-mono">/admin/billing?business=UUID</code>
      </p>
    </div>
  );
}
