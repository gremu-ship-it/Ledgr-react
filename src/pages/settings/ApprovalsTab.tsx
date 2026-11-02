import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from 'lucide-react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/store/useAppStore';
import { useUsage } from '@/hooks/useUsage';
import { hasCapability } from '@/lib/billing/plans';
import type { ApprovalDocumentType, ApprovalRole, ApprovalWorkflow } from '@/dal/repositories/ApprovalRepository';
import { repos } from '@/lib/repositories';

interface DraftStep {
  required_role: ApprovalRole;
  description: string;
}
interface WorkflowDraft {
  enabled: boolean;
  name: string;
  steps: DraftStep[];
}
type Drafts = Record<ApprovalDocumentType, WorkflowDraft>;

const DOCUMENT_TYPES: ApprovalDocumentType[] = ['purchase_order', 'journal_entry'];
const ROLES: ApprovalRole[] = [
  'owner', 'admin', 'accountant', 'payroll_manager', 'auditor', 'viewer', 'data_entry',
  'supervisor', 'inventory_manager', 'sales_clerk', 'purchasing_officer', 'warehouse_worker',
  'sales_manager', 'customer_service_rep', 'tax_compliance_officer', 'treasury_manager',
  'asset_manager', 'board_member', 'branch_manager', 'cashier', 'manager', 'stock_clerk',
];
const EMPTY_DRAFT: WorkflowDraft = { enabled: false, name: '', steps: [] };

function draftsFrom(workflows: ApprovalWorkflow[]): Drafts {
  const result: Drafts = {
    purchase_order: { ...EMPTY_DRAFT, steps: [] },
    journal_entry: { ...EMPTY_DRAFT, steps: [] },
  };
  for (const workflow of workflows) {
    result[workflow.document_type] = {
      enabled: workflow.is_active,
      name: workflow.name,
      steps: workflow.steps.map((step) => ({
        required_role: step.required_role,
        description: step.description ?? '',
      })),
    };
  }
  return result;
}

export function ApprovalsTab() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const businessId = currentBusiness?.business?.id;
  const role = currentBusiness?.role;
  const { planTier } = useUsage();
  const isEnterprise = hasCapability(planTier, 'approval_workflows');
  const canConfigure = role === 'owner' || role === 'admin';
  const [draftOverrides, setDraftOverrides] = useState<{ businessId?: string; drafts: Partial<Drafts> }>({ drafts: {} });
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const { data: workflows = [], isLoading } = useQuery({
    queryKey: ['approval-workflows', businessId],
    queryFn: () => repos.approval.getWorkflows(businessId!),
    enabled: Boolean(businessId && isEnterprise),
  });

  const drafts = useMemo(() => {
    const persisted = draftsFrom(workflows);
    return draftOverrides.businessId === businessId
      ? { ...persisted, ...draftOverrides.drafts }
      : persisted;
  }, [businessId, draftOverrides, workflows]);

  const saveMutation = useMutation({
    mutationFn: (documentType: ApprovalDocumentType) => {
      const draft = drafts[documentType];
      return repos.approval.saveWorkflow({
        businessId: businessId!,
        documentType,
        name: draft.name.trim() || t(`approvals.${documentType}WorkflowName`),
        isActive: draft.enabled,
        steps: draft.steps.map((step) => ({
          required_role: step.required_role,
          description: step.description.trim() || null,
        })),
      });
    },
    onSuccess: async () => {
      setSaveError(false);
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey: ['approval-workflows', businessId] });
      window.setTimeout(() => setSaved(false), 2500);
    },
    onError: () => setSaveError(true),
  });

  const updateDraft = (documentType: ApprovalDocumentType, update: (draft: WorkflowDraft) => WorkflowDraft) => {
    setDraftOverrides((current) => ({
      businessId,
      drafts: {
        ...(current.businessId === businessId ? current.drafts : {}),
        [documentType]: update(drafts[documentType]),
      },
    }));
    setSaved(false);
    setSaveError(false);
  };

  if (!isEnterprise) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
        <h2 className="text-lg font-semibold text-amber-950">{t('approvals.title')}</h2>
        <p className="mt-2 text-sm text-amber-900">{t('approvals.enterpriseOnly')}</p>
        <Link to="/settings?tab=billing" className="mt-4 inline-flex rounded-lg bg-amber-800 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-900">
          {t('approvals.viewPlans')}
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return <div className="animate-pulse rounded-xl bg-gray-100 p-8" aria-label={t('common.loading')} />;
  }

  return (
    <div className="space-y-6">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-gray-900">{t('approvals.title')}</h2>
          <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">{t('approvals.enterpriseBadge')}</span>
        </div>
        <p className="mt-1 text-sm text-gray-500">{t('approvals.description')}</p>
      </header>

      {!workflows.some((workflow) => workflow.is_active) && (
        <p className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
          {t('approvals.noWorkflows')}
        </p>
      )}

      {!canConfigure && (
        <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {t('approvals.adminOnly')}
        </p>
      )}

      {DOCUMENT_TYPES.map((documentType) => {
        const draft = drafts[documentType];
        const title = documentType === 'purchase_order'
          ? t('approvals.purchaseOrders')
          : t('approvals.journalEntries');
        return (
          <section key={documentType} className="rounded-xl border border-gray-200 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold text-gray-900">{title}</h3>
                <p className="mt-1 text-xs text-gray-500">{t('approvals.linearDescription')}</p>
              </div>
              <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-800">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  disabled={!canConfigure}
                  onChange={(event) => updateDraft(documentType, (current) => ({
                    ...current,
                    enabled: event.target.checked,
                    steps: event.target.checked && current.steps.length === 0
                      ? [{ required_role: 'admin', description: '' }]
                      : current.steps,
                  }))}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-700 focus:ring-indigo-600"
                />
                {t('approvals.requireApproval')}
              </label>
            </div>

            <div className="mt-4 space-y-4">
              <label className="block text-sm font-medium text-gray-700">
                {t('approvals.workflowName')}
                <input
                  value={draft.name}
                  disabled={!canConfigure}
                  onChange={(event) => updateDraft(documentType, (current) => ({ ...current, name: event.target.value }))}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-50"
                />
              </label>

              {draft.enabled && draft.steps.length === 0 && (
                <p className="text-sm text-rose-700">{t('approvals.emptySteps')}</p>
              )}

              <ol className="space-y-3">
                {draft.steps.map((step, index) => (
                  <li key={`${documentType}-${index}`} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold text-gray-800">{t('approvals.step', { number: index + 1 })}</h4>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          aria-label={t('approvals.moveUp')}
                          disabled={!canConfigure || index === 0}
                          onClick={() => updateDraft(documentType, (current) => {
                            const steps = [...current.steps];
                            [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]];
                            return { ...current, steps };
                          })}
                          className="rounded p-1.5 text-gray-600 hover:bg-gray-200 disabled:opacity-30"
                        ><ArrowUp className="h-4 w-4" aria-hidden /></button>
                        <button
                          type="button"
                          aria-label={t('approvals.moveDown')}
                          disabled={!canConfigure || index === draft.steps.length - 1}
                          onClick={() => updateDraft(documentType, (current) => {
                            const steps = [...current.steps];
                            [steps[index], steps[index + 1]] = [steps[index + 1], steps[index]];
                            return { ...current, steps };
                          })}
                          className="rounded p-1.5 text-gray-600 hover:bg-gray-200 disabled:opacity-30"
                        ><ArrowDown className="h-4 w-4" aria-hidden /></button>
                        <button
                          type="button"
                          aria-label={t('approvals.removeStep')}
                          disabled={!canConfigure || (draft.enabled && draft.steps.length <= 1)}
                          onClick={() => updateDraft(documentType, (current) => ({
                            ...current,
                            steps: current.steps.filter((_step, stepIndex) => stepIndex !== index),
                          }))}
                          className="rounded p-1.5 text-rose-700 hover:bg-rose-100 disabled:opacity-30"
                        ><Trash2 className="h-4 w-4" aria-hidden /></button>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="block text-xs font-medium text-gray-700">
                        {t('approvals.requiredRole')}
                        <select
                          value={step.required_role}
                          disabled={!canConfigure}
                          onChange={(event) => updateDraft(documentType, (current) => ({
                            ...current,
                            steps: current.steps.map((candidate, stepIndex) => stepIndex === index
                              ? { ...candidate, required_role: event.target.value as ApprovalRole }
                              : candidate),
                          }))}
                          className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-100"
                        >
                          {ROLES.map((candidate) => (
                            <option key={candidate} value={candidate}>{t(`approvals.roles.${candidate}`)}</option>
                          ))}
                        </select>
                      </label>
                      <label className="block text-xs font-medium text-gray-700">
                        {t('approvals.stepDescription')}
                        <input
                          value={step.description}
                          disabled={!canConfigure}
                          onChange={(event) => updateDraft(documentType, (current) => ({
                            ...current,
                            steps: current.steps.map((candidate, stepIndex) => stepIndex === index
                              ? { ...candidate, description: event.target.value }
                              : candidate),
                          }))}
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-gray-100"
                        />
                      </label>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <button
                  type="button"
                  disabled={!canConfigure}
                  onClick={() => updateDraft(documentType, (current) => ({
                    ...current,
                    steps: [...current.steps, { required_role: 'admin', description: '' }],
                  }))}
                  className="inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" aria-hidden /> {t('approvals.addStep')}
                </button>
                <button
                  type="button"
                  disabled={!canConfigure || saveMutation.isPending || (draft.enabled && draft.steps.length === 0)}
                  onClick={() => saveMutation.mutate(documentType)}
                  className="inline-flex items-center gap-2 rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
                >
                  <Save className="h-4 w-4" aria-hidden />
                  {saveMutation.isPending ? t('approvals.saving') : t('approvals.save')}
                </button>
              </div>
            </div>
          </section>
        );
      })}

      {saved && <p role="status" className="text-sm font-medium text-emerald-700">{t('approvals.saved')}</p>}
      {saveError && <p role="alert" className="text-sm font-medium text-rose-700">{t('approvals.errors.saveFailed')}</p>}
    </div>
  );
}
