import { useState } from 'react';
import { ShieldCheck, X, AlertCircle, Clock } from 'lucide-react';

/**
 * PosManagerApprovalModal — post-R07 correction-safety release.
 *
 * The pre-release version of this modal was itself the vulnerability: any
 * typed PIN of 4+ characters and any free-text name was "authorization".
 * The client can NEVER authorize an operation (R07 Decision B). What remains
 * is an honest workflow display with two modes:
 *
 *  - 'server' (voids/refunds): request a server-minted approval for exactly
 *    one document and one action, then display its pending state. Approval
 *    happens outside this screen, in an owner/admin/manager session verified
 *    by the database (`authorize_pos_approval`). Once approved, the operator
 *    presses "Continue" and the pending action re-runs — the server command
 *    itself decides whether the token is live, bound and unconsumed.
 *  - 'display': a simple supervisor-acknowledgement note for non-financial
 *    in-cart nudges (e.g. over-cap discounts). No PIN, no typed approver
 *    identity; it authorizes nothing anywhere.
 */
interface PosManagerApprovalModalProps {
  open: boolean;
  onClose: () => void;
  actionDescription: string;
  /**
   * Server mode: when present, the modal requests a real approval via this
   * callback (wired to `request_pos_approval`) and returns the token to
   * onApprove once the operator continues. Absent: display mode.
   */
  onRequestServerApproval?: () => Promise<string>;
  /**
   * Receives the server-minted approval token in server mode; receives
   * undefined in display mode. Never receives a PIN or a typed name.
   */
  onApprove: (approvalToken?: string) => void;
}

export function PosManagerApprovalModal({
  open,
  onClose,
  actionDescription,
  onRequestServerApproval,
  onApprove,
}: PosManagerApprovalModalProps) {
  const [step, setStep] = useState<'request' | 'pending'>('request');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState<string | null>(null);

  // Reset the local step state when the dialog (re)opens. useState's reset key
  // pattern would remount; keeping the mount stable here, the reset runs on the
  // transition render instead of inside an effect.
  const [wasOpen, setWasOpen] = useState(false);
  if (open && !wasOpen) {
    setStep('request');
    setBusy(false);
    setError('');
    setToken(null);
    setWasOpen(true);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  if (!open) return null;

  const serverMode = !!onRequestServerApproval;

  const handleRequest = async () => {
    if (!onRequestServerApproval) return;
    setBusy(true);
    setError('');
    try {
      const minted = await onRequestServerApproval();
      setToken(minted);
      setStep('pending');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not request approval.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-amber-600" />
            <h2 className="text-sm font-black text-gray-900">
              {serverMode ? 'Manager Approval Required' : 'Supervisor Confirmation'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-gray-400 hover:bg-gray-100"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Action description banner */}
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900">
          <p className="font-semibold">{actionDescription}</p>
        </div>

        {serverMode ? (
          step === 'request' ? (
            <div className="space-y-3">
              <p className="text-xs text-gray-600 leading-relaxed">
                This operation needs approval bound to this specific document. The approval is
                recorded and authorized on the server by an owner, admin or manager using their
                own verified sign-in — it cannot be typed in here.
              </p>
              {error && (
                <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRequest()}
                className="w-full rounded-2xl bg-amber-600 py-3 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {busy ? 'Requesting…' : 'Request approval'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                <Clock className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Approval requested and recorded on the server (token {token?.slice(0, 8)}…).
                  The request stays valid for 15 minutes. Once an owner, admin or manager has
                  approved it, press continue — the server verifies the approval itself.
                </span>
              </div>
              <button
                type="button"
                onClick={() => token && onApprove(token)}
                className="w-full rounded-2xl bg-brand-600 py-3 text-sm font-bold text-white hover:bg-brand-700"
              >
                Continue with this approval
              </button>
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-2xl border border-gray-200 py-2.5 text-xs font-bold text-gray-600 hover:bg-gray-50"
              >
                Try again later
              </button>
            </div>
          )
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-gray-600 leading-relaxed">
              Confirm that a supervisor has seen this on the till. This records a note only —
              it does not authorize any financial correction.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-2xl border border-gray-200 py-2.5 text-xs font-bold text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => onApprove(undefined)}
                className="flex-1 rounded-2xl bg-amber-600 py-2.5 text-xs font-bold text-white hover:bg-amber-700"
              >
                Confirm on the till
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
