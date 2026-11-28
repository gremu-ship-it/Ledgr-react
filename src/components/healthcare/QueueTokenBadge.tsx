import { Ticket } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Large, high-contrast reception token so patients can read it across a room. */
export function QueueTokenBadge({
  token,
  size = 'md',
  className = '',
}: {
  token: string | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const { t } = useTranslation();
  if (!token) {
    return (
      <span className={`text-[11px] text-gray-400 ${className}`}>
        {t('healthcare.triage.token')}: —
      </span>
    );
  }

  const sizing =
    size === 'lg'
      ? 'gap-2 px-4 py-2 text-2xl'
      : size === 'sm'
        ? 'gap-1 px-2 py-0.5 text-xs'
        : 'gap-1.5 px-3 py-1 text-base';

  return (
    <span
      className={`inline-flex items-center rounded-lg border border-slate-300 bg-slate-900 font-mono font-bold tracking-wider text-white shadow-sm ${sizing} ${className}`}
      aria-label={`${t('healthcare.triage.token')} ${token}`}
    >
      <Ticket className={size === 'lg' ? 'h-5 w-5' : 'h-3.5 w-3.5'} aria-hidden />
      {token}
    </span>
  );
}
