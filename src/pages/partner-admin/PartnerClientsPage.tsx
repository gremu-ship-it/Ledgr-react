import { useMemo, useState, type FormEvent } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, Search, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { partnerPortalRepository } from '@/dal/repositories/PartnerPortalRepository';
import { filterPartnerClients } from '@/lib/partner/filterPartnerClients';
import type { PartnerClientUsage } from '@/types/partners';
import { useAppStore } from '@/store/useAppStore';
import { usePartnerAdminAccess } from '@/hooks/usePartnerAdminAccess';
import { savePartnerClientContext } from '@/partner/partnerClientContext';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type StatusFilter = 'all' | PartnerClientUsage['status'];

function formatDate(value: string | null, locale: string) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function PartnerClientsPage() {
  const { id = '' } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const currentUser = useAppStore((state) => state.currentUser);
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const setCurrentBusiness = useAppStore((state) => state.setCurrentBusiness);
  const { isPlatformAdmin } = usePartnerAdminAccess();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [plan, setPlan] = useState('all');
  const [showAddClient, setShowAddClient] = useState(false);
  const [notice, setNotice] = useState<string | null>(() => {
    const state = location.state as { partnerContextError?: string } | null;
    return state?.partnerContextError ?? null;
  });

  const { data: currentStaffRole } = useQuery({
    queryKey: ['partner-staff-role', id, currentUser?.id],
    queryFn: () => partnerPortalRepository.getCurrentStaffRole(id, currentUser!.id),
    enabled: Boolean(id && currentUser?.id),
  });
  const canManagePartner = isPlatformAdmin || currentStaffRole === 'admin';

  const { data: partner } = useQuery({
    queryKey: ['partner', id],
    queryFn: () => partnerPortalRepository.getPartnerProfile(id),
    enabled: Boolean(id),
  });

  const { data: clients = [], isLoading, isError } = useQuery({
    queryKey: ['partner-usage', id],
    queryFn: () => partnerPortalRepository.getPartnerClients(id),
    enabled: Boolean(id),
  });

  const visibleClients = useMemo(
    () => filterPartnerClients(clients, search, status, plan),
    [clients, search, status, plan],
  );

  const { mutate: changeClientStatus, isPending: updatingStatus } = useMutation({
    mutationFn: ({ businessId, nextStatus }: { businessId: string; nextStatus: PartnerClientUsage['status'] }) =>
      partnerPortalRepository.updatePartnerClientStatus(id, businessId, nextStatus),
    onSuccess: () => {
      setNotice(t('partner.statusUpdated'));
      void queryClient.invalidateQueries({ queryKey: ['partner-usage', id] });
      void queryClient.invalidateQueries({ queryKey: ['partner-activity'] });
    },
    onError: () => setNotice(t('partner.statusUpdateFailed')),
  });

  const { mutate: enterClient, isPending: switchingClient } = useMutation({
    mutationFn: (client: PartnerClientUsage) =>
      partnerPortalRepository.getClientBusiness(id, client.business_id),
    onSuccess: (business) => {
      savePartnerClientContext({
        version: 1,
        partnerId: id,
        businessId: business.id,
        businessName: business.name,
        returnTo: `/partner-admin/partners/${id}/clients`,
        originalBusinessId: currentBusiness?.business?.id ?? null,
        enteredAt: new Date().toISOString(),
      });
      setCurrentBusiness({ business, role: 'viewer' });
      navigate('/dashboard');
    },
    onError: () => setNotice(t('partner.contextSwitchFailed')),
  });

  const { mutateAsync: addClient, isPending: addingClient } = useMutation({
    mutationFn: ({ businessId, notes }: { businessId: string; notes: string }) =>
      partnerPortalRepository.addPartnerClient(id, businessId, notes),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['partner-usage', id] });
      await queryClient.invalidateQueries({ queryKey: ['partner-activity'] });
    },
  });

  const planOptions = [...new Set(clients.map((client) => (client.plan_tier ?? 'free').toLowerCase()))].sort();

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{t('partner.clients')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('partner.clientsDescription')}</p>
          <p className="mt-2 text-sm text-slate-500">
            {clients.length} / {partner?.client_limit ?? '—'}
          </p>
        </div>
        {canManagePartner && (
          <button
            type="button"
            onClick={() => { setNotice(null); setShowAddClient(true); }}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            {t('partner.addClient')}
          </button>
        )}
      </div>

      <div className="mb-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-[minmax(16rem,1fr)_12rem_12rem]">
        <label className="relative block">
          <span className="sr-only">{t('partner.searchClients')}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('partner.searchClients')}
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-700"
          />
        </label>
        <label className="text-sm">
          <span className="sr-only">{t('partner.filterStatus')}</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
            <option value="all">{t('partner.allStatuses')}</option>
            {(['active', 'onboarding', 'suspended', 'archived'] as const).map((value) => (
              <option key={value} value={value}>{t(`partner.${value}`)}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="sr-only">{t('partner.filterPlan')}</span>
          <select value={plan} onChange={(event) => setPlan(event.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2">
            <option value="all">{t('partner.allPlans')}</option>
            {planOptions.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>

      {notice && <p role="status" className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700">{notice}</p>}
      {isLoading ? (
        <p className="text-slate-400">{t('partner.loading')}</p>
      ) : isError ? (
        <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{t('partner.clientLinkFailed')}</p>
      ) : visibleClients.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-sm text-slate-500">
          {t('partner.noClients')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[1180px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-5 py-3">{t('partner.clientName')}</th>
                <th scope="col" className="px-5 py-3">{t('partner.plan')}</th>
                <th scope="col" className="px-5 py-3">{t('partner.users')}</th>
                <th scope="col" className="px-5 py-3">{t('partner.invoices')}</th>
                <th scope="col" className="px-5 py-3">{t('partner.entriesCount')}</th>
                <th scope="col" className="px-5 py-3">{t('partner.transactions')}</th>
                <th scope="col" className="px-5 py-3">{t('partner.onboardedAt')}</th>
                <th scope="col" className="px-5 py-3">{t('partner.lastActivity')}</th>
                <th scope="col" className="px-5 py-3">{t('partner.status')}</th>
                <th scope="col" className="px-5 py-3">{t('partner.clientContext')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleClients.map((client) => (
                <tr key={client.business_id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-900">{client.business_name}</td>
                  <td className="px-5 py-3 capitalize text-slate-600">{client.plan_tier ?? 'free'}</td>
                  <td className="px-5 py-3 text-slate-600">{client.user_count}</td>
                  <td className="px-5 py-3 text-slate-600">{client.invoice_count}</td>
                  <td className="px-5 py-3 text-slate-600">{client.journal_entry_count}</td>
                  <td className="px-5 py-3 text-slate-600">{client.total_activity_count}</td>
                  <td className="px-5 py-3 text-slate-500">{formatDate(client.onboarded_at, i18n.language)}</td>
                  <td className="px-5 py-3 text-slate-500">{formatDate(client.last_activity_at, i18n.language)}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${client.is_active === false || client.status === 'suspended' || client.status === 'archived' ? 'bg-slate-100 text-slate-600' : 'bg-emerald-100 text-emerald-700'}`}>
                        {t(`partner.${client.status}`)}
                      </span>
                      {canManagePartner && (
                        <select
                          aria-label={`${t('partner.status')} — ${client.business_name}`}
                          value={client.status}
                          disabled={updatingStatus}
                          onChange={(event) => changeClientStatus({ businessId: client.business_id, nextStatus: event.target.value as PartnerClientUsage['status'] })}
                          className="rounded border border-slate-200 bg-white px-1.5 py-1 text-xs"
                        >
                          {(['active', 'onboarding', 'suspended', 'archived'] as const).map((value) => (
                            <option key={value} value={value}>{t(`partner.${value}`)}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <button
                      type="button"
                      disabled={switchingClient}
                      onClick={() => { setNotice(null); enterClient(client); }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('partner.viewClient')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAddClient && (
        <AddClientModal
          isPending={addingClient}
          onClose={() => setShowAddClient(false)}
          onSubmit={async (businessId, notes) => {
            if (!UUID_PATTERN.test(businessId)) {
              setNotice(t('partner.requiredBusinessId'));
              return;
            }
            try {
              await addClient({ businessId, notes });
              setNotice(t('partner.clientLinked'));
              setShowAddClient(false);
            } catch {
              setNotice(t('partner.clientLinkFailed'));
            }
          }}
        />
      )}
    </div>
  );
}

function AddClientModal({
  isPending,
  onClose,
  onSubmit,
}: {
  isPending: boolean;
  onClose: () => void;
  onSubmit: (businessId: string, notes: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [businessId, setBusinessId] = useState('');
  const [notes, setNotes] = useState('');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onSubmit(businessId.trim(), notes.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation">
      <form onSubmit={submit} role="dialog" aria-modal="true" aria-labelledby="partner-add-client-title" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <h2 id="partner-add-client-title" className="text-lg font-semibold text-slate-900">{t('partner.addClient')}</h2>
        <p className="mt-2 text-sm text-slate-600">{t('partner.addClientHelp')}</p>
        <label className="mt-5 block text-sm font-medium text-slate-700">
          {t('partner.businessId')}
          <input required value={businessId} onChange={(event) => setBusinessId(event.target.value)} placeholder={t('partner.businessIdPlaceholder')} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
        </label>
        <label className="mt-4 block text-sm font-medium text-slate-700">
          {t('partner.clientNotes')}
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t('partner.clientNotesPlaceholder')} rows={3} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-normal" />
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={isPending} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700">{t('partner.cancel')}</button>
          <button type="submit" disabled={isPending} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {isPending ? t('partner.linkingClient') : t('partner.linkClient')}
          </button>
        </div>
      </form>
    </div>
  );
}

export default PartnerClientsPage;
