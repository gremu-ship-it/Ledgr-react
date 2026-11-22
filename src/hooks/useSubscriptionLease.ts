import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  evaluateLease,
  refreshSubscriptionLease,
  type LeaseEvaluation,
} from '../services/subscriptionLeaseService';

const DEFAULT_EVALUATION: LeaseEvaluation = {
  status: 'NO_LEASE',
  plan: 'starter',
  operatingModels: [],
  daysRemaining: 0,
  canWrite: false,
  canRead: true,
  error: 'subscription.errors.noLease',
};

export function useSubscriptionLease(businessId: string | null | undefined) {
  const [refreshTick, setRefreshTick] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const evaluation = useMemo<LeaseEvaluation>(() => {
    void refreshTick;
    return businessId ? evaluateLease(businessId) : DEFAULT_EVALUATION;
  }, [businessId, refreshTick]);

  const reevaluate = useCallback(() => {
    setRefreshTick((tick) => tick + 1);
  }, []);

  const refresh = useCallback(async () => {
    if (!businessId) return null;
    setIsRefreshing(true);
    try {
      const lease = await refreshSubscriptionLease(businessId);
      setRefreshTick((tick) => tick + 1);
      return lease;
    } finally {
      setIsRefreshing(false);
    }
  }, [businessId]);

  useEffect(() => {
    if (!businessId) return;

    const handleOnline = () => {
      void refresh().catch(() => {
        // Silent background refresh on reconnect; keep current evaluation if it fails
      });
    };

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [businessId, refresh]);

  return {
    evaluation,
    isRefreshing,
    refresh,
    reevaluate,
  };
}
