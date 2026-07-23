import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Menu, LogOut, Settings, User, Sun, Moon } from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '@/store/useAppStore';
import { supabase } from '@/lib/supabase';
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
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const currentUser = useAppStore((s) => s.currentUser);
  const theme = useAppStore((s) => s.theme);
  const toggleTheme = useAppStore((s) => s.toggleTheme);

  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const notifRef = useRef<HTMLDivElement>(null);

  // Placeholder count — wire to a real notifications table/source later.
  const unreadCount = 0;

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

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-line bg-card px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <button
          onClick={toggleSidebar}
          className="rounded-lg p-2 text-muted transition-colors hover:bg-surface hover:text-sub lg:hidden"
          aria-label="Toggle sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>
        <BusinessSwitcher />
      </div>

      <div className="flex items-center gap-2">
        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="rounded-lg p-2 text-sub transition-colors hover:bg-brand-500/8 hover:text-ink"
        >
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

        {/* Notification bell */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotificationsOpen((v) => !v)}
            className="relative rounded-lg p-2 text-muted transition-colors hover:bg-surface hover:text-sub"
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-danger ring-2 ring-white" />
            )}
          </button>

          {notificationsOpen && (
            <div className="absolute right-0 top-full z-40 mt-2 w-80 rounded-xl border border-line bg-card p-1.5 shadow-lg">
              <div className="px-3 py-2.5">
                <p className="text-sm font-semibold text-ink">Notifications</p>
              </div>
              <div className="px-3 py-8 text-center">
                <p className="text-sm text-muted">You're all caught up.</p>
              </div>
            </div>
          )}
        </div>

        {/* User avatar menu */}
        <div className="relative" ref={userMenuRef}>
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            {initials}
          </button>

          {userMenuOpen && (
            <div className="absolute right-0 top-full z-40 mt-2 w-56 rounded-xl border border-line bg-card p-1.5 shadow-lg">
              <div className="px-3 py-2.5">
                <p className="truncate text-sm font-semibold text-ink">
                  {currentUser?.profile?.full_name ?? 'User'}
                </p>
                <p className="truncate text-xs text-muted">{currentUser?.email}</p>
              </div>
              <div className="my-1 border-t border-line" />
              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  navigate('/settings');
                }}
                className={clsx(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-sub transition-colors hover:bg-bg',
                )}
              >
                <User className="h-4 w-4 text-muted" />
                Profile
              </button>
              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  navigate('/settings');
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-sub transition-colors hover:bg-bg"
              >
                <Settings className="h-4 w-4 text-muted" />
                Settings
              </button>
              <div className="my-1 border-t border-line" />
              <button
                onClick={handleSignOut}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-danger transition-colors hover:bg-danger/10"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
