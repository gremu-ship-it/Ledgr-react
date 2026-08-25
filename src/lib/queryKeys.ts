/**
 * Tenant-scoped keys for sensitive detail records.
 *
 * List queries in the application already carry businessId. Detail queries are
 * easier to accidentally key only by a globally-looking record id, so they are
 * centralised here with the tenant as the first namespace. Database RLS remains
 * authoritative; these keys only prevent an authorised response from being
 * reused in the wrong client context.
 */
export const queryKeys = {
  journalEntry: (businessId: string, entryId: string) =>
    ['business', businessId, 'journal-entry', entryId] as const,
  accountingPeriod: (businessId: string, periodId: string) =>
    ['business', businessId, 'accounting-period', periodId] as const,
  invoiceLines: (businessId: string, invoiceId: string) =>
    ['business', businessId, 'invoice', invoiceId, 'lines'] as const,
  invoicePayments: (businessId: string, invoiceId: string) =>
    ['business', businessId, 'invoice', invoiceId, 'payments'] as const,
  contact: (businessId: string, contactId: string) =>
    ['business', businessId, 'contact', contactId] as const,
  payrollRun: (businessId: string, payrollRunId: string) =>
    ['business', businessId, 'payroll-run', payrollRunId] as const,
  transfer: (businessId: string, transferId: string) =>
    ['business', businessId, 'stock-transfer', transferId] as const,
  webhookDeliveries: (businessId: string, webhookId: string) =>
    ['business', businessId, 'webhook', webhookId, 'deliveries'] as const,
};
