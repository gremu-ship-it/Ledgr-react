import type { ReactNode } from 'react';

interface AuthShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export function AuthShell({ title, subtitle, children }: AuthShellProps) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white select-none">
            L
          </div>
          <h1 className="text-xl font-semibold text-ink">{title}</h1>
          {subtitle && (
            <p className="mt-1 text-center text-sm text-muted">{subtitle}</p>
          )}
        </div>
        <div className="rounded-2xl border border-line bg-card px-6 py-7 shadow-soft">
          {children}
        </div>
      </div>
    </div>
  );
}