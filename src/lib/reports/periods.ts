export type PeriodPreset = 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'yearToDate' | 'lastYear';

export interface DateRange {
  from: string;
  to: string;
}

function isoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function previousPeriod(range: DateRange, preset: PeriodPreset | 'custom' = 'custom'): DateRange {
  const parse = (value: string): Date | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return date;
  };
  const start = parse(range.from);
  const end = parse(range.to);
  const dayMs = 24 * 60 * 60 * 1000;
  if (!start || !end || start.getTime() > end.getTime()) return { from: '', to: '' };

  const shiftMonths = (date: Date, amount: number) => {
    const targetMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
    const lastDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate();
    return new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth(), Math.min(date.getUTCDate(), lastDay)));
  };
  let priorStart: Date;
  let priorEnd: Date;
  if (preset === 'thisQuarter') {
    priorStart = shiftMonths(start, -3);
    priorEnd = shiftMonths(end, -3);
  } else if (preset === 'yearToDate' || preset === 'lastYear') {
    priorStart = shiftMonths(start, -12);
    priorEnd = shiftMonths(end, -12);
  } else if (preset === 'thisMonth') {
    priorStart = shiftMonths(start, -1);
    priorEnd = shiftMonths(end, -1);
  } else if (preset === 'lastMonth') {
    priorStart = shiftMonths(start, -1);
    priorEnd = new Date(Date.UTC(priorStart.getUTCFullYear(), priorStart.getUTCMonth() + 1, 0));
  } else {
    const lengthDays = Math.round((end.getTime() - start.getTime()) / dayMs) + 1;
    priorEnd = new Date(start.getTime() - dayMs);
    priorStart = new Date(priorEnd.getTime() - (lengthDays - 1) * dayMs);
  }
  const format = (date: Date) => isoDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return { from: format(priorStart), to: format(priorEnd) };
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
