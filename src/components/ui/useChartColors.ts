import { useAppStore } from '@/store/useAppStore';

export interface ChartColors {
  income: string;
  expenses: string;
  grid: string;
  axis: string;
  legend: string;
  brand: string;
  brandDark: string;
  revenue: string;
  grossProfit: string;
  netProfit: string;
  warning: string;
  danger: string;
  accent: string;
  surface: string;
  line: string;
  ink: string;
  sub: string;
  muted: string;
}

/**
 * Recharts colours are JS props, not classes, so they can't use Tailwind
 * `dark:` variants. Subscribe to the theme here and return literals that
 * flip with the app theme. Consumers re-render automatically on toggle.
 */
export function useChartColors(): ChartColors {
  const dark = useAppStore((s) => s.theme) === 'dark';
  return {
    income: dark ? '#2DD4A7' : '#0F766E', // emerald (lighter in dark for legibility)
    expenses: dark ? '#F05252' : '#DC2626',
    grid: dark ? '#1E2A3D' : '#F1F5F9',
    axis: dark ? '#64748B' : '#94A3B8',
    legend: dark ? '#94A3B8' : '#475569',
    brand: dark ? '#2DD4A7' : '#0F766E',
    brandDark: dark ? '#0F766E' : '#0F766E',
    // Categorical series colours for multi-series charts
    revenue: dark ? '#60A5FA' : '#3B82F6',
    grossProfit: dark ? '#A855F7' : '#7C3AED',
    netProfit: dark ? '#2DD4A7' : '#0F766E',
    warning: '#F59E0B',
    danger: '#DC2626',
    accent: '#7C3AED',
    surface: dark ? '#0E1420' : '#F1F5F9',
    line: dark ? '#1E2A3D' : '#E2E8F0',
    ink: dark ? '#EAF1FB' : '#0F172A',
    sub: dark ? '#94A3B8' : '#475569',
    muted: dark ? '#64748B' : '#94A3B8',
  };
}
