import { useRef, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';

interface SwipeAction {
  label: string;
  icon: React.ElementType;
  color: string; // tailwind bg class e.g. bg-brand-500
  action: () => void;
}

interface SwipeableRowProps {
  children: ReactNode;
  actions: SwipeAction[]; // left swipe reveals actions on right: first is primary
  threshold?: number;
  disabled?: boolean;
  className?: string;
}

export function SwipeableRow({ children, actions, threshold = 80, disabled = false, className }: SwipeableRowProps) {
  const [offset, setOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startX = useRef<number | null>(null);
  const currentOffset = useRef(0);

  const maxSwipe = actions.length * 72; // 72px per action

  function onTouchStart(e: React.TouchEvent) {
    if (disabled) return;
    startX.current = e.touches[0].clientX;
    currentOffset.current = offset;
    setIsDragging(true);
  }

  function onTouchMove(e: React.TouchEvent) {
    if (disabled || startX.current === null) return;
    const diff = e.touches[0].clientX - startX.current;
    const newOffset = currentOffset.current + diff;
    // Only allow left swipe (negative)
    if (newOffset < 0) {
      const clamped = Math.max(newOffset, -maxSwipe - 20);
      setOffset(clamped);
    } else if (newOffset > 0 && offset < 0) {
      // Swipe right to close
      const clamped = Math.min(newOffset, 0);
      setOffset(clamped);
    }
  }

  function onTouchEnd() {
    if (disabled) return;
    setIsDragging(false);
    startX.current = null;
    // Snap logic
    if (offset < -threshold) {
      setOffset(-Math.min(maxSwipe, Math.max(threshold, Math.abs(offset))));
      // If swiped far enough, snap to full open
      if (Math.abs(offset) > maxSwipe * 0.6) {
        setOffset(-maxSwipe);
      }
    } else {
      setOffset(0);
    }
  }

  function close() {
    setOffset(0);
  }

  return (
    <div className={clsx('relative overflow-hidden', className)}>
      {/* Actions background */}
      <div className="absolute inset-y-0 right-0 flex">
        {actions.map((a, i) => {
          const Icon = a.icon;
          return (
            <button
              key={i}
              onClick={() => {
                close();
                a.action();
              }}
              className={clsx('flex w-[72px] flex-col items-center justify-center gap-1 text-white transition-colors', a.color)}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-bold uppercase tracking-wide">{a.label}</span>
            </button>
          );
        })}
      </div>

      {/* Foreground */}
      <div
        className={clsx('relative bg-white transition-transform', !isDragging && 'duration-200 ease-out')}
        style={{ transform: `translateX(${offset}px)` }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}
