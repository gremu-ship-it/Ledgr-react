export const INVOICE_TEMPLATES = {
  professional: {
    name: 'Professional',
    fields: ['project_code', 'lpo_number'],
    style: 'border-t-4 border-brand-500',
  },
  minimal: {
    name: 'Minimal',
    fields: [],
    style: 'border border-gray-200',
  },
  ngo: {
    name: 'NGO / Donor',
    fields: ['project_code', 'donor_reference'],
    style: 'border-l-4 border-emerald-500',
  },
  government: {
    name: 'Government',
    fields: ['lpo_number', 'contract_number'],
    style: 'border-l-4 border-amber-500',
  },
} as const;

export type InvoiceTemplate = keyof typeof INVOICE_TEMPLATES;