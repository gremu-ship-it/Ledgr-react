import { useAppStore } from '@/store/useAppStore';
import { Clock } from 'lucide-react';

const TIMEOUT_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120];

export function InactivityTimeoutSetting() {
  const inactivityTimeoutMinutes = useAppStore((s) => s.inactivityTimeoutMinutes);
  const setInactivityTimeoutMinutes = useAppStore((s) => s.setInactivityTimeoutMinutes);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-100 text-brand-600">
          <Clock className="h-4 w-4" />
        </div>
        <div>
          <h3 className="font-semibold text-gray-900">Session Timeout</h3>
          <p className="text-xs text-gray-500">Automatically sign out after inactivity</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {TIMEOUT_OPTIONS.map((minutes) => (
          <button
            key={minutes}
            onClick={() => setInactivityTimeoutMinutes(minutes)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-all ${
              inactivityTimeoutMinutes === minutes
                ? 'bg-brand-600 text-white border-brand-600'
                : 'border-gray-200 hover:bg-gray-50 text-gray-700'
            }`}
          >
            {minutes} min
          </button>
        ))}
      </div>

      <p className="mt-3 text-xs text-gray-500">
        Current setting: <span className="font-medium text-brand-700">{inactivityTimeoutMinutes} minutes</span> of inactivity
      </p>
    </div>
  );
}