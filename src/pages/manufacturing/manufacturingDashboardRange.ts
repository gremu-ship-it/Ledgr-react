import type { DashboardRange } from '@/dal/repositories/ManufacturingDashboardRepository';

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Build the current-month comparison range used by the manufacturing dashboard. */
export function getDefaultManufacturingDashboardRange(now = new Date()): DashboardRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(today.getFullYear(), today.getMonth(), 1);
  const spanDays = Math.max(1, Math.ceil((today.getTime() - start.getTime()) / 86_400_000) + 1);
  const previousEnd = new Date(start);
  previousEnd.setDate(previousEnd.getDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setDate(previousStart.getDate() - spanDays + 1);

  return {
    startDate: dateKey(start),
    endDate: dateKey(today),
    previousStartDate: dateKey(previousStart),
    previousEndDate: dateKey(previousEnd),
    granularity: 'day',
  };
}
