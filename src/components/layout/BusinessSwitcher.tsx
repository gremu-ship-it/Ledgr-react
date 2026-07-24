import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, Building2 } from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import { AddBusinessButton } from '@/components/layout/AddBusinessButton';

export function BusinessSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const businesses = useAppStore((s) => s.businesses);
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const switchBusiness = useAppStore((s) => s.switchBusiness);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener(
        'mousedown',
        handleClickOutside,
      );
    };
  }, []);

  if (!currentBusiness || !currentBusiness.business) {
    return (
      <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-400">
        <Building2 className="h-4 w-4" />
        <span>No business</span>
      </div>
    );
  }

  const brandColor = '#1D9E75';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: brandColor }}
          aria-hidden
        />

        <span className="max-w-[160px] truncate">
          {currentBusiness.business?.name ?? 'No business'}
        </span>

        <ChevronDown
          className={clsx(
            'h-4 w-4 text-gray-400 transition-transform',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-64 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg">
          <p className="px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-gray-400">
            Switch business
          </p>

          <ul className="max-h-72 overflow-y-auto">
            {businesses.map((membership, index) => {
              if (!membership?.business) {
                return null;
              }

              const isSelected =
                membership.business.id ===
                currentBusiness.business.id;

              return (
                <li
                  key={
                    membership.business.id ??
                    `business-${index}`
                  }
                >
                  <button
                    onClick={() => {
                      switchBusiness(
                        membership.business.id,
                      );
                      setOpen(false);
                    }}
                    className={clsx(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                      isSelected
                        ? 'bg-brand-50 text-brand-700'
                        : 'text-gray-700 hover:bg-gray-50',
                    )}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor: brandColor,
                      }}
                      aria-hidden
                    />

                    <span className="flex-1 truncate">
                      {membership.business.name}
                    </span>

                    <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium capitalize text-gray-500">
                      {membership.role}
                    </span>

                    {isSelected && (
                      <Check className="h-4 w-4 shrink-0 text-brand-600" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-1 border-t border-gray-100 pt-1">
            <AddBusinessButton onClose={() => setOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}