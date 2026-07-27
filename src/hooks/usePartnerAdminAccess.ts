import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/store/useAppStore';
import { useIsPlatformAdmin } from '@/hooks/useIsPlatformAdmin';
import { PartnerRepository } from '@/dal/repositories/PartnerRepository';
import type { Partner } from '@/types/partners';

export interface PartnerAdminAccess {
  /** Ledgr staff — can create partners and invoice them. */
  isPlatformAdmin: boolean;
  /** Bank/MFI staff — read-only over their clients, can edit their own tenant. */
  isPartnerAdmin: boolean;
  /** Partners this user administers (empty for platform admins unless linked). */
  partners: Partner[];
  loading: boolean;
  canAccessPortal: boolean;
  canManage: (partnerId: string) => boolean;
}

/**
 * Who may use the partner admin portal (admin.ledgr.com):
 *   • platform admins  → every partner
 *   • partner admins   → only the partners they're linked to
 */
export function usePartnerAdminAccess(): PartnerAdminAccess {
  const isPlatformAdmin = useIsPlatformAdmin();
  const userId = useAppStore((s) => s.currentUser?.id);
  const isAuthLoading = useAppStore((s) => s.isAuthLoading);

  const { data: partners = [], isLoading } = useQuery({
    queryKey: ['partner-admin-memberships', userId],
    queryFn: () => PartnerRepository.getForAdminUser(userId!),
    enabled: Boolean(userId),
    staleTime: 5 * 60_000,
  });

  const isPartnerAdmin = partners.length > 0;

  return {
    isPlatformAdmin,
    isPartnerAdmin,
    partners,
    loading: isAuthLoading || (Boolean(userId) && isLoading),
    canAccessPortal: isPlatformAdmin || isPartnerAdmin,
    canManage: (partnerId: string) =>
      isPlatformAdmin || partners.some((p) => p.id === partnerId),
  };
}
