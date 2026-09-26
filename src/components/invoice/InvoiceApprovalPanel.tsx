import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert } from 'lucide-react';
import { approveInvoice, canApproveInvoices, findLiveInvoiceApproval } from '@/services/invoiceApprovalRpc';

/**
 * Draft invoices: shows whether a second-person approval is on record and lets
 * an approver (owner, admin, accountant — never the invoice's creator) record
 * one. The server enforces everything (20261014000000); editing an approved
 * draft revokes the approval automatically.
 */
export function InvoiceApprovalPanel({ invoiceId, status, submittedBy, currentUserId, role }: {
  invoiceId: string;
  status: string;
  submittedBy: string | null | undefined;
  currentUserId: string | null | undefined;
  role: string | null | undefined;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { data: approval, isLoading } = useQuery({
    queryKey: ['invoice', 'approval', invoiceId],
    queryFn: () => findLiveInvoiceApproval(invoiceId),
    enabled: status === 'draft',
  });
  const mutation = useMutation({
    mutationFn: () => approveInvoice(invoiceId),
    onSuccess: () => { setError(null); void queryClient.invalidateQueries({ queryKey: ['invoice', 'approval', invoiceId] }); },
    onError: (e) => setError(e instanceof Error ? e.message : 'Could not approve the invoice.'),
  });

  if (status !== 'draft' || isLoading) return null;
  const isCreator = !!submittedBy && submittedBy === currentUserId;
  const mayApprove = canApproveInvoices(role) && !isCreator;

  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${approval ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : 'border-amber-100 bg-amber-50 text-amber-800'}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          {approval ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
          {approval
            ? `Approved ${new Date(approval.approved_at).toLocaleString()}`
            : 'Not approved yet. If your approval policy requires it, this draft cannot be issued until the owner, an admin or the accountant (not its creator) approves it.'}
        </span>
        {!approval && mayApprove && (
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            Approve
          </button>
        )}
      </div>
      {!approval && isCreator && canApproveInvoices(role) && (
        <p className="mt-1 text-xs">You created this invoice, so another approver must approve it.</p>
      )}
      {error && <p role="alert" className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
