import type { ConstructionProjectInput } from '@/dal/types/construction';

export interface ConstructionProjectFormFields {
  name: string;
  client_name: string;
  contract_sum: string;
  retention_pct: string;
  budget: string;
  start_date: string;
  end_date: string;
}

export type ConstructionProjectFormErrors = Partial<Record<keyof ConstructionProjectFormFields, string>>;

export interface ConstructionProjectValidationResult {
  values: ConstructionProjectInput | null;
  errors: ConstructionProjectFormErrors;
}

function readNonNegativeNumber(value: string): number | null {
  if (!/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

export function validateConstructionProject(
  fields: ConstructionProjectFormFields,
): ConstructionProjectValidationResult {
  const errors: ConstructionProjectFormErrors = {};
  const name = fields.name.trim();
  const clientName = fields.client_name.trim();
  const contractSum = readNonNegativeNumber(fields.contract_sum);
  const retentionPct = readNonNegativeNumber(fields.retention_pct);
  const budget = readNonNegativeNumber(fields.budget);

  if (!name) errors.name = 'construction.validation.nameRequired';
  if (!clientName) errors.client_name = 'construction.validation.clientRequired';
  if (contractSum === null) errors.contract_sum = 'construction.validation.amountNonNegative';
  if (retentionPct === null || retentionPct > 100) errors.retention_pct = 'construction.validation.retentionRange';
  if (budget === null) errors.budget = 'construction.validation.amountNonNegative';
  if (fields.start_date && !isCalendarDate(fields.start_date)) {
    errors.start_date = 'construction.validation.dateInvalid';
  }
  if (fields.end_date && !isCalendarDate(fields.end_date)) {
    errors.end_date = 'construction.validation.dateInvalid';
  }
  if (fields.start_date && fields.end_date && fields.start_date > fields.end_date) {
    errors.end_date = 'construction.validation.dateOrder';
  }

  if (Object.keys(errors).length > 0) return { values: null, errors };
  return {
    values: {
      name,
      client_name: clientName,
      contract_sum: contractSum!,
      retention_pct: retentionPct!,
      budget: budget!,
      start_date: fields.start_date || null,
      end_date: fields.end_date || null,
    },
    errors,
  };
}
