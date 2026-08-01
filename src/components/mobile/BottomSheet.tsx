import { useEffect, useRef, useState, useCallback } from 'react';
import { X } from 'lucide-react';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const originalOverflow = document.body.style.overflow;
    const originalPosition = document.body.style.position;
    const originalTop = document.body.style.top;
    const scrollY = window.scrollY;

    // iOS Safari fix: position fixed + top offset
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.position = originalPosition;
      document.body.style.top = originalTop;
      document.body.style.overflow = originalOverflow;
      document.body.style.left = '';
      document.body.style.right = '';
      window.scrollTo(0, scrollY);
    };
  }, [locked]);
}

export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  useLockBodyScroll(open);

  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
    setIsDragging(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (startY.current === null) return;
    const currentY = e.touches[0].clientY;
    const diff = currentY - startY.current;
    if (diff > 0) {
      setDragOffset(diff);
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (dragOffset > 100) {
      onClose();
    }
    setDragOffset(0);
    setIsDragging(false);
    startY.current = null;
  }, [dragOffset, onClose]);

  // Focus trap: focus close button on open
  useEffect(() => {
    if (!open) return;
    const el = sheetRef.current?.querySelector('button') as HTMLElement | null;
    el?.focus();

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Sheet — bottom aligned, safe-area aware, drag-to-dismiss */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88vh] flex-col rounded-t-[2rem] bg-white/95 shadow-2xl backdrop-blur-xl ring-1 ring-black/5 lg:inset-x-4 lg:bottom-4 lg:rounded-[1.75rem]"
        style={{
          transform: `translateY(${dragOffset}px)`,
          transition: isDragging ? 'none' : 'transform 0.2s ease-out',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Handle — drag area */}
        <div className="flex shrink-0 justify-center pt-3 pb-2 touch-manipulation">
          <div className="h-1.5 w-12 rounded-full bg-gray-300" />
        </div>

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between px-6 py-3 border-b border-gray-100">
          <h2 className="text-xs font-black uppercase tracking-[0.15em] text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gray-100 text-gray-600 transition-transform active:scale-90 touch-manipulation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4 pb-8">
          {children}
        </div>
      </div>
    </>
  );
}
