import { Link } from 'react-router';
import { Building2, LifeBuoy, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';

/**
 * Shown when a user is fully authenticated but has zero business memberships
 * visible to the app.
 *
 * Previously this state silently redirected to /create-business, which was
 * badly misleading for users who had been provisioned by an administrator:
 * their account existed and their password worked, but the app behaved as if
 * they had signed up seconds ago. Support reports for this consistently came
 * in as "I can't log in".
 *
 * There are two very different reasons to land here, so we offer both paths
 * instead of assuming:
 *   1. A genuinely new self-service user who still needs to create a business.
 *   2. A user whose `business_users` row is missing, `is_active = false`, or
 *      points at an inactive/soft-deleted business — an admin must fix it.
 */
export function NoBusinessAccess() {
  const { t } = useTranslation();
  const currentUser = useAppStore((s) => s.currentUser);

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
          <Building2 className="h-6 w-6" aria-hidden="true" />
        </div>

        <h1 className="mt-5 text-center text-xl font-semibold text-gray-900">
          {t('auth.noBusinessTitle')}
        </h1>

        <p className="mt-2 text-center text-sm text-gray-600">
          {t('auth.noBusinessBody')}
        </p>

        {currentUser?.email && (
          <p className="mt-4 rounded-xl bg-gray-50 px-3 py-2 text-center text-sm text-gray-500">
            {t('auth.signedInAs')}{' '}
            <span className="font-medium text-gray-700">{currentUser.email}</span>
          </p>
        )}

        <div className="mt-6 space-y-3">
          <Link
            to="/create-business"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            <Building2 className="h-4 w-4" aria-hidden="true" />
            {t('auth.noBusinessCreate')}
          </Link>

          <button
            type="button"
            onClick={() => window.location.reload()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {t('auth.noBusinessRetry')}
          </button>
        </div>

        <div className="mt-6 flex items-start gap-2 border-t border-gray-100 pt-5 text-sm text-gray-500">
          <LifeBuoy className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{t('auth.noBusinessContactAdmin')}</p>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          className="mt-5 w-full text-center text-sm text-gray-500 hover:text-gray-700 hover:underline"
        >
          {t('auth.signOut')}
        </button>
      </div>
    </div>
  );
}
