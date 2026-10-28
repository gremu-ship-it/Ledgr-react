import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { periodForPreset, type DateRange, type PeriodPreset } from '@/lib/reports/periods';

interface PeriodPickerProps {
  value: DateRange;
  onChange: (from: string, to: string) => void;
  onPresetChange?: (preset: PeriodPreset | 'custom') => void;
}

const PRESETS: { key: PeriodPreset; labelKey: string }[] = [
  { key: 'thisMonth', labelKey: 'reports.shared.thisMonth' },
  { key: 'lastMonth', labelKey: 'reports.shared.lastMonth' },
  { key: 'thisQuarter', labelKey: 'reports.shared.thisQuarter' },
  { key: 'yearToDate', labelKey: 'reports.shared.yearToDate' },
  { key: 'lastYear', labelKey: 'reports.shared.lastYear' },
];

export function PeriodPicker({ value, onChange, onPresetChange }: PeriodPickerProps) {
  const { t } = useTranslation();
  const [activePreset, setActivePreset] = useState<PeriodPreset | 'custom' | null>('thisMonth');
  const invalidRange = Boolean(value.from && value.to && value.from > value.to);

  const selectPreset = (preset: PeriodPreset) => {
    const range = periodForPreset(preset);
    setActivePreset(preset);
    onPresetChange?.(preset);
    onChange(range.from, range.to);
  };

  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-sm font-semibold text-gray-800">{t('reports.shared.period')}</legend>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map(({ key, labelKey }) => (
          <button
            key={key}
            type="button"
            aria-pressed={activePreset === key}
            onClick={() => selectPreset(key)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
              activePreset === key
                ? 'border-brand-600 bg-brand-50 text-brand-700'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            {t(labelKey)}
          </button>
        ))}
        <span className="self-center px-1 text-xs text-gray-400">{t('reports.shared.custom')}</span>
        <label className="sr-only" htmlFor="trial-balance-date-from">{t('reports.shared.dateFrom')}</label>
        <input
          id="trial-balance-date-from"
          aria-label={t('reports.shared.dateFrom')}
          type="date"
          value={value.from}
          onChange={(event) => {
            setActivePreset('custom');
            onPresetChange?.('custom');
            onChange(event.target.value, value.to);
          }}
          className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <span className="self-center text-xs text-gray-400">{t('reports.shared.toSeparator')}</span>
        <label className="sr-only" htmlFor="trial-balance-date-to">{t('reports.shared.dateTo')}</label>
        <input
          id="trial-balance-date-to"
          aria-label={t('reports.shared.dateTo')}
          type="date"
          value={value.to}
          onChange={(event) => {
            setActivePreset('custom');
            onPresetChange?.('custom');
            onChange(value.from, event.target.value);
          }}
          className="rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
      </div>
      {invalidRange && <p role="alert" className="mt-2 text-xs text-red-600">{t('reports.shared.invalidDateRange')}</p>}
    </fieldset>
  );
}
