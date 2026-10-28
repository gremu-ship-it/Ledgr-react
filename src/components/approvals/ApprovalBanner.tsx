import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock3, History, RotateCcw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { repos } from '@/lib/repositories';
import type { ApprovalDocumentType } from '@/dal/repositories/ApprovalRepository';

interface ApprovalBannerProps {
  documentType: ApprovalDocumentType;
  documentId: string;
  businessId: string;
  documentStatus: string;
  showSubmit?: boolean;
  onSubmitted?: () => void;
  onApproved?: () => void;
  onRejected?: () => void;
}

export function ApprovalBanner({
  documentType,
  documentId,
  businessId,
  documentStatus,
  showSubmit = true,
  onSubmitted,
  onApproved,
  onRejected,
}: ApprovalBannerProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [comments, setComments] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState(false);
  const queryKey = ['approval-state', businessId, documentType, documentId];
  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () => repos.approval.getState(businessId, documentType, documentId),
    enabled: Boolean(businessId && documentId),
  });
  const request = data?.request ?? null;

  const refresh = async () => {
    setError(false);
    await queryClient.invalidateQueries({ queryKey });
    await queryClient.invalidateQueries({ queryKey: ['journal'] });
    await queryClient.invalidateQueries({ queryKey: ['construction-procurement'] });
  };

  const submitMutation = useMutation({
    mutationFn: () => repos.approval.start(businessId, documentType, documentId),
    onSuccess: async () => {
      await refresh();
      onSubmitted?.();
    },
    onError: () => setError(true),
  });
  const actionMutation = useMutation({
    mutationFn: ({ action }: { action: 'approved' | 'rejected' }) =>
      repos.approval.act(request!.id, action, comments),
    onSuccess: async (_result, variables) => {
      setComments('');
      await refresh();
      if (variables.action === 'approved') onApproved?.();
      else onRejected?.();
    },
    onError: () => setError(true),
  });
  const resubmitMutation = useMutation({
    mutationFn: () => repos.approval.resubmit(request!.id),
    onSuccess: async () => {
      setComments('');
      await refresh();
      onSubmitted?.();
    },
    onError: () => setError(true),
  });

  if (isLoading || !data || (!data.requires_approval && !request)) return null;
  if (!request && data.requires_approval && documentStatus === 'draft' && !showSubmit) return null;

  const pending = request?.status === 'pending';
  const translatedRole = request?.current_role
    ? t(`approvals.roles.${request.current_role}`)
    : '';
  const history = request?.history ?? [];

  return (
    <section className="rounded-xl border border-indigo-200 bg-indigo-50 p-4" aria-label={t('approvals.banner.title')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {!request ? (
            <>
              <p className="font-semibold text-indigo-950">{t('approvals.banner.required')}</p>
              <p className="mt-1 text-sm text-indigo-800">{t('approvals.banner.submitDescription')}</p>
            </>
          ) : pending ? (
            <>
              <p className="flex items-center gap-2 font-semibold text-indigo-950">
                <Clock3 className="h-4 w-4" aria-hidden />
                {t('approvals.banner.pending', {
                  current: request.current_step,
                  total: request.total_steps,
                  role: translatedRole,
                })}
              </p>
              {request.current_description && (
                <p className="mt-1 text-sm text-indigo-800">{request.current_description}</p>
              )}
              <p className="mt-1 text-xs text-indigo-700">
                {t('approvals.banner.submittedBy', { name: request.requested_by_name })}
              </p>
            </>
          ) : request.status === 'approved' ? (
            <p className="flex items-center gap-2 font-semibold text-emerald-800">
              <Check className="h-4 w-4" aria-hidden /> {t('approvals.banner.approved')}
            </p>
          ) : (
            <>
              <p className="flex items-center gap-2 font-semibold text-rose-800">
                <X className="h-4 w-4" aria-hidden /> {t('approvals.banner.rejected')}
              </p>
              {history.filter((item) => item.action === 'rejected' && item.comments).slice(-1).map((item) => (
                <p key={`${item.actor_id}-${item.acted_at}`} className="mt-1 text-sm text-rose-800">
                  {item.comments}
                </p>
              ))}
            </>
          )}
        </div>

        {request && history.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHistory((open) => !open)}
            className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-2.5 py-1.5 text-xs font-medium text-indigo-800 hover:bg-indigo-100"
            aria-expanded={showHistory}
          >
            <History className="h-3.5 w-3.5" aria-hidden /> {t('approvals.banner.history')}
          </button>
        )}
      </div>

      {pending && request?.can_approve && (
        <div className="mt-4 space-y-3 border-t border-indigo-200 pt-3">
          <label className="block text-xs font-medium text-indigo-900" htmlFor={`approval-comment-${request.id}`}>
            {t('approvals.banner.comments')}
          </label>
          <textarea
            id={`approval-comment-${request.id}`}
            value={comments}
            onChange={(event) => setComments(event.target.value)}
            rows={2}
            placeholder={t('approvals.banner.commentsPlaceholder')}
            className="w-full rounded-lg border border-indigo-200 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => actionMutation.mutate({ action: 'approved' })}
              disabled={actionMutation.isPending}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              <Check className="h-4 w-4" aria-hidden /> {t('approvals.banner.approve')}
            </button>
            <button
              type="button"
              onClick={() => actionMutation.mutate({ action: 'rejected' })}
              disabled={actionMutation.isPending || !comments.trim()}
              className="inline-flex items-center gap-1 rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              <X className="h-4 w-4" aria-hidden /> {t('approvals.banner.reject')}
            </button>
          </div>
        </div>
      )}

      {!request && data.requires_approval && documentStatus === 'draft' && showSubmit && (
        <button
          type="button"
          onClick={() => submitMutation.mutate()}
          disabled={submitMutation.isPending}
          className="mt-4 rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
        >
          {submitMutation.isPending ? t('approvals.banner.submitting') : t('approvals.banner.submit')}
        </button>
      )}

      {request?.status === 'rejected' && request.is_author && data.requires_approval && (
        <button
          type="button"
          onClick={() => resubmitMutation.mutate()}
          disabled={resubmitMutation.isPending || documentStatus !== 'draft'}
          className="mt-4 inline-flex items-center gap-1 rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4" aria-hidden />
          {resubmitMutation.isPending ? t('approvals.banner.resubmitting') : t('approvals.banner.resubmit')}
        </button>
      )}

      {error && <p role="alert" className="mt-3 text-sm font-medium text-rose-700">{t('approvals.errors.actionFailed')}</p>}

      {showHistory && request && (
        <ol className="mt-4 space-y-2 border-t border-indigo-200 pt-3">
          {history.map((item, index) => (
            <li key={`${item.actor_id}-${item.acted_at}-${index}`} className="text-sm text-indigo-950">
              <span className="font-medium">
                {t(`approvals.banner.historyActions.${item.action}`, {
                  name: item.actor_name,
                  step: item.step_order || undefined,
                })}
              </span>
              <time className="ml-2 text-xs text-indigo-700" dateTime={item.acted_at}>
                {new Date(item.acted_at).toLocaleString()}
              </time>
              {item.comments && <p className="mt-0.5 text-xs text-indigo-800">{item.comments}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
