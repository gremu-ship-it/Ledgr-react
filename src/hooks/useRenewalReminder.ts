import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { pushSubscriptionRenewalReminder } from '@/lib/notifications';

const THRESHOLDS_DAYS = [7, 3, 1] as const;
const STORAGE_KEY = 'ledgr-renewal-reminders-shown';

function daysUntil(iso: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = new Date(iso);
  expiry.setHours(0, 0, 0, 0);
  return Math.round((expiry.getTime() - today.getTime()) / msPerDay);
}

function alreadyShown(key: string): boolean {
  try {
    const shown: string[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return shown.includes(key);
  } catch {
    return false;
  }
}

function markShown(key: string) {
  try {
    const shown: string[] = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    // Keep the list bounded — old (business, expiry, threshold) combos are
    // harmless clutter but no need to grow forever.
    const next = [...shown, key].slice(-100);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable (private browsing, etc.) — reminder will
    // just show again next load, which is a harmless degradation.
  }
}

/**
 * Client-side companion to the send-renewal-reminders Edge Function's
 * email: pushes a bell notification when the current business's paid plan
 * is within 7, 3, or 1 day(s) of expiring. Only fires once per
 * (business, expiry date, threshold) combination per browser, via
 * localStorage — the email is the channel of record (reaches the owner
 * even when logged out); this is just an in-app reminder for whoever's
 * actively using the app.
 */
export function useRenewalReminder() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;

  const { data: business } = useQuery({
    queryKey: ['business', businessId],
    queryFn: () => repos.business.findById(businessId!),
    enabled: !!businessId,
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    if (!businessId || !business) return;
    const planTier = business.plan_tier;
    const expiresAt = business.plan_expires_at;
    if (!planTier || planTier === 'free' || !expiresAt) return;

    const remaining = daysUntil(expiresAt);
    const threshold = THRESHOLDS_DAYS.find((d) => d === remaining);
    if (threshold === undefined) return;

    const key = `${businessId}:${expiresAt}:${threshold}`;
    if (alreadyShown(key)) return;

    const planName = planTier.charAt(0).toUpperCase() + planTier.slice(1);
    const expiresOn = new Date(expiresAt).toLocaleDateString('en-MW', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    pushSubscriptionRenewalReminder(planName, threshold, expiresOn);
    markShown(key);
  }, [businessId, business]);
}
