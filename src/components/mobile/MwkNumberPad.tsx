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
      <div className="mb-6 text-center">
        <p className="text-xs font-medium uppercase tracking-wider text-gray-400">Amount</p>
        <p className={`mt-1 text-4xl font-bold tracking-tight ${value ? 'text-gray-900' : 'text-gray-300'}`}>
          {display}
        </p>
      </div>

      {/* Number pad */}
      <div className="grid w-full max-w-xs grid-cols-3 gap-3">
        {keys.flat().map((key) => (
          <button
            key={key}
            onClick={() => handleKey(key)}
            className={`flex h-14 items-center justify-center rounded-2xl text-xl font-semibold transition-all active:scale-95 ${
              key === 'del'
                ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                : 'bg-gray-50 text-gray-900 hover:bg-gray-100'
            }`}
          >
            {key === 'del' ? <Delete className="h-5 w-5" /> : key}
          </button>
        ))}
      </div>
    </div>
  );
}