import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Loader2, ShieldAlert, Undo2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';

/**
 * Account deletion (Right to Erasure) — drop into the Privacy tab in
 * SettingsPage.tsx, replacing the earlier "coming soon" placeholder note.
 */
export function DeleteAccountSection() {
  const currentUser = useAppStore((s) => s.currentUser);
  const queryClient = useQueryClient();
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmStep, setShowConfirmStep] = useState(false);

  const { data: deletionStatus, isLoading } = useQuery({
    queryKey: ['deletion_status', currentUser?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('deletion_requested_at, deletion_finalized_at')
        .eq('id', currentUser!.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: Boolean(currentUser?.id),
  });

  const isPending = Boolean(deletionStatus?.deletion_requested_at) && !deletionStatus?.deletion_finalized_at;

  const finalizeDate = deletionStatus?.deletion_requested_at
    ? new Date(new Date(deletionStatus.deletion_requested_at).getTime() + 30 * 24 * 60 * 60 * 1000)
    : null;

  async function handleConfirmDeletion() {
    if (confirmText !== 'DELETE') return;
    setSubmitting(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const { data, error: fnError } = await supabase.functions.invoke('request-account-deletion', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(data.error);

      queryClient.invalidateQueries({ queryKey: ['deletion_status', currentUser?.id] });
      setShowConfirmStep(false);
      setConfirmText('');
    } catch (err) {
      setError((err as Error).message || 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelDeletion() {
    setCancelling(true);
    setError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const { data, error: fnError } = await supabase.functions.invoke('cancel-account-deletion', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(data.error);

      queryClient.invalidateQueries({ queryKey: ['deletion_status', currentUser?.id] });
    } catch (err) {
      setError((err as Error).message || 'Could not cancel deletion. Please try again or contact support.');
    } finally {
      setCancelling(false);
    }
  }

  if (isLoading) {
    return <div className="h-24 animate-pulse rounded-xl bg-surface" />;
  }

  if (isPending) {
    return (
      <div className="rounded-2xl border border-warning/20 bg-warning/12 p-5">
        <div className="mb-2 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-warning" />
          <h3 className="text-sm font-semibold text-warning">Account scheduled for deletion</h3>
        </div>
        <p className="mb-4 text-xs text-warning">
          Your personal information has been anonymized. Your account will be permanently
          locked on{' '}
          <span className="font-semibold">
            {finalizeDate?.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
          </span>{' '}
          unless you cancel before then.
        </p>
        {error && <p className="mb-3 text-xs text-danger">{error}</p>}
        <button
          onClick={handleCancelDeletion}
          disabled={cancelling}
          className="flex items-center gap-2 rounded-lg border border-warning/30 bg-card px-4 py-2 text-sm font-semibold text-warning hover:bg-warning/12 disabled:opacity-60 transition-colors"
        >
          {cancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
          Cancel Deletion
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-danger/20 bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-danger" />
        <h3 className="text-sm font-semibold text-ink">Delete my account</h3>
      </div>

      {!showConfirmStep ? (
        <>
          <p className="mb-4 text-xs text-muted">
            This will immediately anonymize your personal information (name, phone, avatar)
            and permanently lock your account after 30 days. Financial records for any
            business you own are retained after this, as required by tax and accounting law
            — only your personal identifying information is removed. You can cancel any time
            during the 30-day window.
          </p>
          <button
            onClick={() => setShowConfirmStep(true)}
            className="rounded-lg border border-danger/20 px-4 py-2 text-sm font-medium text-danger hover:bg-danger/10 transition-colors"
          >
            Delete my account
          </button>
        </>
      ) : (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg bg-danger/10 px-4 py-3 text-xs text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <p>
              This action starts immediately and cannot be undone after 30 days. Type{' '}
              <span className="font-mono font-semibold">DELETE</span> below to confirm.
            </p>
          </div>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="Type DELETE to confirm"
            className="w-full rounded-lg border border-line px-3 py-2 text-sm focus:border-danger/40 focus:outline-none focus:ring-1 focus:ring-red-400"
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => { setShowConfirmStep(false); setConfirmText(''); setError(null); }}
              className="rounded-lg border border-line px-4 py-2 text-sm font-medium text-sub hover:bg-bg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmDeletion}
              disabled={confirmText !== 'DELETE' || submitting}
              className="flex items-center gap-2 rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:bg-danger disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirm Deletion
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
