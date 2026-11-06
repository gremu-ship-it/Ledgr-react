import type { BusinessMembership } from '@/types';

export interface PartnerClientContextSession {
  version: 1;
  partnerId: string;
  businessId: string;
  businessName: string;
  returnTo: string;
  originalBusinessId: string | null;
  enteredAt: string;
}

const STORAGE_KEY = 'ledgr.partner-client-context.v1';
const CHANGE_EVENT = 'ledgr:partner-client-context-change';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readPartnerClientContext(): PartnerClientContextSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PartnerClientContextSession>;
    if (
      value.version !== 1 ||
      typeof value.partnerId !== 'string' || !UUID_PATTERN.test(value.partnerId) ||
      typeof value.businessId !== 'string' || !UUID_PATTERN.test(value.businessId) ||
      typeof value.businessName !== 'string' ||
      typeof value.returnTo !== 'string' || !value.returnTo.startsWith(`/partner-admin/partners/${value.partnerId}/clients`) ||
      (value.originalBusinessId !== null && (typeof value.originalBusinessId !== 'string' || !UUID_PATTERN.test(value.originalBusinessId))) ||
      typeof value.enteredAt !== 'string'
    ) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return value as PartnerClientContextSession;
  } catch {
    return null;
  }
}

export function savePartnerClientContext(session: PartnerClientContextSession): void {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function clearPartnerClientContext(): void {
  window.sessionStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribePartnerClientContext(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener('storage', listener);
  };
}

export function resolveOriginalBusiness(
  session: PartnerClientContextSession,
  memberships: BusinessMembership[],
): BusinessMembership | null {
  if (!session.originalBusinessId) return null;
  return memberships.find((membership) => membership.business?.id === session.originalBusinessId) ?? null;
}
