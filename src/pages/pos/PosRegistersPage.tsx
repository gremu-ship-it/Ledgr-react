import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Pencil, Plus, Store, X } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/Button';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { repos } from '@/lib/repositories';
import { useAppStore } from '@/store/useAppStore';
import { usePosPermissions } from '@/hooks/usePosPermissions';
import { useUsage } from '@/hooks/useUsage';
import { planMeetsMin } from '@/lib/billing/plans';
import type { PosRegister } from '@/types/pos';

interface RegisterForm {
  name: string;
  code: string;
  branch_id: string;
  preferred_location_id: string;
  default_cash_account_id: string;
  is_active: boolean;
}

function newRegisterForm(): RegisterForm {
  const suffix = globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 8).toUpperCase() ?? 'NEW';
  return { name: '', code: `REG-${suffix}`, branch_id: '', preferred_location_id: '', default_cash_account_id: '', is_active: true };
}

export function PosRegistersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const business = useAppStore((state) => state.currentBusiness?.business);
  const businessId = business?.id ?? '';
  const permissions = usePosPermissions();
  const { planTier } = useUsage();
  const canManageMultipleRegisters = planMeetsMin(planTier, 'growth');
  const [editing, setEditing] = useState<PosRegister | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState<RegisterForm>(newRegisterForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const registersQuery = useQuery({
    queryKey: ['pos-registers', businessId],
    enabled: Boolean(businessId),
    queryFn: () => repos.pos.getRegisters(businessId),
  });
  const branchesQuery = useQuery({
    queryKey: ['pos-register-branches', businessId],
    enabled: Boolean(businessId),
    queryFn: () => repos.branch.findActive(businessId),
  });
  const locationsQuery = useQuery({
    queryKey: ['pos-register-locations', businessId],
    enabled: Boolean(businessId),
    queryFn: () => repos.branch.findLocations(businessId),
  });
  const accountsQuery = useQuery({
    queryKey: ['pos-register-accounts', businessId],
    enabled: Boolean(businessId),
    queryFn: () => repos.account.findByBusiness(businessId),
  });

  const registers = registersQuery.data ?? [];
  const beginCreate = () => {
    setEditing(null);
    setIsCreating(true);
    setForm(newRegisterForm());
    setSaveError('');
  };
  const beginEdit = (register: PosRegister) => {
    setIsCreating(false);
    setEditing(register);
    setForm({
      name: register.name,
      code: register.code,
      branch_id: register.branch_id,
      preferred_location_id: register.preferred_location_id ?? '',
      default_cash_account_id: register.default_cash_account_id ?? '',
      is_active: register.is_active,
    });
    setSaveError('');
  };

  const saveRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!businessId || !form.branch_id) return;
    setSaving(true);
    setSaveError('');
    try {
      const payload = {
        business_id: businessId,
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        branch_id: form.branch_id,
        preferred_location_id: form.preferred_location_id || null,
        default_cash_account_id: form.default_cash_account_id || null,
        is_active: form.is_active,
      };
      if (editing) {
        await repos.pos.updateRegister(businessId, editing.id, {
          name: payload.name,
          code: payload.code,
          branch_id: payload.branch_id,
          preferred_location_id: payload.preferred_location_id,
          default_cash_account_id: payload.default_cash_account_id,
          is_active: payload.is_active,
        });
      } else {
        await repos.pos.createRegister(payload);
      }
      await queryClient.invalidateQueries({ queryKey: ['pos-registers', businessId] });
      await queryClient.invalidateQueries({ queryKey: ['pos-register-active-shift'] });
      setEditing(null);
      setIsCreating(false);
    } catch {
      setSaveError(t('pos.saveRegisterFailed'));
    } finally {
      setSaving(false);
    }
  };

  const loading = registersQuery.isPending || branchesQuery.isPending || locationsQuery.isPending || accountsQuery.isPending;
  const loadError = registersQuery.isError || branchesQuery.isError || locationsQuery.isError || accountsQuery.isError;
  const branches = branchesQuery.data ?? [];
  const locations = locationsQuery.data ?? [];
  const accounts = (accountsQuery.data ?? []).filter((account) => account.is_active && !account.is_group);
  const editable = permissions.isOwnerOrAdmin;
  const canAddRegister = editable && !branchesQuery.isPending && branches.length > 0 && (canManageMultipleRegisters || registers.length === 0);

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Button variant="secondary" size="icon" aria-label={t('pos.backToPointOfSale')} onClick={() => navigate('/pos')}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t('pos.registers')}</h1>
            <p className="mt-1 text-sm text-gray-600">{t('pos.registersDescription')}</p>
          </div>
        </div>
        {canAddRegister && (
          <Button onClick={beginCreate}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('pos.addRegister')}
          </Button>
        )}
      </header>

      {!editable && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{t('pos.registerAdminOnly')}</p>}
      {editable && !canManageMultipleRegisters && registers.length > 0 && <p className="rounded-lg border border-brand-100 bg-brand-50 p-3 text-sm text-brand-800">{t('pos.multiRegisterGrowthRequired')}</p>}
      {loadError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('pos.loadRegistersFailed')}</p>}

      {loading ? <TableSkeleton rows={5} /> : registers.length === 0 ? (
        <section className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <Store className="h-8 w-8 text-brand-600" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-semibold text-gray-900">{t('pos.noRegisters')}</h2>
          <p className="mt-1 max-w-md text-sm text-gray-600">{t('pos.noRegistersDescription')}</p>
          {editable && !branchesQuery.isPending && branches.length === 0 && <p className="mt-3 text-sm text-amber-800">{t('pos.noRegisterBranches')}</p>}
          {canAddRegister && <Button className="mt-4" onClick={beginCreate}><Plus className="h-4 w-4" aria-hidden="true" />{t('pos.addRegister')}</Button>}
        </section>
      ) : (
        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-4 py-3">{t('pos.registerName')}</th>
                  <th scope="col" className="px-4 py-3">{t('pos.registerCode')}</th>
                  <th scope="col" className="px-4 py-3">{t('pos.registerLocation')}</th>
                  <th scope="col" className="px-4 py-3">{t('pos.defaultCashAccount')}</th>
                  <th scope="col" className="px-4 py-3">{t('pos.registerStatus')}</th>
                  {editable && <th scope="col" className="px-4 py-3"><span className="sr-only">{t('pos.registerActions')}</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {registers.map((register) => {
                  const branch = register.branch?.name ?? branches.find((item) => item.id === register.branch_id)?.name;
                  const location = register.location?.name ?? locations.find((item) => item.id === register.preferred_location_id)?.name;
                  const account = register.cash_account?.name ?? accounts.find((item) => item.id === register.default_cash_account_id)?.name;
                  return (
                    <tr key={register.id}>
                      <td className="px-4 py-3 font-medium text-gray-900">{register.name}<span className="ml-2 text-xs text-gray-500">{branch ?? ''}</span></td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-gray-700">{register.code}</td>
                      <td className="px-4 py-3 text-gray-700">{location || t('pos.notSet')}</td>
                      <td className="px-4 py-3 text-gray-700">{account || t('pos.notSet')}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${register.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                          {register.is_active ? t('pos.active') : t('pos.inactive')}
                        </span>
                      </td>
                      {editable && (
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          <Button variant="secondary" size="sm" onClick={() => beginEdit(register)} aria-label={t('pos.editRegisterNamed', { name: register.name })}>
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />{t('common.edit')}
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {(isCreating || editing !== null) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <section role="dialog" aria-modal="true" aria-labelledby="pos-register-dialog-title" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <header className="mb-5 flex items-center justify-between gap-3">
              <h2 id="pos-register-dialog-title" className="text-lg font-bold text-gray-900">{editing ? t('pos.editRegister') : t('pos.addRegister')}</h2>
              <button type="button" aria-label={t('common.close')} onClick={() => { setEditing(null); setIsCreating(false); setSaveError(''); }} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"><X className="h-4 w-4" /></button>
            </header>
            <RegisterEditor
              branches={branches}
              locations={locations}
              accounts={accounts}
              form={form}
              error={saveError}
              saving={saving}
              setForm={setForm}
              onSubmit={saveRegister}
              onCancel={() => { setEditing(null); setIsCreating(false); setSaveError(''); }}
              t={t}
            />
          </section>
        </div>
      )}
    </main>
  );
}

function RegisterEditor({
  branches,
  locations,
  accounts,
  form,
  error,
  saving,
  setForm,
  onSubmit,
  onCancel,
  t,
}: {
  branches: Array<{ id: string; name: string }>;
  locations: Array<{ id: string; name: string; branch_id?: string | null }>;
  accounts: Array<{ id: string; name: string; code: string | null }>;
  form: RegisterForm;
  error: string;
  saving: boolean;
  setForm: (form: RegisterForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  t: (key: string) => string;
}) {
  const visibleLocations = locations.filter((location) => !location.branch_id || !form.branch_id || location.branch_id === form.branch_id);
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <label className="block space-y-1 text-sm font-medium text-gray-700">
        <span>{t('pos.registerName')}</span>
        <input required maxLength={64} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-2" />
      </label>
      <label className="block space-y-1 text-sm font-medium text-gray-700">
        <span>{t('pos.registerCode')}</span>
        <input required maxLength={48} pattern="[A-Za-z0-9_-]+" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono" />
      </label>
      <label className="block space-y-1 text-sm font-medium text-gray-700">
        <span>{t('pos.registerBranch')}</span>
        <select required value={form.branch_id} onChange={(event) => setForm({ ...form, branch_id: event.target.value, preferred_location_id: '' })} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
          <option value="">{t('pos.selectBranch')}</option>
          {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm font-medium text-gray-700">
        <span>{t('pos.registerLocation')}</span>
        <select value={form.preferred_location_id} onChange={(event) => setForm({ ...form, preferred_location_id: event.target.value })} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
          <option value="">{t('pos.noDefaultLocation')}</option>
          {visibleLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-sm font-medium text-gray-700">
        <span>{t('pos.defaultCashAccount')}</span>
        <select value={form.default_cash_account_id} onChange={(event) => setForm({ ...form, default_cash_account_id: event.target.value })} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2">
          <option value="">{t('pos.noDefaultCashAccount')}</option>
          {accounts.map((account) => <option key={account.id} value={account.id}>{account.code ?? ''} · {account.name}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} />
        {t('pos.activeRegister')}
      </label>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      <footer className="flex justify-end gap-2 border-t border-gray-100 pt-4">
        <Button type="button" variant="secondary" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button type="submit" disabled={saving || branches.length === 0}>{saving ? t('pos.savingRegister') : t('common.save')}</Button>
      </footer>
    </form>
  );
}
