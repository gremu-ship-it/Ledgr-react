import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

interface Props {
  value: string;
  onChange: (currency: string) => void;
  disabled?: boolean;
  className?: string;
}

export function CurrencySelector({ value, onChange, disabled, className }: Props) {
  const { data: currencies = [] } = useQuery({
    queryKey: ['currencies'],
    queryFn: async () => {
      const { data } = await supabase
        .from('currencies')
        .select('code, name')
        .order('code');
      return data || [];
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