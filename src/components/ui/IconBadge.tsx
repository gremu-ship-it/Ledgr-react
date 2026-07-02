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
    raised: 'shadow-[4px_4px_10px_rgba(15,118,110,0.18),-4px_-4px_10px_rgba(255,255,255,0.9)]',
    pressedActive: 'group-active:shadow-[inset_3px_3px_6px_rgba(15,118,110,0.20),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]',
  },
  negative: {
    icon: 'text-red-500',
    raised: 'shadow-[4px_4px_10px_rgba(244,63,94,0.16),-4px_-4px_10px_rgba(255,255,255,0.9)]',
    pressedActive: 'group-active:shadow-[inset_3px_3px_6px_rgba(244,63,94,0.18),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]',
  },
  neutral: {
    icon: 'text-slate-500',
    raised: 'shadow-[4px_4px_10px_rgba(100,116,139,0.15),-4px_-4px_10px_rgba(255,255,255,0.9)]',
    pressedActive: 'group-active:shadow-[inset_3px_3px_6px_rgba(100,116,139,0.17),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]',
  },
  warning: {
    icon: 'text-amber-500',
    raised: 'shadow-[4px_4px_10px_rgba(245,158,11,0.18),-4px_-4px_10px_rgba(255,255,255,0.9)]',
    pressedActive: 'group-active:shadow-[inset_3px_3px_6px_rgba(245,158,11,0.20),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]',
  },
  info: {
    icon: 'text-indigo-500',
    raised: 'shadow-[4px_4px_10px_rgba(99,102,241,0.16),-4px_-4px_10px_rgba(255,255,255,0.9)]',
    pressedActive: 'group-active:shadow-[inset_3px_3px_6px_rgba(99,102,241,0.18),inset_-3px_-3px_6px_rgba(255,255,255,0.9)]',
  },
};

const SIZE_STYLES: Record<IconSize, { box: string; icon: string }> = {
  sm: { box: 'h-9 w-9', icon: 'h-4 w-4' },
  md: { box: 'h-11 w-11', icon: 'h-5 w-5' },
  lg: { box: 'h-14 w-14', icon: 'h-6 w-6' },
};

/**
 * Shared neumorphic icon badge — a soft-shadow raised container used
 * consistently across mobile dashboard, bottom nav, and desktop metric
 * cards. Pass `interactive` when the badge sits inside a `group` button
 * to get an inset "press" shadow on tap/click.
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
        'flex shrink-0 items-center justify-center rounded-2xl bg-white transition-shadow duration-150',
        s.box,
        t.raised,
        interactive && t.pressedActive,
      )}
    >
      <Icon className={clsx(s.icon, t.icon)} />
    </span>
  );
}