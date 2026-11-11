import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/store/useAppStore';
import { partnerPortalRepository } from '@/dal/repositories/PartnerPortalRepository';
import { clearPartnerClientContext, readPartnerClientContext, resolveOriginalBusiness, subscribePartnerClientContext, type PartnerClientContextSession } from './partnerClientContext';

export function usePartnerClientContext() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const currentUser = useAppStore((state) => state.currentUser);
  const businesses = useAppStore((state) => state.businesses);
  const currentBusiness = useAppStore((state) => state.currentBusiness);
  const setCurrentBusiness = useAppStore((state) => state.setCurrentBusiness);
  const [session, setSession] = useState<PartnerClientContextSession | null>(() => readPartnerClientContext());
  const [validatedFor, setValidatedFor] = useState<string | null>(null);

  useEffect(() => subscribePartnerClientContext(() => {
    setSession(readPartnerClientContext());
    setValidatedFor(null);
  }), []);

  const validationKey = currentUser && session
    ? `${currentUser.id}:${session.partnerId}:${session.businessId}`
    : '';
  const isRestoring = Boolean(session && (
    !currentUser ||
    currentBusiness?.business?.id !== session.businessId ||
    currentBusiness.role !== 'viewer' ||
    validatedFor !== validationKey
  ));

  useEffect(() => {
    if (!session) return;
    if (!currentUser) {
      clearPartnerClientContext();
      return;
    }

    const key = `${currentUser.id}:${session.partnerId}:${session.businessId}`;
    if (validatedFor === key &&
      currentBusiness?.business?.id === session.businessId && currentBusiness.role === 'viewer') return;

    let cancelled = false;
    void Promise.resolve()
      .then(() => partnerPortalRepository.getClientBusiness(session.partnerId, session.businessId))
      .then((business) => {
        if (cancelled) return;
        setValidatedFor(key);
        setCurrentBusiness({ business, role: 'viewer' });
      })
      .catch(() => {
        if (cancelled) return;
        const original = resolveOriginalBusiness(session, businesses);
        setCurrentBusiness(original);
        clearPartnerClientContext();
        navigate(session.returnTo, { replace: true, state: { partnerContextError: t('partner.contextAccessRevoked') } });
      });
    return () => { cancelled = true; };
  }, [session, currentUser, currentBusiness?.business?.id, currentBusiness?.role, businesses, navigate, setCurrentBusiness, t, validatedFor]);

  const exitContext = useCallback(() => {
    if (!session) return;
    const returnTo = session.returnTo;
    const original = resolveOriginalBusiness(session, businesses);
    clearPartnerClientContext();
    setCurrentBusiness(original);
    navigate(returnTo, { replace: true });
  }, [session, businesses, setCurrentBusiness, navigate]);

  return { session, isRestoring, exitContext };
}
