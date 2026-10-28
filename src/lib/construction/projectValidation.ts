import type { ProjectInput } from '@/dal/repositories/ProjectRepository';

export function validateProject(input: ProjectInput): string | null {
  if (!input.name.trim() || !input.client_name.trim()) return 'required';
  if (
    [input.contract_sum, input.budget, input.retention_pct].some(
      (n) =>
        !Number.isFinite(n) ||
        n < 0 ||
        Math.abs(n * 100 - Math.round(n * 100)) > 0.00001,
    ) ||
    input.retention_pct > 100
  )
    return 'amounts';
  if (input.start_date && input.end_date && input.start_date > input.end_date)
    return 'dates';
  return null;
}
