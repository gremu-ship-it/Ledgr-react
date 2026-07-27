import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

interface Props {
  value: string;
  onChange: (currency: string) => void;
  disabled?: boolean;
  className?: string;
}

const FALLBACK_CURRENCIES = [
  { code: 'MWK', name: 'Malawian Kwacha', is_primary: true },
  { code: 'ZMW', name: 'Zambian Kwacha', is_primary: true },
  { code: 'TZS', name: 'Tanzanian Shilling', is_primary: true },
  { code: 'MZN', name: 'Mozambican Metical', is_primary: true },
  { code: 'USD', name: 'US Dollar', is_primary: true },
  { code: 'EUR', name: 'Euro', is_primary: true },
  { code: 'GBP', name: 'British Pound', is_primary: true },
  { code: 'ZAR', name: 'South African Rand', is_primary: true },
];

export function CurrencySelector({ value, onChange, disabled, className }: Props) {
  const { data: currencies = FALLBACK_CURRENCIES } = useQuery({
    queryKey: ['currencies'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('currencies')
        .select('code, name, is_primary')
        .eq('is_active', true)
        .order('is_primary', { ascending: false })
        .order('code');
      if (error) return FALLBACK_CURRENCIES;
      return data?.length ? data : FALLBACK_CURRENCIES;
    },
    staleTime: 1000 * 60 * 60, // 1 hour
  });

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={`rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100 ${className || ''}`}
    >
      {currencies.map((c) => (
        <option key={c.code} value={c.code}>
          {c.code} — {c.name}
        </option>
      ))}
    </select>
  );
}
