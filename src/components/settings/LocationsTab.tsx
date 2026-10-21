import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  Lock,
  MapPin,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import { repos } from '@/lib/repositories';
import { supabase } from '@/lib/supabase';
import { useBusinessProfile } from '@/hooks/useBusinessProfile';
import { useLocationTypes, type LocationType } from '@/hooks/useLocationTypes';
import { usePermissions } from '@/hooks/usePermissions';
import { useUsage } from '@/hooks/useUsage';
import { planMeetsMin } from '@/components/layout/navConfig';
import type { Row } from '@/dal/types/database';
import type {
  DeactivateBlockCode,
  DeactivateCheckResult,
  LocationWithBranch,
} from '@/dal/repositories/LocationRepository';

/**
 * Settings → Locations (P2-1): the master-data CRUD for inventory_locations
 * that the construction org audit found missing. Before this tab, locations
 * could only be born as side effects (branch pairing, provisioning RPCs,
 * project-site linking) and the Warehouse page pointed users at a tab that
 * did not exist.
 *
 * Authority: every write goes through LocationRepository under the EXISTING
 * role-aware RLS tier — member read, writer insert/update, admin delete. No
 * new policy, no new RPC, no deletes (deactivation only, guarded by the four
 * safety checks in the repository).
 *
 * Vertical isolation is absence, not locks: the type picker offers
 * construction values only to CONSTRUCTION businesses and manufacturing
 * values only to MANUFACTURING businesses (useLocationTypes); the Linked
 * project column renders only when construction is enabled or project links
 * actually exist. Plan gating matches Branches/Contacts/Departments: below
 * Growth the tab shows the upgrade prompt instead of the manager.
 */

const k = 'settings.locations';

const INPUT_CLASS =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

const REASON_KEYS: Record<DeactivateBlockCode, string> = {
  stock_on_hand: `${k}.deactivateBlockedStock`,
  open_work_orders: `${k}.deactivateBlockedWorkOrder`,
  active_procurement_site: `${k}.deactivateBlockedSite`,
  last_default: `${k}.deactivateBlockedLastDefault`,
};

interface ProjectName {
  id: string;
  name: string;
}

// Tables outside the generated Database types (construction_projects), read
// for the Linked-project column — the same loose-cast idiom the manufacturing
// pages and ProjectRepository use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loose = supabase as unknown as { from: (table: string) => any };

export function LocationsTab({ businessId }: { businessId: string }) {
  const { t } = useTranslation();
  const { planTier } = useUsage();

  // Plan gate: same minimum as Branches/Contacts/Departments (growth). The
  // tab stays visible in the settings nav; the CONTENT becomes the upsell,
  // matching the PlanGate 'lock' pattern used by the API & Webhooks tab.
  if (!planMeetsMin(planTier, 'growth')) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            <Lock className="h-6 w-6" aria-hidden />
          </div>
          <h2 className="text-lg font-semibold text-gray-900">{t(`${k}.upgradeTitle`)}</h2>
          <p className="mt-2 text-sm text-gray-500">{t(`${k}.upgradeText`)}</p>
          <Link
            to="/settings?tab=billing"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            {t(`${k}.viewPlans`)}
          </Link>
        </div>
      </div>
    );
  }

  return <LocationsManager businessId={businessId} />;
}

// ── Manager (below the plan gate) ────────────────────────────────────────────

type FormTarget =
  | { mode: 'create' }
  | { mode: 'edit'; location: LocationWithBranch }
  | null;

interface Alert {
  type: 'success' | 'error';
  message: string;
}

function LocationsManager({ businessId }: { businessId: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { canWrite } = usePermissions();
  const { profile } = useBusinessProfile();
  const operatingModels = useMemo(
    () => profile?.operating_models ?? [],
    [profile?.operating_models],
  );
  const hasConstruction = operatingModels.includes('CONSTRUCTION');

  const [alert, setAlert] = useState<Alert | null>(null);
  const [formTarget, setFormTarget] = useState<FormTarget>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<LocationWithBranch | null>(null);
  const [defaultTarget, setDefaultTarget] = useState<LocationWithBranch | null>(null);

  const locationsQuery = useQuery({
    queryKey: ['settings', 'locations', businessId],
    queryFn: () => repos.location.getAll(businessId),
  });

  const branchesQuery = useQuery({
    queryKey: ['branches', businessId],
    queryFn: () => repos.branch.findByBusiness(businessId),
  });

  const locations = locationsQuery.data ?? [];
  const hasProjectLinks = locations.some((location) => location.project_id != null);

  // Construction project names for the Linked-project column. Fetched only
  // when the column can show anything: a construction business, or legacy
  // project links that outlived the operating model.
  const projectsQuery = useQuery({
    queryKey: ['construction', 'project-names', businessId],
    queryFn: async () => {
      const { data, error } = await loose
        .from('construction_projects')
        .select('id, name')
        .eq('business_id', businessId)
        .order('name');
      if (error) throw new Error(error.message as string);
      return (data ?? []) as ProjectName[];
    },
    enabled: hasConstruction || hasProjectLinks,
  });

  const showProjectColumn = hasConstruction || hasProjectLinks;
  const projectById = useMemo(
    () => new Map((projectsQuery.data ?? []).map((project) => [project.id, project.name])),
    [projectsQuery.data],
  );
  const branchById = useMemo(
    () => new Map((branchesQuery.data ?? []).map((branch) => [branch.id, branch])),
    [branchesQuery.data],
  );
  const currentDefault = locations.find((location) => location.is_default) ?? null;

  const invalidate = () => {
    // This tab's list, every stock picker's active-locations cache, and the
    // branches list (the mirror name sync can rename a branch).
    void queryClient.invalidateQueries({ queryKey: ['settings', 'locations', businessId] });
    void queryClient.invalidateQueries({ queryKey: ['locations', businessId] });
    void queryClient.invalidateQueries({ queryKey: ['branches', businessId] });
  };

  const setDefaultMutation = useMutation({
    mutationFn: (locationId: string) => repos.location.setDefault(businessId, locationId),
    onSuccess: () => {
      setDefaultTarget(null);
      setAlert({ type: 'success', message: t(`${k}.defaultSet`) });
      invalidate();
    },
    onError: (error: Error) => setAlert({ type: 'error', message: error.message }),
  });

  const reactivateMutation = useMutation({
    mutationFn: (locationId: string) => repos.location.reactivate(businessId, locationId),
    onSuccess: () => {
      setAlert({ type: 'success', message: t(`${k}.reactivated`) });
      invalidate();
    },
    onError: (error: Error) => setAlert({ type: 'error', message: error.message }),
  });

  /** Row action: set as default — confirms first when replacing an existing default. */
  function requestSetDefault(location: LocationWithBranch) {
    if (currentDefault && currentDefault.id !== location.id) {
      setDefaultTarget(location);
      return;
    }
    setDefaultMutation.mutate(location.id);
  }

  if (locationsQuery.isLoading) {
    return (
      <div className="space-y-3" data-testid="locations-loading">
        {[0, 1, 2].map((row) => (
          <div key={row} className="h-10 animate-pulse rounded-lg bg-gray-100" />
        ))}
      </div>
    );
  }

  if (locationsQuery.isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        <p>{t(`${k}.loadError`)}</p>
        <button
          type="button"
          onClick={() => locationsQuery.refetch()}
          className="mt-2 text-sm font-semibold underline"
        >
          {t('common.retry')}
        </button>
      </div>
    );
  }

  return (
    <div data-testid="locations-tab">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">{t(`${k}.title`)}</h2>
          <p className="mt-1 text-sm text-gray-500">{t(`${k}.description`)}</p>
        </div>
        {canWrite ? (
          <button
            type="button"
            data-testid="add-location"
            onClick={() => setFormTarget({ mode: 'create' })}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600"
          >
            <Plus className="h-4 w-4" aria-hidden />
            {t(`${k}.addLocation`)}
          </button>
        ) : null}
      </div>

      {alert ? (
        <div
          role="status"
          className={
            alert.type === 'success'
              ? 'mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700'
              : 'mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700'
          }
        >
          {alert.message}
        </div>
      ) : null}

      {locations.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 px-6 py-12 text-center">
          <MapPin className="mx-auto mb-3 h-8 w-8 text-gray-300" aria-hidden />
          <p className="text-sm text-gray-500">{t(`${k}.noLocations`)}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm" data-testid="locations-table">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">{t(`${k}.name`)}</th>
                <th className="px-3 py-2">{t(`${k}.code`)}</th>
                <th className="px-3 py-2">{t(`${k}.locationType`)}</th>
                <th className="px-3 py-2">{t(`${k}.branch`)}</th>
                <th className="px-3 py-2">{t(`${k}.isDefault`)}</th>
                <th className="px-3 py-2">{t(`${k}.isActive`)}</th>
                {showProjectColumn ? <th className="px-3 py-2">{t(`${k}.project`)}</th> : null}
                {canWrite ? <th className="px-3 py-2 text-right">{t('common.actions')}</th> : null}
              </tr>
            </thead>
            <tbody>
              {locations.map((location) => {
                const branchName =
                  location.branches?.name ??
                  (location.branch_id ? branchById.get(location.branch_id)?.name : null) ??
                  null;
                const projectName = location.project_id
                  ? projectById.get(location.project_id) ?? null
                  : null;
                return (
                  <tr
                    key={location.id}
                    data-testid={`location-row-${location.id}`}
                    className={
                      location.is_active
                        ? 'border-b border-gray-100'
                        : 'border-b border-gray-100 bg-gray-50 opacity-60'
                    }
                  >
                    <td className="px-3 py-2.5 font-medium text-gray-900">{location.name}</td>
                    <td className="px-3 py-2.5 font-mono text-xs text-gray-600">
                      {location.code ?? '—'}
                    </td>
                    <td className="px-3 py-2.5 text-gray-700">
                      <TypeLabel type={location.location_type} />
                    </td>
                    <td className="px-3 py-2.5 text-gray-700">{branchName ?? '—'}</td>
                    <td className="px-3 py-2.5">
                      {location.is_default ? (
                        <span
                          className="inline-flex items-center gap-1 text-amber-600"
                          title={t(`${k}.isDefault`)}
                        >
                          <Star className="h-4 w-4 fill-current" aria-hidden />
                          <span className="sr-only">{t(`${k}.isDefault`)}</span>
                        </span>
                      ) : (
                        <span aria-hidden className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={
                          location.is_active
                            ? 'inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700'
                            : 'inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600'
                        }
                      >
                        {location.is_active ? t(`${k}.active`) : t(`${k}.inactive`)}
                      </span>
                    </td>
                    {showProjectColumn ? (
                      <td className="px-3 py-2.5 text-gray-700">
                        {location.project_id && projectName ? (
                          hasConstruction ? (
                            <Link
                              to={`/construction/projects/${location.project_id}`}
                              className="font-medium text-brand-600 hover:underline"
                            >
                              {projectName}
                            </Link>
                          ) : (
                            projectName
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                    ) : null}
                    {canWrite ? (
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            data-testid={`location-edit-${location.id}`}
                            title={t('common.edit')}
                            aria-label={t('common.edit')}
                            onClick={() => setFormTarget({ mode: 'edit', location })}
                            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                          >
                            <Pencil className="h-4 w-4" aria-hidden />
                          </button>
                          {location.is_active && !location.is_default ? (
                            <button
                              type="button"
                              data-testid={`location-set-default-${location.id}`}
                              title={t(`${k}.setAsDefault`)}
                              aria-label={t(`${k}.setAsDefault`)}
                              onClick={() => requestSetDefault(location)}
                              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-amber-600"
                            >
                              <Star className="h-4 w-4" aria-hidden />
                            </button>
                          ) : null}
                          {location.is_active ? (
                            <button
                              type="button"
                              data-testid={`location-deactivate-${location.id}`}
                              title={t(`${k}.deactivate`)}
                              aria-label={t(`${k}.deactivate`)}
                              onClick={() => setDeactivateTarget(location)}
                              className="rounded-lg p-1.5 text-gray-500 hover:bg-red-50 hover:text-red-600"
                            >
                              <PowerOff className="h-4 w-4" aria-hidden />
                            </button>
                          ) : (
                            <button
                              type="button"
                              data-testid={`location-reactivate-${location.id}`}
                              title={t(`${k}.reactivate`)}
                              aria-label={t(`${k}.reactivate`)}
                              onClick={() => reactivateMutation.mutate(location.id)}
                              className="rounded-lg p-1.5 text-gray-500 hover:bg-emerald-50 hover:text-emerald-600"
                            >
                              <Power className="h-4 w-4" aria-hidden />
                            </button>
                          )}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {formTarget ? (
        <LocationFormModal
          businessId={businessId}
          target={formTarget}
          branches={branchesQuery.data ?? []}
          currentDefault={currentDefault}
          onClose={() => setFormTarget(null)}
          onDone={(message) => {
            setAlert({ type: 'success', message });
            setFormTarget(null);
            invalidate();
          }}
          onError={(message) => setAlert({ type: 'error', message })}
        />
      ) : null}

      {deactivateTarget ? (
        <DeactivateDialog
          businessId={businessId}
          location={deactivateTarget}
          onClose={() => setDeactivateTarget(null)}
          onDone={(message) => {
            setAlert({ type: 'success', message });
            setDeactivateTarget(null);
            invalidate();
          }}
          onError={(message) => setAlert({ type: 'error', message })}
        />
      ) : null}

      {defaultTarget ? (
        <ConfirmDialog
          title={t(`${k}.confirmDefault`)}
          description={t(`${k}.confirmDefaultDesc`, {
            currentDefault: currentDefault?.name ?? '—',
          })}
          confirmLabel={t('common.confirm')}
          pending={setDefaultMutation.isPending}
          onConfirm={() => setDefaultMutation.mutate(defaultTarget.id)}
          onCancel={() => setDefaultTarget(null)}
        />
      ) : null}
    </div>
  );
}

// ── Type label ───────────────────────────────────────────────────────────────

function TypeLabel({ type }: { type: string }) {
  const { t } = useTranslation();
  const key = `manufacturing.locationType.${type}`;
  const label = t(key);
  // Untranslated legacy value: show the raw stored type rather than a key path.
  return <>{label === key ? type : label}</>;
}

// ── Create / edit modal ──────────────────────────────────────────────────────

interface LocationFormValues {
  name: string;
  code: string;
  location_type: string;
  branch_id: string;
  is_default: boolean;
}

function LocationFormModal({
  businessId,
  target,
  branches,
  currentDefault,
  onClose,
  onDone,
  onError,
}: {
  businessId: string;
  target: NonNullable<FormTarget>;
  branches: Row<'branches'>[];
  currentDefault: LocationWithBranch | null;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const typeOptions = useLocationTypes();
  const editing = target.mode === 'edit' ? target.location : null;

  const [form, setForm] = useState<LocationFormValues>({
    name: editing?.name ?? '',
    code: editing?.code ?? '',
    location_type: editing?.location_type ?? 'warehouse',
    branch_id: editing?.branch_id ?? '',
    is_default: editing?.is_default ?? false,
  });
  // Checking "default" while another location holds the flag requires an
  // explicit confirmation before the mutation runs (P2-1 spec).
  const [pendingDefaultConfirm, setPendingDefaultConfirm] = useState(false);
  const set = <K extends keyof LocationFormValues>(key: K, value: LocationFormValues[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  // Vertical isolation with legacy tolerance: the filtered options plus, when
  // editing, the row's CURRENT type — a store keeps its type selectable after
  // its operating model was removed ("removing the model revokes nothing").
  const options = useMemo(() => {
    const merged = [...typeOptions];
    if (editing && !merged.some((option) => option.value === editing.location_type)) {
      merged.push({
        value: editing.location_type as LocationType,
        labelKey: `manufacturing.locationType.${editing.location_type}`,
      });
    }
    return merged;
  }, [typeOptions, editing]);

  // Same tolerance for the branch picker: an inactive paired branch stays
  // selectable so the row never loses its link silently.
  const branchOptions = useMemo(() => {
    const active = branches.filter((branch) => branch.is_active);
    if (editing?.branch_id && !active.some((branch) => branch.id === editing.branch_id)) {
      const paired = branches.find((branch) => branch.id === editing.branch_id);
      if (paired) active.push(paired);
    }
    return active;
  }, [branches, editing]);

  const mutation = useMutation({
    mutationFn: async () => {
      const name = form.name.trim();
      if (!name) throw new Error(t(`${k}.name`));
      if (editing) {
        return repos.location.updateLocation(businessId, editing.id, {
          name,
          code: form.code.trim() || null,
          branch_id: form.branch_id || null,
          location_type: form.location_type,
          is_default: form.is_default,
        });
      }
      return repos.location.create({
        business_id: businessId,
        name,
        // Mirrors the branch-pairing convention: first six characters, upper.
        code: form.code.trim() || name.slice(0, 6).toUpperCase(),
        branch_id: form.branch_id || null,
        location_type: form.location_type,
        is_default: form.is_default,
      });
    },
    onSuccess: () => {
      onDone(editing ? t(`${k}.updated`) : t(`${k}.created`));
    },
    onError: (error: Error) => onError(error.message),
  });

  function toggleDefault(next: boolean) {
    if (next && !editing?.is_default && currentDefault && currentDefault.id !== editing?.id) {
      // Ask before stealing the flag from the current default.
      setPendingDefaultConfirm(true);
      return;
    }
    set('is_default', next);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid="location-form-modal"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">
            {editing ? t(`${k}.editLocation`) : t(`${k}.addLocation`)}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label={t('common.close')}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          className="space-y-4 px-6 py-5"
          onSubmit={(event) => {
            event.preventDefault();
            mutation.mutate();
          }}
        >
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="location-name">
              {t(`${k}.name`)} *
            </label>
            <input
              id="location-name"
              data-testid="location-form-name"
              type="text"
              value={form.name}
              onChange={(event) => set('name', event.target.value)}
              className={INPUT_CLASS}
              required
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="location-code">
              {t(`${k}.code`)}
            </label>
            <input
              id="location-code"
              data-testid="location-form-code"
              type="text"
              value={form.code}
              onChange={(event) => set('code', event.target.value.toUpperCase())}
              className={INPUT_CLASS}
            />
            <p className="mt-1 text-xs text-gray-500">{t(`${k}.codeHint`)}</p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="location-type">
              {t(`${k}.locationType`)}
            </label>
            <select
              id="location-type"
              data-testid="location-form-type"
              value={form.location_type}
              onChange={(event) => set('location_type', event.target.value)}
              className={INPUT_CLASS}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700" htmlFor="location-branch">
              {t(`${k}.branch`)}
            </label>
            <select
              id="location-branch"
              data-testid="location-form-branch"
              value={form.branch_id}
              onChange={(event) => set('branch_id', event.target.value)}
              className={INPUT_CLASS}
            >
              <option value="">{t(`${k}.noBranch`)}</option>
              {branchOptions.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-start gap-2">
            <input
              id="location-default"
              data-testid="location-form-default"
              type="checkbox"
              checked={form.is_default}
              onChange={(event) => toggleDefault(event.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
            />
            <div>
              <label htmlFor="location-default" className="text-sm font-medium text-gray-700">
                {t(`${k}.isDefault`)}
              </label>
              <p className="text-xs text-gray-500">{t(`${k}.isDefaultHint`)}</p>
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              data-testid="location-form-save"
              disabled={mutation.isPending || !form.name.trim()}
              className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
            >
              {mutation.isPending ? t(`${k}.saving`) : t('common.save')}
            </button>
          </div>
        </form>
      </div>

      {pendingDefaultConfirm ? (
        <ConfirmDialog
          title={t(`${k}.confirmDefault`)}
          description={t(`${k}.confirmDefaultDesc`, { currentDefault: currentDefault?.name ?? '—' })}
          confirmLabel={t('common.confirm')}
          onConfirm={() => {
            setPendingDefaultConfirm(false);
            set('is_default', true);
          }}
          onCancel={() => setPendingDefaultConfirm(false)}
        />
      ) : null}
    </div>
  );
}

// ── Deactivation dialog (checks first, then confirmation) ───────────────────

function DeactivateDialog({
  businessId,
  location,
  onClose,
  onDone,
  onError,
}: {
  businessId: string;
  location: LocationWithBranch;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { t } = useTranslation();

  // The safety checks run BEFORE the confirmation is offered: a blocked
  // location gets the reasons, never a confirm button.
  const checkQuery = useQuery({
    queryKey: ['settings', 'locations', 'deactivate-check', businessId, location.id],
    queryFn: () => repos.location.canDeactivate(businessId, location.id),
  });

  const deactivateMutation = useMutation({
    mutationFn: () => repos.location.deactivate(businessId, location.id),
    onSuccess: (result) => {
      if (result.deactivated) {
        onDone(t(`${k}.deactivated`));
        return;
      }
      // Lost a race between the pre-check and the write: surface the reasons.
      checkQuery.refetch();
      onError(t(`${k}.deactivateBlocked`));
    },
    onError: (error: Error) => onError(error.message),
  });

  const check: DeactivateCheckResult | undefined = checkQuery.data;
  const blocked = check !== undefined && !check.ok;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      data-testid="deactivate-dialog"
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">
            {blocked ? t(`${k}.deactivateBlocked`) : t(`${k}.confirmDeactivate`)}
          </h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label={t('common.close')}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5">
          {checkQuery.isLoading ? (
            <p className="text-sm text-gray-500" data-testid="deactivate-check-loading">
              {t('common.loading')}
            </p>
          ) : blocked ? (
            <ul className="space-y-2" data-testid="deactivate-blocked">
              {(check?.reasons ?? []).map((reason) => (
                <li
                  key={reason.code}
                  className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800"
                >
                  {t(REASON_KEYS[reason.code], { count: reason.count ?? 0 })}
                </li>
              ))}
            </ul>
          ) : (
            <div>
              <p className="text-sm font-medium text-gray-900">{location.name}</p>
              <p className="mt-1 text-sm text-gray-500">{t(`${k}.confirmDeactivateDesc`)}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            {blocked ? t('common.close') : t('common.cancel')}
          </button>
          {blocked ? null : (
            <button
              type="button"
              data-testid="deactivate-confirm"
              onClick={() => deactivateMutation.mutate()}
              disabled={deactivateMutation.isPending || checkQuery.isLoading}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-60"
            >
              {deactivateMutation.isPending ? t(`${k}.saving`) : t(`${k}.deactivate`)}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Shared confirm dialog ────────────────────────────────────────────────────

function ConfirmDialog({
  title,
  description,
  confirmLabel,
  pending = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      data-testid="confirm-dialog"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-xl">
        <div className="px-6 py-5">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <p className="mt-1 text-sm text-gray-500">{description}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-gray-100 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            data-testid="confirm-dialog-confirm"
            onClick={onConfirm}
            disabled={pending}
            className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:opacity-60"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
