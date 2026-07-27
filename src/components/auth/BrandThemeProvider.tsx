import React from 'react';
import { usePartner } from '../../hooks/usePartner';

export function BrandThemeProvider({ children }: { children: React.ReactNode }) {
  const { partner, loading } = usePartner();

  if (loading || !partner) return <>{children}</>;

  return (
    <div
      className="min-h-screen"
      style={{
        '--partner-primary': partner.primary_colour || '#1a3a5c',
        '--partner-app-name': `"${partner.app_name || 'Ledgr'}"`,
      } as React.CSSProperties}
    >
      <style>{`
        .partner-brand { --partner-primary: ${partner.primary_colour || '#1a3a5c'}; }
        .partner-brand .partner-text { color: ${partner.primary_colour || '#1a3a5c'}; }
      `}</style>
      {children}
    </div>
  );
}
