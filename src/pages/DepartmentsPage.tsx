import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Users2, Plus, MoreVertical,
  XCircle, Pencil, Loader2, AlertCircle,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import type { Row } from '@/dal/types/database';

// ── Types ─────────────────────────────────────────────────────────────────────

interface DepartmentFormData {
  name: string;
  code: string;
  cost_centre: string;
  branch_id: string;
}

const EMPTY_FORM: DepartmentFormData = { name: '', code: '', cost_centre: '', branch_id: '' };

// ── Modal ─────────────────────────────────────────────────────────────────────

function DepartmentModal({
  open,
  initial,
  branches,
  onClose,
  onSubmit,
  isLoading,
}: {
  open: boolean;
  initial?: DepartmentFormData;
  branches: Row<'branches'>[];
  onClose: () => void;
  onSubmit: (data: DepartmentFormData) => void;
  isLoading: boolean;
}) {
  const [form, setForm] = useState<DepartmentFormData>(initial ?? EMPTY_FORM);

  if (!open) return null;

  const set =
    (field: keyof DepartmentFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-base font-semibold text-gray-900">
          {initial ? 'Edit Department' : 'New Department'}
        </h2>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Department Name <span className="text-red-500">*</span>
            </label>
            <input
              value={form.name}
              onChange={set('name')}
              placeholder="e.g. Sales & Marketing"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Department Code</label>
            <input
              value={form.code}
              onChange={set('code')}
              placeholder="e.g. SALES"
              maxLength={10}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm uppercase focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <p className="mt-1 text-xs text-gray-600">Up to 10 characters. Auto-generated if blank.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Cost Centre</label>
            <input
              value={form.cost_centre}
              onChange={set('cost_centre')}
              placeholder="e.g. CC-100"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <p className="mt-1 text-xs text-gray-600">Optional reference code used in ledger reporting.</p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Branch (optional)</label>
            <select
              value={form.branch_id}
              onChange={set('branch_id')}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">No specific branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-600">Link this department to a branch, or leave unassigned for a company-wide department.</p>
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
            {initial ? 'Save Changes' : 'Create Department'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function DepartmentsPage() {
  const businessId  = useAppStore((s) => s.currentBusiness?.business.id);
  const queryClient = useQueryClient();

  const [modalOpen,   setModalOpen]   = useState(false);
  const [editTarget,  setEditTarget]  = useState<{ id: string; data: DepartmentFormData } | null>(null);
  const [menuOpen,    setMenuOpen]    = useState<string | null>(null);

  const { data: departments, isLoading, isError } = useQuery({
    queryKey: ['departments', businessId],
    queryFn: () => repos.department.findByBusiness(businessId!),
    enabled: Boolean(businessId),
  });

  const { data: branches = [] } = useQuery({
    queryKey: ['branches', businessId],
    queryFn: () => repos.branch.findByBusiness(businessId!),
    enabled: Boolean(businessId),
  });

  const branchById = new Map<string, Row<'branches'>>((branches ?? []).map((b) => [b.id, b]));

  const createMutation = useMutation({
    mutationFn: (form: DepartmentFormData) =>
      repos.department.createDepartment({
        business_id: businessId!,
        name: form.name.trim(),
        code: form.code.trim().toUpperCase() || form.name.slice(0, 10).toUpperCase(),
        cost_centre: form.cost_centre.trim() || null,
        branch_id: form.branch_id || null,
        is_active: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments', businessId] });
      setModalOpen(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, form }: { id: string; form: DepartmentFormData }) =>
      repos.department.updateDepartment(id, {
        name: form.name.trim(),
        code: form.code.trim().toUpperCase() || undefined,
        cost_centre: form.cost_centre.trim() || null,
        branch_id: form.branch_id || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments', businessId] });
      setEditTarget(null);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => repos.department.deactivateDepartment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['departments', businessId] });
    },
  });

  if (!businessId) return null;

  return (
    <div>
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Departments</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage departments so income and expenses can be allocated for reporting
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-600"
        >
          <Plus size={16} />
          New Department
        </button>
      </div>

      {/* Department list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-gray-100" />
          ))}
        </div>
      ) : isError ? (
        <div className="flex items-center gap-3 rounded-2xl border border-red-100 bg-red-50 p-5">
          <AlertCircle size={18} className="text-red-500" />
          <p className="text-sm text-red-600">Failed to load departments.</p>
        </div>
      ) : departments?.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-200 py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-50">
            <Users2 size={22} className="text-gray-300" />
          </div>
          <p className="text-sm font-medium text-gray-500">No departments yet</p>
          <p className="text-xs text-gray-600">
            Create a department to start allocating income and expenses to it
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="mt-1 flex items-center gap-1.5 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600"
          >
            <Plus size={13} /> New Department
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {departments?.map((dept) => {
            const branch = dept.branch_id ? branchById.get(dept.branch_id) : undefined;
            return (
              <div
                key={dept.id}
                className="relative rounded-2xl border border-gray-200 bg-white p-5 shadow-soft"
              >
                {/* Menu */}
                <div className="absolute right-3 top-3">
                  <button
                    onClick={() => setMenuOpen(menuOpen === dept.id ? null : dept.id)}
                    className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600"
                  >
                    <MoreVertical size={15} />
                  </button>
                  {menuOpen === dept.id && (
                    <div className="absolute right-0 top-8 z-10 w-40 rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
                      <button
                        onClick={() => {
                          setEditTarget({
                            id: dept.id,
                            data: {
                              name: dept.name,
                              code: dept.code ?? '',
                              cost_centre: dept.cost_centre ?? '',
                              branch_id: dept.branch_id ?? '',
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
                          deactivateMutation.mutate(dept.id);
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
                    <Users2 size={16} className="text-gray-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{dept.name}</p>
                    {dept.code && <p className="text-xs text-gray-600">{dept.code}</p>}
                  </div>
                </div>

                <div className="space-y-1.5">
                  {dept.cost_centre && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      Cost centre: {dept.cost_centre}
                    </div>
                  )}
                  {branch && (
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      Branch: {branch.name}
                    </div>
                  )}
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-gray-50 pt-3">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                      dept.is_active
                        ? 'bg-emerald-50 text-brand-600'
                        : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {dept.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create modal */}
      <DepartmentModal
        open={modalOpen}
        branches={branches}
        onClose={() => setModalOpen(false)}
        onSubmit={(form) => createMutation.mutate(form)}
        isLoading={createMutation.isPending}
      />

      {/* Edit modal */}
      <DepartmentModal
        open={Boolean(editTarget)}
        initial={editTarget?.data}
        branches={branches}
        onClose={() => setEditTarget(null)}
        onSubmit={(form) =>
          editTarget && updateMutation.mutate({ id: editTarget.id, form })
        }
        isLoading={updateMutation.isPending}
      />
    </div>
  );
}
