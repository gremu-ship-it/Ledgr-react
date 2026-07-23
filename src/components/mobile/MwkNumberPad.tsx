import { Delete } from 'lucide-react';

interface MwkNumberPadProps {
  value: string;
  onChange: (value: string) => void;
}

export function MwkNumberPad({ value, onChange }: MwkNumberPadProps) {
  function handleKey(key: string) {
    if (key === 'del') {
      onChange(value.slice(0, -1));
      return;
    }
    if (key === '.' && value.includes('.')) return;
    if (value.split('.')[1]?.length >= 2) return;
    if (value === '0' && key !== '.') {
      onChange(key);
      return;
    }
    onChange((value || '') + key);
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

  return (
    <div className="flex flex-col items-center">
      {/* Amount display */}
      <div className="mb-8 text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">Transaction Value</p>
        <p className={`mt-2 text-5xl font-black tracking-tighter ${value ? 'text-brand-600' : 'text-gray-200'}`}>
          {display}
        </p>
      </div>

      {/* Number pad */}
      <div className="grid w-full grid-cols-3 gap-4">
        {keys.flat().map((key) => (
          <button
            key={key}
            onClick={() => handleKey(key)}
            className={`flex h-16 items-center justify-center rounded-2xl text-xl font-black transition-all active:scale-90 ${
              key === 'del'
                ? 'bg-red-50 text-red-500 shadow-sm shadow-red-500/10 ring-1 ring-red-100'
                : 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-100'
            }`}
          >
            {key === 'del' ? <Delete className="h-6 w-6" /> : key}
          </button>
        ))}
      </div>
    </div>
  );
}