import { useNotificationStore, type AppNotification } from '@/store/useNotificationStore';

type NotificationPayload = Omit<AppNotification, 'id' | 'timestamp' | 'read'>;
type NotificationOptions = {
  link?: string;
  businessId?: string | null;
};

function pushNotification(notification: NotificationPayload) {
  const { addNotification } = useNotificationStore.getState();
  addNotification(notification);
}

function normalizeOptions(
  linkOrOptions?: string | NotificationOptions,
  businessId?: string | null,
): NotificationOptions {
  if (typeof linkOrOptions === 'string') {
    return businessId !== undefined
      ? { link: linkOrOptions, businessId }
      : { link: linkOrOptions };
  }

  return {
    ...(linkOrOptions ?? {}),
    ...(businessId !== undefined ? { businessId } : {}),
  };
}

export function pushSofpBalanceWarning(
  netAssets: string,
  totalEquity: string,
  businessId?: string | null,
) {
  pushNotification({
    type: 'warning',
    title: 'Statement of Financial Position imbalance',
    message: `Net Assets (${netAssets}) does not equal Total Equity (${totalEquity}). Run a period close or check for unposted entries.`,
    link: '/reports',
    businessId,
  });
}

export function pushAuditChainWarning(violations: number, businessId?: string | null) {
  pushNotification({
    type: 'error',
    title: 'Audit chain integrity issue',
    message: `${violations} integrity violation${violations === 1 ? '' : 's'} detected in the audit log.`,
    link: '/audit',
    businessId,
  });
}

export function pushAuditVerified(businessId?: string | null) {
  pushNotification({
    type: 'success',
    title: 'Audit chain verified',
    message: 'Hash chain is intact. All entries are valid.',
    link: '/audit',
    businessId,
  });
}

// ──────────────────────────────────────────────────────────────
// Bank Reconciliation
// ──────────────────────────────────────────────────────────────
export function pushBankReconciliationComplete(
  accountName: string,
  matchedCount: number,
  businessId?: string | null,
) {
  pushNotification({
    type: 'success',
    title: 'Bank reconciliation completed',
    message: `${matchedCount} transactions reconciled for ${accountName}.`,
    link: '/bank-reconcile',
    businessId,
  });
}

export function pushBankStatementImported(
  accountName: string,
  lineCount: number,
  businessId?: string | null,
) {
  pushNotification({
    type: 'info',
    title: 'Bank statement imported',
    message: `${lineCount} lines imported for ${accountName}.`,
    link: '/bank-reconcile',
    businessId,
  });
}

// ──────────────────────────────────────────────────────────────
// Period Management
// ──────────────────────────────────────────────────────────────
export function pushPeriodClosed(periodName: string, businessId?: string | null) {
  pushNotification({
    type: 'success',
    title: 'Period closed',
    message: `Period "${periodName}" has been successfully closed.`,
    link: '/periods',
    businessId,
  });
}

export function pushPeriodCloseFailed(
  periodName: string,
  reason: string,
  businessId?: string | null,
) {
  pushNotification({
    type: 'error',
    title: 'Period close failed',
    message: `Could not close "${periodName}": ${reason}`,
    link: '/periods',
    businessId,
  });
}

// ──────────────────────────────────────────────────────────────
// Journal / Accounting
// ──────────────────────────────────────────────────────────────
export function pushJournalReversed(entryNumber: string, businessId?: string | null) {
  pushNotification({
    type: 'warning',
    title: 'Journal entry reversed',
    message: `Entry ${entryNumber} has been reversed.`,
    link: '/journals',
    businessId,
  });
}

export function pushUnpostedEntriesWarning(count: number, businessId?: string | null) {
  pushNotification({
    type: 'warning',
    title: 'Unposted journal entries',
    message: `You have ${count} unposted journal entry${count === 1 ? '' : 'ies'}.`,
    link: '/journals',
    businessId,
  });
}

// ──────────────────────────────────────────────────────────────
// Tax & Compliance
// ──────────────────────────────────────────────────────────────
export function pushTaxRemittanceDue(
  amount: string,
  dueDate: string,
  businessId?: string | null,
) {
  pushNotification({
    type: 'warning',
    title: 'Tax remittance due',
    message: `MWK ${amount} due by ${dueDate}.`,
    link: '/tax',
    businessId,
  });
}

// ──────────────────────────────────────────────────────────────
// Billing / Subscription
// ──────────────────────────────────────────────────────────────
export function pushSubscriptionRenewalReminder(
  planName: string,
  daysLeft: number,
  expiresOn: string,
  businessId?: string | null,
) {
  pushNotification({
    type: daysLeft <= 1 ? 'error' : 'warning',
    title: daysLeft <= 1 ? `${planName} plan expires tomorrow` : `${planName} plan renews soon`,
    message:
      daysLeft <= 1
        ? `Your subscription expires on ${expiresOn}. Renew now to avoid being moved back to the Free plan.`
        : `${daysLeft} days left until your subscription renews on ${expiresOn}.`,
    link: '/settings?tab=billing',
    businessId,
  });
}

// ──────────────────────────────────────────────────────────────
// General / System
// ──────────────────────────────────────────────────────────────
export function pushSuccess(
  title: string,
  message: string,
  linkOrOptions?: string | NotificationOptions,
  businessId?: string | null,
) {
  const { link, businessId: scopedBusinessId } = normalizeOptions(linkOrOptions, businessId);
  pushNotification({ type: 'success', title, message, link, businessId: scopedBusinessId });
}

export function pushInfo(
  title: string,
  message: string,
  linkOrOptions?: string | NotificationOptions,
  businessId?: string | null,
) {
  const { link, businessId: scopedBusinessId } = normalizeOptions(linkOrOptions, businessId);
  pushNotification({ type: 'info', title, message, link, businessId: scopedBusinessId });
}

export function pushWarning(
  title: string,
  message: string,
  linkOrOptions?: string | NotificationOptions,
  businessId?: string | null,
) {
  const { link, businessId: scopedBusinessId } = normalizeOptions(linkOrOptions, businessId);
  pushNotification({ type: 'warning', title, message, link, businessId: scopedBusinessId });
}

export function pushError(
  title: string,
  message: string,
  linkOrOptions?: string | NotificationOptions,
  businessId?: string | null,
) {
  const { link, businessId: scopedBusinessId } = normalizeOptions(linkOrOptions, businessId);
  pushNotification({ type: 'error', title, message, link, businessId: scopedBusinessId });
}

// ── Plan / Upgrade upsell ─────────────────────────────────────────────────────
export function pushUpgradeRequired(
  featureName: string,
  requiredPlan = 'Growth',
  businessId?: string | null,
) {
  pushNotification({
    type: 'warning',
    title: `${featureName} requires ${requiredPlan}`,
    message: `Upgrade your plan to access ${featureName}.`,
    link: '/settings?tab=billing',
    businessId,
  });
}
