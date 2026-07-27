import { Clock } from 'lucide-react';

interface InactivityWarningModalProps {
  secondsRemaining: number;
  onExtend: () => void;
  onLogoutNow: () => void;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function InactivityWarningModal({ secondsRemaining, onExtend, onLogoutNow }: InactivityWarningModalProps) {
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="inactivity-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex flex-col items-center gap-4 text-center">
          <div
            className="flex h-16 w-16 flex-col items-center justify-center rounded-full border-4 border-amber-500 bg-amber-50"
            role="timer"
            aria-live="off"
            aria-label={`Signing you out in ${formatCountdown(secondsRemaining)}`}
          >
            <Clock className="h-5 w-5 text-amber-800" aria-hidden="true" />
            <span className="mt-0.5 text-xs font-bold tabular-nums text-amber-800">{formatCountdown(secondsRemaining)}</span>
          </div>
          <div>
            <h2 id="inactivity-title" className="text-base font-semibold text-gray-900">Are you still there?</h2>
            <p className="mt-1.5 text-sm text-gray-700">
              You'll be signed out automatically due to inactivity in{' '}
              <span className="font-semibold tabular-nums text-amber-800">{formatCountdown(secondsRemaining)}</span>.
              Any unsaved changes will be lost.
            </p>
          </div>
          <div className="flex w-full flex-col gap-2">
            <button
              type="button"
              onClick={onExtend}
              className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              I'm still here — keep me signed in
            </button>
            <button
              type="button"
              onClick={onLogoutNow}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Sign out now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}