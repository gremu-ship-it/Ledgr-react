import { Delete } from 'lucide-react';

interface MwkNumberPadProps {
  value: string;
  onChange: (value: string) => void;
  maxAmount?: number;
}

function vibrate(ms = 5) {
  try {
    if ('vibrate' in navigator) navigator.vibrate(ms);
  } catch {}
}

export function MwkNumberPad({ value, onChange, maxAmount = 999999999 }: MwkNumberPadProps) {
  function handleKey(key: string) {
    vibrate(5);
    if (key === 'del') {
      onChange(value.slice(0, -1));
      return;
    }
    if (key === '.' && value.includes('.')) return;
    if (value.split('.')[1]?.length >= 2) return;

    // Prevent multiple leading zeros
    if (value === '0' && key !== '.') {
      onChange(key);
      return;
    }
    if (value === '' && key === '.') {
      onChange('0.');
      return;
    }

    const next = (value || '') + key;
    const numeric = parseFloat(next);
    if (!isNaN(numeric) && numeric > maxAmount) return;

    onChange(next);
  }

  const keys = [
    ['7', '8', '9'],
    ['4', '5', '6'],
    ['1', '2', '3'],
    ['.', '0', 'del'],
  ];

  const display = value
    ? `MK ${parseFloat(value || '0').toLocaleString('en-MW', {
        minimumFractionDigits: value.includes('.') ? (value.split('.')[1]?.length ?? 0) : 0,
        maximumFractionDigits: 2,
      })}`
    : 'MK 0';

  const isMax = parseFloat(value || '0') >= maxAmount;

  return (
    <div className="flex flex-col items-center">
      <div className="mb-6 text-center min-h-[56px] flex flex-col items-center justify-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-400">Amount</p>
        <p className={`mt-1 font-black tracking-tight transition-colors ${value ? (isMax ? 'text-red-600 text-4xl' : 'text-brand-600 text-[2.5rem]') : 'text-gray-200 text-5xl'}`}>
          {display}
        </p>
        {isMax && <p className="mt-1 text-[10px] font-bold uppercase text-red-600">Max amount reached</p>}
      </div>

      <div className="grid w-full grid-cols-3 gap-3">
        {keys.flat().map((key) => (
          <button
            key={key}
            onClick={() => handleKey(key)}
            aria-label={key === 'del' ? 'Delete' : key}
            className={`flex h-14 items-center justify-center rounded-2xl text-xl font-bold transition-all active:scale-95 touch-manipulation select-none ${
              key === 'del'
                ? 'bg-red-50 text-red-600 ring-1 ring-red-100 active:bg-red-100'
                : 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-100 active:bg-gray-50'
            }`}
          >
            {key === 'del' ? <Delete className="h-5 w-5" /> : key}
          </button>
        ))}
      </div>
    </div>
  );
}
