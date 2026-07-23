import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppStore } from '@/store/useAppStore';
import { repos } from '@/lib/repositories';
import { applyBrandColors, resetBrandColors } from '@/lib/brandColors';

const DEFAULT_BRAND_COLOR = '#0F766E';

/**
 * Hook that fetches the current business data and applies the brand color
 * as CSS custom properties on `:root`. Also exposes business-level branding
 * data (logo_url, brand_color) for use in components.
 */
export function useBrandTheme() {
  const currentBusiness = useAppStore((s) => s.currentBusiness);
  const businessId = currentBusiness?.business?.id;

  const { data: business } = useQuery({
    queryKey: ['business-brand', businessId],
    queryFn: () => repos.business.findById(businessId!),
    enabled: Boolean(businessId),
    staleTime: 5 * 60_000, // 5 minutes
  });

  const brandColor = business?.brand_color ?? DEFAULT_BRAND_COLOR;
  const logoUrl = business?.logo_url ?? null;
  const businessName = business?.name ?? currentBusiness?.business?.name ?? 'Ledgr';
  const tradingName = business?.trading_name ?? null;

  useEffect(() => {
    if (brandColor) {
      applyBrandColors(brandColor);
    } else {
      resetBrandColors();
    }

    return () => {
      resetBrandColors();
    };
  }, [brandColor]);

  return {
    brandColor,
    logoUrl,
    businessName,
    tradingName,
    business,
  };
}
