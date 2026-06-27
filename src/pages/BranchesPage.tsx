import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2, Plus, MapPin, MoreVertical,
  CheckCircle, XCircle, Pencil, Loader2, AlertCircle,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
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
          {initial ? 'Edit Branch' : 'New Branch'}
        </h2>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Branch Name <span className="text-red-500">*</span>
            </label>
            <input
              value={form.name}
              onChange={set('name')}
              placeholder="e.g. Blantyre Branch"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Branch Code</label>
            <input
              value={form.code}
              onChange={set('code')}
              placeholder="e.g. BLT"
              maxLength={6}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm uppercase focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <p className="mt-1 text-xs text-gray-400">Up to 6 characters. Auto-generated if blank.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Location / Address</label>
            <input
              value={form.location}
              onChange={set('location')}
              placeholder="e.g. Ginnery Corner, Blantyre"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onSubmit(form)}
            disabled={!form.name.trim() || isLoading}
            className="flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {isLoading && <Loader2 size={14} className="animate-spin" />}
            {initial ? 'Save Changes' : 'Create Branch'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function BranchesPage() {
  const businessId  = useAppStore((s) => s.currentBusiness?.business.id);
  const queryClient = useQueryClient();

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

  if (!businessId) return null;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Branches</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your selling points and stock locations
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-600"
        >
          <Plus size={16} />
          New Branch
        </button>
      </div>

      {/* Warehouse banner */}
      <div className="mb-4 rounded-2xl border border-brand-100 bg-brand-50 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500">
            <Building2 size={18} className="text-white" />
          </div>
          <div>
            <p className="text-sm font-semibold text-brand-800">Main Warehouse</p>
            <p className="text-xs text-brand-600">Central stock location · Default receiving point</p>
          </div>
          <span className="ml-auto rounded-full bg-brand-100 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
            Warehouse
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
          <p className="text-sm text-red-600">Failed to load branches.</p>
        </div>
      ) : branches?.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-200 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-50">
            <Building2 size={22} className="text-gray-300" />
          </div>
          <p className="text-sm font-medium text-gray-500">No branches yet</p>
          <p className="text-xs text-gray-400">
            Create a branch to start dispatching stock from the warehouse
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="mt-1 flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600"
          >
            <Plus size={13} /> New Branch
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
                        <Pencil size={13} /> Edit
                      </button>
                      <button
                        onClick={() => {
                          deactivateMutation.mutate(branch.id);
                          setMenuOpen(null);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                      >
                        <XCircle size={13} /> Deactivate
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
                    {branch.code && <p className="text-xs text-gray-400">{branch.code}</p>}
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
                      Stock location: {loc.name}
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
                    {branch.is_active ? 'Active' : 'Inactive'}
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
