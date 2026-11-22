import { useCallback, useEffect, useState } from 'react';
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
  const [evaluation, setEvaluation] = useState<LeaseEvaluation>(() =>
    businessId ? evaluateLease(businessId) : DEFAULT_EVALUATION
  );
  const [isRefreshing, setIsRefreshing] = useState(false);

  const reevaluate = useCallback(() => {
    if (!businessId) {
      setEvaluation(DEFAULT_EVALUATION);
      return;
    }
    setEvaluation(evaluateLease(businessId));
  }, [businessId]);

  const refresh = useCallback(async () => {
    if (!businessId) return null;
    setIsRefreshing(true);
    try {
      const lease = await refreshSubscriptionLease(businessId);
      setEvaluation(evaluateLease(businessId));
      return lease;
    } finally {
      setIsRefreshing(false);
    }
  }, [businessId]);

  useEffect(() => {
    reevaluate();
  }, [reevaluate]);

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
