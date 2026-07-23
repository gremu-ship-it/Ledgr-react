import { useEffect } from 'react';
import { X } from 'lucide-react';

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="fixed bottom-4 left-4 right-4 z-50 rounded-[2.5rem] bg-white/95 shadow-2xl backdrop-blur-xl ring-1 ring-black/5">
        {/* Handle */}
        <div className="flex justify-center pt-4 pb-2">
          <div className="h-1.5 w-12 rounded-full bg-gray-200/50" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4">
          <h2 className="text-xs font-black uppercase tracking-[0.2em] text-gray-900">{title}</h2>
          <button
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gray-100/50 text-gray-500 transition-transform active:scale-90"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[70vh] overflow-y-auto px-6 py-2 pb-10">
          {children}
        </div>
      </div>
    </>
  );
}