export type PeriodPreset = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'yearToDate' | 'lastYear';

export interface DateRange {
  from: string;
  to: string;
}

function isoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function periodForPreset(preset: PeriodPreset, now = new Date()): DateRange {
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = isoDate(year, month, now.getDate());

  switch (preset) {
    case 'thisMonth':
      return { from: isoDate(year, month, 1), to: today };
    case 'lastMonth': {
      const lastMonth = new Date(year, month - 1, 1);
      const lastDay = new Date(year, month, 0).getDate();
      return {
        from: isoDate(lastMonth.getFullYear(), lastMonth.getMonth(), 1),
        to: isoDate(lastMonth.getFullYear(), lastMonth.getMonth(), lastDay),
      };
    }
    case 'thisQuarter': {
      const firstMonthOfQuarter = Math.floor(month / 3) * 3;
      return { from: isoDate(year, firstMonthOfQuarter, 1), to: today };
    }
    case 'yearToDate':
      return { from: isoDate(year, 0, 1), to: today };
    case 'lastYear':
      return { from: isoDate(year - 1, 0, 1), to: isoDate(year - 1, 11, 31) };
  }
}
