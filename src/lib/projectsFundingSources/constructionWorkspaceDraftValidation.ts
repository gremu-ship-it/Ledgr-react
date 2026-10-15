/**
 * Validation for the in-memory Construction workspace workflow only.
 *
 * The separate constructionProjectSetupValidation helper models a fully
 * populated proposed persistence payload. This page has no persistence path,
 * so it intentionally does not inherit those unapproved domain requirements,
 * business-ID rules, or duplicate-code claims. The project name is required
 * only so a local draft can be identified in this tab; all other details are
 * optional notes.
 */
export const CONSTRUCTION_WORKSPACE_STATUSES = [
  'draft',
  'active',
  'needs_attention',
  'completed',
] as const;

export type ConstructionWorkspaceStatus = (typeof CONSTRUCTION_WORKSPACE_STATUSES)[number];

export const CONSTRUCTION_WORKSPACE_STATUS_LABELS: Record<ConstructionWorkspaceStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  needs_attention: 'Needs attention',
  completed: 'Completed',
};

export interface ConstructionWorkspaceDraftFields {
  projectCode: string;
  projectName: string;
  clientName: string;
  siteName: string;
  siteLocation: string;
  contractValue: string;
  contractCurrency: string;
  approvedBudget: string;
  budgetCurrency: string;
  plannedStartDate: string;
  plannedCompletionDate: string;
  projectManagerName: string;
  status: ConstructionWorkspaceStatus;
}

export type ConstructionWorkspaceDraftField = keyof ConstructionWorkspaceDraftFields;
export type ConstructionWorkspaceDraftErrors = Partial<Record<ConstructionWorkspaceDraftField, string>>;

export interface ConstructionWorkspaceDraftValidationResult {
  values: ConstructionWorkspaceDraftFields | null;
  errors: ConstructionWorkspaceDraftErrors;
}

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECIMAL_AMOUNT_PATTERN = /^(?:\d+(?:\.\d*)?|\.\d+)$/;
const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;

function isValidCalendarDate(value: string): boolean {
  const match = DATE_KEY_PATTERN.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function validateOptionalAmount(
  amount: string,
  currency: string,
  label: string,
  amountField: 'contractValue' | 'approvedBudget',
  currencyField: 'contractCurrency' | 'budgetCurrency',
  errors: ConstructionWorkspaceDraftErrors,
): void {
  const trimmedAmount = amount.trim();
  const trimmedCurrency = currency.trim().toUpperCase();

  if (trimmedAmount) {
    const parsed = DECIMAL_AMOUNT_PATTERN.test(trimmedAmount) ? Number(trimmedAmount) : Number.NaN;
    if (!Number.isFinite(parsed) || parsed < 0) {
      errors[amountField] = `${label} must be a finite amount of zero or more.`;
    }
    if (!trimmedCurrency) {
      errors[currencyField] = `Add a currency code when entering ${label.toLowerCase()}.`;
    }
  }

  if (trimmedCurrency && !CURRENCY_CODE_PATTERN.test(trimmedCurrency)) {
    errors[currencyField] = 'Enter a three-letter currency code.';
  }
}

/** Validate the local draft form without claiming server-side project rules. */
export function validateConstructionWorkspaceDraft(
  draft: ConstructionWorkspaceDraftFields,
): ConstructionWorkspaceDraftValidationResult {
  const errors: ConstructionWorkspaceDraftErrors = {};
  const projectName = draft.projectName.trim();
  const plannedStartDate = draft.plannedStartDate.trim();
  const plannedCompletionDate = draft.plannedCompletionDate.trim();

  if (!projectName) errors.projectName = 'Project name is required to keep a draft in this tab.';

  validateOptionalAmount(
    draft.contractValue,
    draft.contractCurrency,
    'Contract value',
    'contractValue',
    'contractCurrency',
    errors,
  );
  validateOptionalAmount(
    draft.approvedBudget,
    draft.budgetCurrency,
    'Approved budget',
    'approvedBudget',
    'budgetCurrency',
    errors,
  );

  if (plannedStartDate && !isValidCalendarDate(plannedStartDate)) {
    errors.plannedStartDate = 'Planned start date must be a valid calendar date.';
  }
  if (plannedCompletionDate && !isValidCalendarDate(plannedCompletionDate)) {
    errors.plannedCompletionDate = 'Planned completion date must be a valid calendar date.';
  }
  if (
    plannedStartDate
    && plannedCompletionDate
    && isValidCalendarDate(plannedStartDate)
    && isValidCalendarDate(plannedCompletionDate)
    && plannedStartDate > plannedCompletionDate
  ) {
    errors.plannedCompletionDate = 'Planned completion date must be on or after the planned start date.';
  }
  if (!CONSTRUCTION_WORKSPACE_STATUSES.includes(draft.status)) {
    errors.status = 'Choose a status for this local draft.';
  }

  if (Object.keys(errors).length > 0) return { values: null, errors };

  return {
    values: {
      projectCode: draft.projectCode.trim(),
      projectName,
      clientName: draft.clientName.trim(),
      siteName: draft.siteName.trim(),
      siteLocation: draft.siteLocation.trim(),
      contractValue: draft.contractValue.trim(),
      contractCurrency: draft.contractCurrency.trim().toUpperCase(),
      approvedBudget: draft.approvedBudget.trim(),
      budgetCurrency: draft.budgetCurrency.trim().toUpperCase(),
      plannedStartDate,
      plannedCompletionDate,
      projectManagerName: draft.projectManagerName.trim(),
      status: draft.status,
    },
    errors,
  };
}
