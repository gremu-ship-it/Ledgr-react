// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-US' } }) }));
vi.mock('recharts', () => {
  const Stub = () => null;
  return { XAxis: Stub, YAxis: Stub, CartesianGrid: Stub, Tooltip: Stub, ResponsiveContainer: Stub, Legend: Stub, Area: Stub, AreaChart: Stub };
});

import { IncomeExpenseChart } from '@/components/dashboard/IncomeExpenseChart';

describe('IncomeExpenseChart accessibility', () => {
  it('exposes a translated text table and dynamic currency alongside the visual trend', () => {
    render(<IncomeExpenseChart currencyCode="USD" data={[{ month: 'Nov 26', income: 1234.5, expenses: 500 }]} />);
    expect(screen.getByRole('group', { name: 'dashboard.chart.accessibleLabel' })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'dashboard.chart.accessibleSummary' })).toBeTruthy();
    expect(screen.getAllByText(/USD/)).toHaveLength(2);
  });
});
