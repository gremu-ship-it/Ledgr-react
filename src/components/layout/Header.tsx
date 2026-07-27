import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bell, Menu, LogOut, Settings, User, X, AlertTriangle, CheckCircle2, Crown, ShieldCheck } from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import { useNotificationStore } from '@/store/useNotificationStore';
import { useUsage } from '@/hooks/useUsage';
import { supabase } from '@/lib/supabase';
import { LanguageSwitcher } from '@/components/i18n/LanguageSwitcher';
import { BusinessSwitcher } from './BusinessSwitcher';

function getInitials(name: string | null | undefined, email: string | null | undefined): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2
      ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  if (email) return email.slice(0, 2).toUpperCase();
  return '??';
}

export function Header() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const currentUser = useAppStore((s) => s.currentUser);
  const currentBusinessId = useAppStore((s) => s.currentBusiness?.business?.id ?? null);

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  // Notification store
  const {
    notifications,
    markAllAsRead,
    removeNotification,
    clearAll,
  } = useNotificationStore();

  const scopedNotifications = currentBusinessId
    ? notifications.filter((n) => n.businessId === currentBusinessId)
    : [];
  const unreadCount = scopedNotifications.filter((n) => !n.read).length;

  function handleMarkAllAsRead() {
    if (currentBusinessId) markAllAsRead(currentBusinessId);
  }

  function handleClearAll() {
    if (currentBusinessId) clearAll(currentBusinessId);
  }

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setNotificationsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  }

  const initials = getInitials(currentUser?.profile?.full_name, currentUser?.email);

  // Subscription status
  const { plan, planTier } = useUsage();
  const isPaid = planTier !== 'free';

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-gray-100 bg-white/80 px-4 backdrop-blur-md sm:px-6 lg:bg-white">
      <div className="flex items-center gap-3">
        <button
          onClick={toggleSidebar}
          className="rounded-xl p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 lg:hidden"
          aria-label={t('common.toggleSidebar')}
        >
          <Menu className="h-5 w-5" />
        </button>
        <BusinessSwitcher />
      </div>

      <div className="flex items-center gap-3">
        {/* Subscription Status Badge */}
        <div 
          onClick={() => navigate('/settings?tab=billing')}
          className={`hidden sm:flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold cursor-pointer transition-all active:scale-[0.985] ${
            isPaid 
              ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' 
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <Crown className="h-3 w-3" />
          <span>{plan.name}</span>
        </div>

        <LanguageSwitcher />

        {/* Notification bell */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotificationsOpen((v) => !v)}
            className="relative rounded-xl p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label={t('common.notifications')}
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute end-2 top-2 flex h-4 w-4 items-center justify-center rounded-full bg-brand-500 text-[9px] font-bold text-white ring-2 ring-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {notificationsOpen && (
            <div className="absolute end-0 top-full z-40 mt-2 w-96 max-h-[480px] overflow-hidden rounded-2xl border border-gray-100 bg-white/95 shadow-xl backdrop-blur-xl">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <p className="text-sm font-black uppercase tracking-widest text-gray-900">
                  {t('common.notifications')}
                </p>
                {scopedNotifications.length > 0 && (
                  <button
                    onClick={handleMarkAllAsRead}
                    className="text-xs font-medium text-brand-600 hover:text-brand-700"
                  >
                    Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-[380px] overflow-y-auto">
                {scopedNotifications.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-50">
                      <Bell className="h-6 w-6 text-gray-200" />
                    </div>
                    <p className="text-xs font-bold uppercase tracking-wider text-gray-400">
                      {t('common.allCaughtUp')}
                    </p>
                  </div>
                ) : (
                  scopedNotifications.map((notif) => {
                    const Icon = notif.type === 'warning' ? AlertTriangle :
                                 notif.type === 'success' ? CheckCircle2 : Bell;

                    return (
                      <div
                        key={notif.id}
                        className={clsx(
                          'group flex gap-3 border-b px-4 py-3.5 text-sm transition-colors hover:bg-gray-50',
                          !notif.read && 'bg-brand-50/40'
                        )}
                      >
                        <div className={clsx(
                          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                          notif.type === 'warning' && 'bg-amber-100 text-amber-600',
                          notif.type === 'error' && 'bg-red-100 text-red-600',
                          notif.type === 'success' && 'bg-emerald-100 text-emerald-600',
                          notif.type === 'info' && 'bg-blue-100 text-blue-600'
                        )}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <p className="font-semibold text-gray-900 pr-2">{notif.title}</p>
                            {!notif.read && (
                              <div className="mt-1 h-1.5 w-1.5 rounded-full bg-brand-500" />
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-gray-600 leading-snug">{notif.message}</p>

                          <div className="mt-1.5 flex items-center gap-2 text-[10px] text-gray-400">
                            <span>{new Date(notif.timestamp).toLocaleDateString('en-MW', { month: 'short', day: 'numeric' })}</span>
                            {notif.link && (
                              <button
                                onClick={() => {
                                  setNotificationsOpen(false);
                                  navigate(notif.link!);
                                }}
                                className="font-medium text-brand-600 hover:underline"
                              >
                                View
                              </button>
                            )}
                            <button
                              onClick={() => removeNotification(notif.id)}
                              className="ml-auto text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {scopedNotifications.length > 0 && (
                <div className="border-t bg-white/90 px-4 py-2 text-center">
                  <button
                    onClick={handleClearAll}
                    className="text-xs font-medium text-gray-400 hover:text-gray-600"
                  >
                    Clear all notifications
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* User avatar menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            className="group relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-brand-500 to-brand-600 text-xs font-black text-white shadow-lg transition-all active:scale-90"
          >
            <div className="absolute -inset-1 rounded-xl bg-brand-500/20 blur-sm group-hover:bg-brand-500/30" />
            <span className="relative">{initials}</span>
          </button>

          {userMenuOpen && (
            <div className="absolute end-0 top-full z-40 mt-2 w-64 rounded-2xl border border-gray-100 bg-white/95 p-1.5 shadow-xl backdrop-blur-xl">
              <div className="px-4 py-3">
                <p className="truncate text-xs font-black uppercase tracking-widest text-gray-900">
                  {currentUser?.profile?.full_name ?? t('common.account')}
                </p>
                <p className="truncate text-[10px] font-bold text-gray-400 uppercase tracking-tighter mt-0.5">{currentUser?.email}</p>
              </div>
              <div className="my-1 border-t border-gray-100/50" />
              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  navigate('/settings');
                }}
                className={clsx(
                  'flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left text-xs font-bold uppercase tracking-widest text-gray-600 transition-colors hover:bg-gray-50 hover:text-brand-600',
                )}
              >
                <User className="h-4 w-4" />
                {t('common.profile')}
              </button>
              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  navigate('/settings');
                }}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left text-xs font-bold uppercase tracking-widest text-gray-600 transition-colors hover:bg-gray-50 hover:text-brand-600"
              >
                <Settings className="h-4 w-4" />
                {t('common.settings')}
              </button>
              {(currentUser?.role === 'platform_admin' || currentUser?.role === 'partner_admin') && (
                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    navigate('/partner-admin');
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left text-xs font-bold uppercase tracking-widest text-amber-600 transition-colors hover:bg-amber-50"
                >
                  <ShieldCheck className="h-4 w-4" />
                  Partner Admin
                </button>
              )}
              <div className="my-1 border-t border-gray-100/50" />
              <button
                onClick={handleSignOut}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left text-xs font-bold uppercase tracking-widest text-red-600 transition-colors hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" />
                {t('auth.signOut')}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
