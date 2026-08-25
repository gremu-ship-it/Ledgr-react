export interface NotificationScope {
  businessId?: string | null;
  userId: string | null;
  branchId?: string | null;
}

export function notificationMatchesContext(
  notification: NotificationScope,
  businessId: string | null,
  userId: string | null,
  branchId?: string | null,
): boolean {
  if (notification.userId !== userId) return false;
  if ((notification.businessId ?? null) !== businessId) return false;
  return branchId === undefined || (notification.branchId ?? null) === branchId;
}
