import { useBrandTheme } from '@/hooks/useBrandTheme';

interface ReportHeaderProps {
  title: string;
  subtitle?: string;
  preparerName?: string;
}

/**
 * Reusable branded header for all financial reports and documents.
 * Displays business logo, name, and report title with brand colors.
 */
export function ReportHeader({ title, subtitle, preparerName }: ReportHeaderProps) {
  const { logoUrl, businessName, tradingName, business } = useBrandTheme();

  const displayName = tradingName || businessName;

  return (
    <div className="mb-6 flex items-start justify-between border-b border-gray-100 pb-4">
      <div className="flex items-start gap-4">
        {/* Business logo */}
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={displayName}
            className="h-12 w-12 shrink-0 rounded-lg object-contain"
          />
        ) : (
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-base font-bold text-white"
            style={{ backgroundColor: 'var(--color-brand-500, #0F766E)' }}
          >
            {(displayName || 'L').charAt(0).toUpperCase()}
          </div>
        )}

        {/* Business info and report title */}
        <div>
          <h1 className="text-base font-bold" style={{ color: 'var(--color-brand-700, #334155)' }}>
            {displayName}
          </h1>
          {business && (
            <div className="mt-0.5 text-xs text-gray-500">
              {business.address_line1 && (
                <span>
                  {business.address_line1}
                  {business.city ? `, ${business.city}` : ''}
                </span>
              )}
              {business.phone && <span> · {business.phone}</span>}
              {business.tpin && <div className="mt-0.5">TPIN: {business.tpin}</div>}
            </div>
          )}
          <h2 className="mt-2 text-lg font-semibold text-gray-900">{title}</h2>
          {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
          {preparerName && <p className="text-xs text-gray-400">Prepared by: {preparerName}</p>}
        </div>
      </div>
    </div>
  );
}
