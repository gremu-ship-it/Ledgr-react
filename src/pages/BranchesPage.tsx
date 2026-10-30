import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Plus, MapPin, MoreVertical,
  CheckCircle, XCircle, Pencil, Loader2, AlertCircle,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useBusinessProfile } from '@/hooks/useBusinessProfile';
import { useOrganisationCapabilityVisibility } from '@/hooks/useCapability';
import { sitesVocabularyReplacesBranches } from '@/components/layout/navConfig';
import { repos } from '@/lib/repositories';
import type { Row } from '@/dal/types/database';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BranchFormData {
  name: string;
  code: string;
  location: string;
}

const EMPTY_FORM: BranchFormData = { name: '', code: '', location: '' };

// ── Modal ─────────────────────────────────────────────────────────────────────

function BranchModal({
  open,
  initial,
  onClose,
  onSubmit,
  isLoading,
}: {
  open: boolean;
  initial?: BranchFormData;
  onClose: () => void;
  onSubmit: (data: BranchFormData) => void;
  isLoading: boolean;
}) {
  const { t } = useTranslation();
  const [form, setForm] = useState<BranchFormData>(initial ?? EMPTY_FORM);

  if (!open) return null;

  const set =
    (field: keyof BranchFormData) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          {initial ? t('pages.branches.editTitle') : t('pages.branches.newTitle')}
        </h2>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              {t('pages.branches.name')} <span className="text-red-500">*</span>
            </label>
            <input
              value={form.name}
              onChange={set('name')}
              placeholder={t('pages.branches.namePlaceholder')}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">{t('pages.branches.code')}</label>
            <input
              value={form.code}
              onChange={set('code')}
              placeholder={t('pages.branches.codePlaceholder')}
              maxLength={6}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm uppercase focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <p className="mt-1 text-xs text-gray-600">{t('pages.branches.codeHelp')}</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">{t('pages.branches.location')}</label>
            <input
              value={form.location}
              onChange={set('location')}
              placeholder={t('pages.branches.locationPlaceholder')}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={() => onSubmit(form)}
            disabled={!form.name.trim() || isLoading}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {isLoading && <Loader2 size={14} className="animate-spin" />}
            {initial ? t('common.save') : t('pages.branches.create')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function BranchesPage() {
  const { t } = useTranslation();
  const businessId  = useAppStore((s) => s.currentBusiness?.business.id);
  const queryClient = useQueryClient();
  const isOrgCapabilityEnabled = useOrganisationCapabilityVisibility();
  const { profile } = useBusinessProfile();

  const [modalOpen,   setModalOpen]   = useState(false);
  const [editTarget,  setEditTarget]  = useState<{ id: string; data: BranchFormData } | null>(null);
  const [menuOpen,    setMenuOpen]    = useState<string | null>(null);

  const { data: branches, isLoading, isError } = useQuery({
    queryKey: ['branches', businessId],
    queryFn: () => repos.branch.findByBusiness(businessId!),
    enabled: Boolean(businessId),
  });

  const { data: locations } = useQuery({
    queryKey: ['locations', businessId],
    queryFn: () => repos.branch.findLocations(businessId!),
    enabled: Boolean(businessId),
  });

  const createMutation = useMutation({
    mutationFn: (form: BranchFormData) =>
      repos.branch.createWithLocation({
        business_id: businessId!,
        name: form.name.trim(),
        code: form.code.trim().toUpperCase() || form.name.slice(0, 6).toUpperCase(),
        location: form.location.trim() || null,
        is_active: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches', businessId] });
      queryClient.invalidateQueries({ queryKey: ['locations', businessId] });
      setModalOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, form }: { id: string; form: BranchFormData }) =>
      repos.branch.updateBranch(id, {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase() || undefined,
        location: form.location.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches', businessId] });
      queryClient.invalidateQueries({ queryKey: ['locations', businessId] });
      setEditTarget(null);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => repos.branch.deactivateBranch(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches', businessId] });
      queryClient.invalidateQueries({ queryKey: ['locations', businessId] });
    },
  });

  // Map location by branch_id for the card display
  const locationByBranch = new Map<string, Row<'inventory_locations'>>(
    (locations ?? [])
      .filter((l): l is Row<'inventory_locations'> & { branch_id: string } =>
        l.branch_id != null,
      )
      .map((l) => [l.branch_id, l]),
  );

  // Sites vocabulary: a pure construction/manufacturing business has no
  // Branches surface (absent, not locked) — its branch-mirror locations
  // ("Main Site", "Main Factory") are managed under Organisation → Sites,
  // where the mirror-guarded name sync keeps both sides in step. Direct URL
  // access follows the navigation and redirects.
  if (sitesVocabularyReplacesBranches(isOrgCapabilityEnabled, profile?.operating_models)) {
    return <Navigate to="/locations" replace />;
  }

  if (!businessId) return null;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">{t('pages.branches.title')}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {t('pages.branches.description')}
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-600"
        >
          <Plus size={16} />
          {t('pages.branches.create')}
        </button>
      </div>

      {/* Warehouse banner */}
      <div className="mb-4 rounded-2xl border border-brand-100 bg-brand-50 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500">
            <Building2 size={18} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-brand-800">{t('pages.branches.primaryWarehouse')}</p>
            <p className="text-xs text-brand-600">{t('pages.branches.primaryWarehouseDescription')}</p>
          </div>
          <span className="ml-auto rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
            {t('pages.branches.warehouse')}
          </span>
        </div>
      </div>

      {/* Branch list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-gray-100" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex items-center gap-3 rounded-2xl border border-red-100 bg-red-50 p-5">
          <AlertCircle size={18} className="text-red-500" />
          <p className="text-sm text-red-600">{t('pages.branches.loadError')}</p>
        </div>
      ) : branches?.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-200 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-50">
            <Building2 size={22} className="text-gray-300" />
          </div>
          <p className="text-sm font-medium text-gray-500">{t('pages.branches.emptyTitle')}</p>
          <p className="text-xs text-gray-600">
            {t('pages.branches.emptyDescription')}
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="mt-1 flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600"
          >
            <Plus size={13} /> {t('pages.branches.create')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {branches?.map((branch) => {
            const loc = locationByBranch.get(branch.id);
            return (
              <div
                key={branch.id}
                className="relative rounded-2xl border border-gray-200 bg-white p-5 shadow-soft"
              >
                {/* Menu */}
                <div className="absolute right-3 top-3">
                  <button
                    aria-label={t('pages.branches.moreActions', { name: branch.name })}
                    onClick={() => setMenuOpen(menuOpen === branch.id ? null : branch.id)}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600"
                  >
                    <MoreVertical size={15} />
                  </button>
                  {menuOpen === branch.id && (
                    <div className="absolute right-0 top-8 z-10 w-40 rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
                      <button
                        onClick={() => {
                          setEditTarget({
                            id: branch.id,
                            data: {
                              name: branch.name,
                              code: branch.code ?? '',
                              location: branch.location ?? '',
                            },
                          });
                          setMenuOpen(null);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <Pencil size={13} /> {t('common.edit')}
                      </button>
                      <button
                        onClick={() => {
                          deactivateMutation.mutate(branch.id);
                          setMenuOpen(null);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                      >
                        <XCircle size={13} /> {t('pages.branches.deactivate')}
                      </button>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-50">
                    <Building2 size={16} className="text-gray-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{branch.name}</p>
                    {branch.code && <p className="text-xs text-gray-600">{branch.code}</p>}
                  </div>
                </div>

                <div className="space-y-1.5">
                  {branch.location && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <MapPin size={12} className="text-gray-300" />
                      {branch.location}
                    </div>
                  )}
                  {loc && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <CheckCircle size={12} className="text-brand-400" />
                      {t('pages.branches.stockLocation', { name: loc.name })}
                    </div>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-gray-50 pt-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      branch.is_active
                        ? 'bg-emerald-50 text-brand-600'
                        : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {branch.is_active ? t('common.active') : t('common.inactive')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create modal */}
      <BranchModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={(form) => createMutation.mutate(form)}
        isLoading={createMutation.isPending}
      />

      {/* Edit modal */}
      <BranchModal
        open={Boolean(editTarget)}
        initial={editTarget?.data}
        onClose={() => setEditTarget(null)}
        onSubmit={(form) =>
          editTarget && updateMutation.mutate({ id: editTarget.id, form })
        }
        isLoading={updateMutation.isPending}
      />
    </div>
  );
}
