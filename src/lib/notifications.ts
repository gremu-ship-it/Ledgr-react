import { useNotificationStore } from '@/store/useNotificationStore';

export function pushSofpBalanceWarning(netAssets: string, totalEquity: string) {
  const { addNotification } = useNotificationStore.getState();
  
  addNotification({
    type: 'warning',
    title: 'Statement of Financial Position imbalance',
    message: `Net Assets (${netAssets}) does not equal Total Equity (${totalEquity}). Run a period close or check for unposted entries.`,
    link: '/reports',
  });
}

export function pushAuditChainWarning(violations: number) {
  const { addNotification } = useNotificationStore.getState();
  
  addNotification({
    type: 'error',
    title: 'Audit chain integrity issue',
    message: `${violations} integrity violation${violations === 1 ? '' : 's'} detected in the audit log.`,
    link: '/audit',
  });
}

export function pushAuditVerified() {
  const { addNotification } = useNotificationStore.getState();
  
  addNotification({
    type: 'success',
    title: 'Audit chain verified',
    message: 'Hash chain is intact. All entries are valid.',
    link: '/audit',
  });
}

// ──────────────────────────────────────────────────────────────
// Bank Reconciliation
// ──────────────────────────────────────────────────────────────
export function pushBankReconciliationComplete(accountName: string, matchedCount: number) {
  const { addNotification } = useNotificationStore.getState();
  
  addNotification({
    type: 'success',
    title: 'Bank reconciliation completed',
    message: `${matchedCount} transactions reconciled for ${accountName}.`,
    link: '/bank-reconcile',
  });
}

export function pushBankStatementImported(accountName: string, lineCount: number) {
  const { addNotification } = useNotificationStore.getState();
  
  addNotification({
    type: 'info',
    title: 'Bank statement imported',
    message: `${lineCount} lines imported for ${accountName}.`,
    link: '/bank-reconcile',
  });
}

// ──────────────────────────────────────────────────────────────
// Period Management
// ──────────────────────────────────────────────────────────────
export function pushPeriodClosed(periodName: string) {
  const { addNotification } = useNotificationStore.getState();
  
  addNotification({
    type: 'success',
    title: 'Period closed',
    message: `Period "${periodName}" has been successfully closed.`,
    link: '/periods',
  });
}

export function pushPeriodCloseFailed(periodName: string, reason: string) {
  const { addNotification } = useNotificationStore.getState();
  
  addNotification({
    type: 'error',
    title: 'Period close failed',
    message: `Could not close "${periodName}": ${reason}`,
    link: '/periods',
  });
}

// ──────────────────────────────────────────────────────────────
// Journal / Accounting
// ──────────────────────────────────────────────────────────────
export function pushJournalReversed(entryNumber: string) {
  const { addNotification } = useNotificationStore.getState();
  
  addNotification({
    type: 'warning',
    title: 'Journal entry reversed',
    message: `Entry ${entryNumber} has been reversed.`,
    link: '/journals',
  });
}

export function pushUnpostedEntriesWarning(count: number) {
  const { addNotification } = useNotificationStore.getState();
  
  addNotification({
    type: 'warning',
    title: 'Unposted journal entries',
    message: `You have ${count} unposted journal entry${count === 1 ? '' : 'ies'}.`,
    link: '/journals',
  });
}

// ──────────────────────────────────────────────────────────────
// Tax & Compliance
// ──────────────────────────────────────────────────────────────
export function pushTaxRemittanceDue(amount: string, dueDate: string) {
  const { addNotification } = useNotificationStore.getState();
  
  addNotification({
    type: 'warning',
    title: 'Tax remittance due',
    message: `MWK ${amount} due by ${dueDate}.`,
    link: '/tax',
  });
}

// ──────────────────────────────────────────────────────────────
// Billing / Subscription
// ──────────────────────────────────────────────────────────────
export function pushSubscriptionRenewalReminder(planName: string, daysLeft: number, expiresOn: string) {
  const { addNotification } = useNotificationStore.getState();

  addNotification({
    type: daysLeft <= 1 ? 'error' : 'warning',
    title: daysLeft <= 1 ? `${planName} plan expires tomorrow` : `${planName} plan renews soon`,
    message:
      daysLeft <= 1
        ? `Your subscription expires on ${expiresOn}. Renew now to avoid being moved back to the Free plan.`
        : `${daysLeft} days left until your subscription renews on ${expiresOn}.`,
    link: '/settings?tab=billing',
  });
}

// ──────────────────────────────────────────────────────────────
// General / System
// ──────────────────────────────────────────────────────────────
export function pushSuccess(title: string, message: string, link?: string) {
  const { addNotification } = useNotificationStore.getState();
  addNotification({ type: 'success', title, message, link });
}

export function pushInfo(title: string, message: string, link?: string) {
  const { addNotification } = useNotificationStore.getState();
  addNotification({ type: 'info', title, message, link });
}

export function pushWarning(title: string, message: string, link?: string) {
  const { addNotification } = useNotificationStore.getState();
  addNotification({ type: 'warning', title, message, link });
}

export function pushError(title: string, message: string, link?: string) {
  const { addNotification } = useNotificationStore.getState();
  addNotification({ type: 'error', title, message, link });
}

// ── Plan / Upgrade upsell ─────────────────────────────────────────────────────
export function pushUpgradeRequired(featureName: string, requiredPlan = 'Growth') {
  const { addNotification } = useNotificationStore.getState();
  addNotification({
    type: 'warning',
    title: `${featureName} requires ${requiredPlan}`,
    message: `Upgrade your plan to access ${featureName}.`,
    link: '/settings?tab=billing',
  });
}