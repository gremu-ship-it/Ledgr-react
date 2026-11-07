import { useMemo } from 'react';
import { useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { partnerPortalRepository } from '@/dal/repositories/PartnerPortalRepository';
import { useAppStore } from '@/store/useAppStore';
import { usePartnerAdminAccess } from '@/hooks/usePartnerAdminAccess';

export function PartnerStaffPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const currentUser = useAppStore((state) => state.currentUser);
  const { isPlatformAdmin } = usePartnerAdminAccess();

  const { data: role } = useQuery({
    queryKey: ['partner-staff-role', id, currentUser?.id],
    queryFn: () => partnerPortalRepository.getCurrentStaffRole(id, currentUser!.id),
    enabled: Boolean(id && currentUser?.id),
  });
  const canManage = isPlatformAdmin || role === 'admin';
  const { data: staff = [], isLoading: staffLoading, isError: staffError } = useQuery({
    queryKey: ['partner-staff', id],
    queryFn: () => partnerPortalRepository.getPartnerStaff(id),
    enabled: Boolean(id && canManage),
  });
  const { data: clients = [], isLoading: clientsLoading, isError: clientsError } = useQuery({
    queryKey: ['partner-usage', id],
    queryFn: () => partnerPortalRepository.getPartnerClients(id),
    enabled: Boolean(id),
  });
  const { data: assignments = [], isLoading: assignmentsLoading, isError: assignmentsError } = useQuery({
    queryKey: ['partner-assignments', id],
    queryFn: () => partnerPortalRepository.getPartnerAssignments(id),
    enabled: Boolean(id),
  });
  const assigned = useMemo(() => new Set(assignments.map((entry) => `${entry.staff_user_id}:${entry.business_id}`)), [assignments]);
  const visibleStaff = canManage
    ? staff
    : currentUser
      ? [{
          user_id: currentUser.id,
          email: currentUser.email ?? '',
          name: currentUser.profile?.full_name ?? '',
          role: 'viewer' as const,
          created_at: '',
        }]
      : [];

  const { mutate: setAssignment, isPending } = useMutation({
    mutationFn: ({ businessId, staffUserId, enabled }: { businessId: string; staffUserId: string; enabled: boolean }) =>
      partnerPortalRepository.setClientAssignment(id, businessId, staffUserId, enabled),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['partner-assignments', id] }),
  });

  if (staffLoading || clientsLoading || assignmentsLoading) {
    return <p className="text-sm text-slate-500">{t('partner.loading')}</p>;
  }
  if (staffError || clientsError || assignmentsError) {
    return <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{t('partner.assignmentLoadFailed')}</p>;
  }

  return (
    <section>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">{t('partner.staffPortfolios')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('partner.staffPortfoliosDescription')}</p>
      </div>
      {visibleStaff.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">{t('partner.noStaff')}</div>
      ) : (
        <div className="space-y-4">
          {visibleStaff.map((member) => {
            const portfolio = clients.filter((client) => assigned.has(`${member.user_id}:${client.business_id}`));
            return (
              <article key={member.user_id} className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-slate-900">{member.name || member.email}</h2>
                    <p className="text-sm text-slate-500">{member.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium capitalize text-slate-600">{t(`partner.${member.role}`)}</span>
                    <span className="text-xs text-slate-500">{t('partner.assignedClientCount', { count: portfolio.length })}</span>
                  </div>
                </div>
                <fieldset disabled={!canManage || isPending}>
                  <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('partner.assignedClients')}</legend>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {clients.map((client) => {
                      const checked = assigned.has(`${member.user_id}:${client.business_id}`);
                      return (
                        <label key={client.business_id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${checked ? 'border-emerald-200 bg-emerald-50 text-slate-800' : 'border-slate-200 text-slate-600'} ${!canManage ? 'cursor-default' : 'cursor-pointer'}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => setAssignment({ businessId: client.business_id, staffUserId: member.user_id, enabled: event.currentTarget.checked })}
                            className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                          />
                          <span className="truncate">{client.business_name}</span>
                        </label>
                      );
                    })}
                    {clients.length === 0 && <p className="text-sm text-slate-400">{t('partner.noClients')}</p>}
                  </div>
                </fieldset>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default PartnerStaffPage;
