import type { ReactNode } from 'react';
import { usePartner } from '@/partner/PartnerContext';
import { usePartnerTheme } from '@/partner/usePartnerTheme';

interface AuthShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

/**
 * Auth chrome. On a partner (bank/MFI) domain it renders the partner's logo,
 * app name, colour and support contact instead of Ledgr's.
 */
export function AuthShell({ title, subtitle, children }: AuthShellProps) {
  const { partner } = usePartner();
  const branding = usePartnerTheme();

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          {branding.logoUrl ? (
            <img
              src={branding.logoUrl}
              alt={branding.appName}
              className="mb-3 h-12 max-w-[180px] object-contain"
            />
          ) : (
            <div
              className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold text-white select-none"
              style={{ backgroundColor: branding.primaryColour }}
            >
              {branding.appName.charAt(0).toUpperCase()}
            </div>
          )}
          <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
          {subtitle && <p className="mt-1 text-center text-sm text-gray-500">{subtitle}</p>}
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white px-6 py-7 shadow-soft">
          {children}
        </div>
        {partner && (
          <p className="mt-6 text-center text-xs text-gray-400">
            {branding.appName}
            {branding.supportEmail && (
              <>
                {' · '}
                <a href={`mailto:${branding.supportEmail}`} className="hover:text-gray-600">
                  {branding.supportEmail}
                </a>
              </>
            )}
            {branding.supportPhone && <> · {branding.supportPhone}</>}
          </p>
        )}
      </div>
    </div>
  );
}

export default AuthShell;
