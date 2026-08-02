import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { subscriptionPaymentService, type VerifyPaymentResult } from '@/services/billing/SubscriptionPaymentService';

export type PaymentReturnState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'success'; planTier: string }
  | { phase: 'failed'; message?: string }
  | { phase: 'timeout' };

const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 15; // ~45s — generous enough for the webhook/gateway round trip

/**
 * Handles the return leg of a PayChangu checkout: reads the `payment`
 * (tx_ref) query param left by CheckoutModal's return_url, verifies it
 * server-side (re-querying PayChangu, never trusting the URL alone), and
 * polls briefly if the gateway hasn't settled yet. Once resolved, it
 * invalidates the business/usage queries so the rest of the UI (plan
 * badge, usage meter, BillingTab) picks up the new tier immediately.
 */
export function usePaymentReturnStatus(businessId: string | undefined) {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [state, setState] = useState<PaymentReturnState>({ phase: 'idle' });
  const attemptedRef = useRef<string | null>(null);

  useEffect(() => {
    const txRef = searchParams.get('payment') || searchParams.get('tx_ref');
    if (!txRef || !businessId) return;
    if (attemptedRef.current === txRef) return; // already handling this tx_ref
    attemptedRef.current = txRef;

    let cancelled = false;
    let pollCount = 0;

    setState({ phase: 'checking' });

    const finish = (result: VerifyPaymentResult) => {
      if (cancelled) return;
      if (result.status === 'success') {
        setState({ phase: 'success', planTier: result.plan_tier || '' });
        queryClient.invalidateQueries({ queryKey: ['business', businessId] });
        queryClient.invalidateQueries({ queryKey: ['usage', businessId] });
      } else if (result.status === 'failed' || result.status === 'cancelled') {
        setState({ phase: 'failed', message: result.message });
      }
      // Clean the ?payment= param out of the URL so refreshing doesn't
      // re-trigger verification.
      const next = new URLSearchParams(searchParams);
      next.delete('payment');
      next.delete('tx_ref');
      next.delete('status');
      next.delete('transaction_id');
      setSearchParams(next, { replace: true });
    };

    const poll = async () => {
      try {
        const result = await subscriptionPaymentService.verifyPayment(txRef);
        if (result.status === 'pending') {
          pollCount += 1;
          if (pollCount >= MAX_POLLS) {
            if (!cancelled) setState({ phase: 'timeout' });
            return;
          }
          setTimeout(poll, POLL_INTERVAL_MS);
          return;
        }
        finish(result);
      } catch (err) {
        if (!cancelled) {
          setState({ phase: 'failed', message: err instanceof Error ? err.message : 'Could not verify payment.' });
        }
      }
    };

    poll();

    return () => {
      cancelled = true;
    };
  }, [businessId, searchParams, queryClient, setSearchParams]);

  const dismiss = () => setState({ phase: 'idle' });

  return { state, dismiss };
}
