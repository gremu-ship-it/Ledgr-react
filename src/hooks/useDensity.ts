import { useAppStore } from '@/store/useAppStore';

export function useDensity() {
  const density = useAppStore((s) => s.density);
  const isCompact = density === 'compact';
  return {
    density,
    isCompact,
    isComfortable: !isCompact,
    thClass: isCompact ? 'px-3 py-2' : 'px-4 py-3',
    tdClass: isCompact ? 'px-3 py-2' : 'px-4 py-3',
    rowClass: isCompact ? 'text-[13px]' : 'text-sm',
    cardPadding: isCompact ? 'p-3' : 'p-5',
  };
}
