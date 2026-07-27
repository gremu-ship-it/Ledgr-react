import React from 'react';
import { usePartner } from '../../hooks/usePartner';
import AuthShell from './AuthShell';

interface PartnerAuthShellProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export default function PartnerAuthShell({ children, fallback }: PartnerAuthShellProps) {
  const { partner, loading } = usePartner();

  if (loading) {
    return <AuthShell>{fallback || <div className="p-8 text-center">Loading partner configuration...</div>}</AuthShell>;
  }

  if (partner) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: '#f8fafc' }}>
        <style>{`
          :root { --partner-primary: ${partner.primary_colour || '#1a3a5c'}; --partner-app-name: "${partner.app_name || 'Ledgr'}"; }
        `}</style>
        {children}
      </div>
    );
  }

  return <AuthShell>{children}</AuthShell>;
}
