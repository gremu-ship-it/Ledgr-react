import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, ShieldCheck, CheckCircle2, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { subscriptionPaymentService, type ManualPaymentMethod } from '@/services/billing/SubscriptionPaymentService';
import { PLANS, type PlanTier } from '@/lib/billing/plans';

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
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<BusinessSearchResult | null>(null);
  const [targetTier, setTargetTier] = useState<Exclude<PlanTier, 'free'>>('growth');
  const [durationDays, setDurationDays] = useState(31);
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<ManualPaymentMethod>('bank_transfer');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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
        <div className="rounded-2xl border bg-white p-6">
          <label className="mb-2 block text-sm font-medium text-gray-700">Search business by name</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Start typing a business name…"
              className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          {isFetching && <p className="mt-3 text-xs text-gray-400">Searching…</p>}

          {results.length > 0 && (
            <ul className="mt-4 divide-y divide-gray-100 rounded-lg border border-gray-100">
              {results.map((b) => (
                <li key={b.id}>
                  <button
                    onClick={() => setSelected(b)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-gray-50"
                  >
                    <span className="font-medium text-gray-900">{b.name}</span>
                    <span className="text-xs text-gray-400">
                      Current: <span className="capitalize">{b.plan_tier}</span>
                      {b.plan_expires_at ? ` · expires ${new Date(b.plan_expires_at).toLocaleDateString()}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {search.trim().length >= 2 && !isFetching && results.length === 0 && (
            <p className="mt-3 text-xs text-gray-400">No businesses matched "{search}".</p>
          )}
        </div>
      )}

      {selected && (
        <div className="rounded-2xl border bg-white p-6">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold text-gray-900">{selected.name}</div>
              <div className="text-xs text-gray-400">
                Current plan: <span className="capitalize">{selected.plan_tier}</span>
              </div>
            </div>
            <button onClick={() => setSelected(null)} className="text-xs font-medium text-gray-500 hover:text-gray-700">
              Change business
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Grant plan</label>
              <select
                value={targetTier}
                onChange={(e) => setTargetTier(e.target.value as Exclude<PlanTier, 'free'>)}
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
        </div>
      )}

      <p className="mt-6 text-xs text-gray-400">Ledgr internal tool — not linked from normal navigation.</p>
    </div>
  );
}
