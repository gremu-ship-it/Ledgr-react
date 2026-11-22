import { supabase } from '../lib/supabase';

export interface LeasePayload {
  business_id: string;
  issued_to_user: string;
  plan: string;
  operating_models: string[];
  issued_at: number; // epoch in seconds
  valid_until: number; // epoch in seconds
  grace_until: number; // epoch in seconds
}

export interface SubscriptionLease {
  payload: LeasePayload;
  signature: string;
  algorithm: string;
}

export type LeaseStatus =
  | 'ACTIVE'
  | 'GRACE_PERIOD'
  | 'EXPIRED'
  | 'CLOCK_TAMPERED'
  | 'NO_LEASE';

export interface LeaseEvaluation {
  status: LeaseStatus;
  plan: string;
  operatingModels: string[];
  daysRemaining: number;
  canWrite: boolean;
  canRead: boolean;
  error?: string;
}

const LEASE_STORAGE_KEY_PREFIX = '_ledgr_sub_lease_';
const WATERMARK_STORAGE_KEY_PREFIX = '_ledgr_clock_watermark_';

/**
 * Updates monotonic watermark to prevent system clock rollback.
 */
export function recordClockWatermark(businessId: string): boolean {
  const now = Math.floor(Date.now() / 1000);
  const key = `${WATERMARK_STORAGE_KEY_PREFIX}${businessId}`;
  const storedWatermark = Number(localStorage.getItem(key) || '0');

  if (now < storedWatermark - 60) {
    // Clock moved backwards by more than 1 minute -> Tampering detected
    return false;
  }

  // Update watermark
  localStorage.setItem(key, String(Math.max(now, storedWatermark)));
  return true;
}

/**
 * Stores lease locally in browser storage.
 */
export function storeLocalLease(businessId: string, lease: SubscriptionLease): void {
  const key = `${LEASE_STORAGE_KEY_PREFIX}${businessId}`;
  localStorage.setItem(key, JSON.stringify(lease));
  recordClockWatermark(businessId);
}

/**
 * Retrieves locally cached lease.
 */
export function getLocalLease(businessId: string): SubscriptionLease | null {
  const key = `${LEASE_STORAGE_KEY_PREFIX}${businessId}`;
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SubscriptionLease;
  } catch {
    return null;
  }
}

/**
 * Evaluates current local lease state offline.
 */
export function evaluateLease(businessId: string): LeaseEvaluation {
  // 1. Check clock watermark
  const isClockValid = recordClockWatermark(businessId);
  if (!isClockValid) {
    return {
      status: 'CLOCK_TAMPERED',
      plan: 'starter',
      operatingModels: [],
      daysRemaining: 0,
      canWrite: false,
      canRead: true,
      error: 'subscription.errors.clockTampered',
    };
  }

  // 2. Fetch local lease
  const lease = getLocalLease(businessId);
  if (!lease || !lease.payload) {
    return {
      status: 'NO_LEASE',
      plan: 'starter',
      operatingModels: [],
      daysRemaining: 0,
      canWrite: false,
      canRead: true,
      error: 'subscription.errors.noLease',
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = lease.payload;

  // 3. Check expiration thresholds
  if (now <= payload.valid_until) {
    const secondsRemaining = payload.valid_until - now;
    const daysRemaining = Math.ceil(secondsRemaining / 86400);
    return {
      status: 'ACTIVE',
      plan: payload.plan,
      operatingModels: payload.operating_models,
      daysRemaining,
      canWrite: true,
      canRead: true,
    };
  }

  if (now <= payload.grace_until) {
    const secondsRemaining = payload.grace_until - now;
    const daysRemaining = Math.ceil(secondsRemaining / 86400);
    return {
      status: 'GRACE_PERIOD',
      plan: payload.plan,
      operatingModels: payload.operating_models,
      daysRemaining,
      canWrite: true,
      canRead: true,
      error: 'subscription.errors.gracePeriodWarning',
    };
  }

  return {
    status: 'EXPIRED',
    plan: payload.plan,
    operatingModels: payload.operating_models,
    daysRemaining: 0,
    canWrite: false,
    canRead: true,
    error: 'subscription.errors.leaseExpired',
  };
}

/**
 * Fetches fresh signed lease from Supabase and caches it locally.
 */
export async function refreshSubscriptionLease(businessId: string): Promise<SubscriptionLease> {
  const { data, error } = await supabase.rpc('issue_subscription_lease' as never, {
    p_business_id: businessId,
  } as never);

  if (error) {
    throw error;
  }

  const lease = data as SubscriptionLease;
  storeLocalLease(businessId, lease);
  return lease;
}
