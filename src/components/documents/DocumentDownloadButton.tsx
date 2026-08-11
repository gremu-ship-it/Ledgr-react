import { useState, useRef, useEffect } from 'react';
import { Download, FileText, FileDown, ChevronDown } from 'lucide-react';

export type DocType = 'invoice' | 'delivery_note' | 'receipt' | 'quotation' | 'credit_note' | 'expense' | 'payslip' | 'report';

export interface DocumentOption {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  onClick: () => void;
}

interface Props {
  options: DocumentOption[];
  label?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  disabled?: boolean;
}

function cls(...c: (string | false | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function DocumentDownloadButton({
  options,
  label = 'Download',
  variant = 'secondary',
  size = 'md',
  disabled,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  if (options.length === 0) return null;

  // Single option -> simple button
  if (options.length === 1) {
    const single = options[0];
    return (
      <button
        onClick={single.onClick}
        disabled={disabled}
        className={cls(
          'inline-flex items-center gap-2 rounded-xl font-medium transition-all active:scale-[0.98] disabled:opacity-60',
          variant === 'primary' && 'bg-gray-900 text-white hover:bg-black shadow-sm px-4 py-2 text-sm',
          variant === 'secondary' && 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 shadow-sm px-4 py-2 text-sm',
          variant === 'ghost' && 'text-gray-600 hover:text-gray-900 hover:bg-gray-50 px-3 py-1.5 text-sm',
          size === 'sm' && 'px-3 py-1.5 text-xs',
        )}
      >
        {single.icon || <Download className="h-4 w-4" />}
        {single.label}
      </button>
    );
  }

  return (
    <div className="relative inline-block text-left" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className={cls(
          'inline-flex items-center gap-2 rounded-xl font-medium transition-all active:scale-[0.98] disabled:opacity-60',
          variant === 'primary' && 'bg-gray-900 text-white hover:bg-black shadow-sm px-4 py-2.5 text-sm',
          variant === 'secondary' && 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 shadow-sm px-4 py-2.5 text-sm',
          variant === 'ghost' && 'text-gray-600 hover:text-gray-900 hover:bg-gray-50 px-3 py-1.5 text-sm',
          size === 'sm' && 'px-3 py-1.5 text-xs',
        )}
      >
        <FileDown className="h-4 w-4" />
        {label}
        <ChevronDown className={cls('h-4 w-4 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-64 origin-top-right rounded-2xl border border-gray-200 bg-white p-1.5 shadow-xl ring-1 ring-black/5 focus:outline-none">
          <div className="px-3 py-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Download Document</p>
          </div>
          <div className="space-y-0.5">
            {options.map((opt) => (
              <button
                key={opt.id}
                onClick={() => {
                  setOpen(false);
                  opt.onClick();
                }}
                className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-gray-50"
              >
                <span className="mt-0.5 text-gray-500">
                  {opt.icon || <FileText className="h-4 w-4" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-gray-900">{opt.label}</span>
                  {opt.description && (
                    <span className="block text-xs text-gray-500 mt-0.5 leading-snug">{opt.description}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-1 border-t border-gray-100 px-3 py-2">
            <p className="flex items-center gap-1.5 text-[10px] text-gray-400">
              <Download className="h-3 w-3" /> Downloads a clean PDF file (no browser print headers)
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

