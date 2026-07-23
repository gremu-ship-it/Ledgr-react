import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';

export type IconTone = 'brand' | 'negative' | 'neutral' | 'warning' | 'info';
export type IconSize = 'sm' | 'md' | 'lg';

interface ToneStyle {
  icon: string;
  raised: string;
  pressedActive: string;
}

const TONE_STYLES: Record<IconTone, ToneStyle> = {
  brand: {
    icon: 'text-brand-600',
    raised: 'bg-brand-50 border border-brand-100 shadow-sm shadow-brand-500/10',
    pressedActive: 'group-active:scale-95 group-active:bg-brand-100',
  },
  negative: {
    icon: 'text-red-500',
    raised: 'bg-red-50 border border-red-100 shadow-sm shadow-red-500/10',
    pressedActive: 'group-active:scale-95 group-active:bg-red-100',
  },
  neutral: {
    icon: 'text-slate-500',
    raised: 'bg-slate-50 border border-slate-100 shadow-sm shadow-slate-500/10',
    pressedActive: 'group-active:scale-95 group-active:bg-slate-100',
  },
  warning: {
    icon: 'text-amber-500',
    raised: 'bg-amber-50 border border-amber-100 shadow-sm shadow-amber-500/10',
    pressedActive: 'group-active:scale-95 group-active:bg-amber-100',
  },
  info: {
    icon: 'text-indigo-500',
    raised: 'bg-indigo-50 border border-indigo-100 shadow-sm shadow-indigo-500/10',
    pressedActive: 'group-active:scale-95 group-active:bg-indigo-100',
  },
};

const SIZE_STYLES: Record<IconSize, { box: string; icon: string }> = {
  sm: { box: 'h-9 w-9 rounded-xl', icon: 'h-4 w-4' },
  md: { box: 'h-11 w-11 rounded-2xl', icon: 'h-5 w-5' },
  lg: { box: 'h-14 w-14 rounded-2xl', icon: 'h-6 w-6' },
};

/**
 * Shared icon badge — a clean, modern container used
 * consistently across mobile dashboard, bottom nav, and desktop metric
 * cards.
 */
export function IconBadge({
  icon: Icon,
  tone = 'neutral',
  size = 'md',
  interactive = false,
}: {
  icon: LucideIcon;
  tone?: IconTone;
  size?: IconSize;
  interactive?: boolean;
}) {
  const t = TONE_STYLES[tone];
  const s = SIZE_STYLES[size];
  return (
    <span
      className={clsx(
        'flex shrink-0 items-center justify-center transition-all duration-200',
        s.box,
        t.raised,
        interactive && t.pressedActive,
      )}
    >
      <Icon className={clsx(s.icon, t.icon)} />
    </span>
  );
}