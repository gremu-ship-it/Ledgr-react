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
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-gray-100 bg-white/80 px-4 backdrop-blur-md sm:px-6 lg:bg-white">
      <div className="flex items-center gap-3">
        <button
          onClick={toggleSidebar}
          className="rounded-xl p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 lg:hidden"
          aria-label="Toggle sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>
        <BusinessSwitcher />
      </div>

      <div className="flex items-center gap-3">
        {/* Notification bell */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotificationsOpen((v) => !v)}
            className="relative rounded-xl p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-brand-500 ring-2 ring-white" />
            )}
          </button>

          {notificationsOpen && (
            <div className="absolute right-0 top-full z-40 mt-2 w-80 rounded-2xl border border-gray-100 bg-white/95 p-1.5 shadow-xl backdrop-blur-xl">
              <div className="px-3 py-2.5">
                <p className="text-xs font-black uppercase tracking-widest text-gray-900">Notifications</p>
              </div>
              <div className="px-3 py-10 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-50">
                  <Bell className="h-6 w-6 text-gray-200" />
                </div>
                <p className="text-xs font-bold uppercase tracking-wider text-gray-400">All caught up</p>
              </div>
            </div>
          )}
        </div>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          className="rounded-lg p-2 text-sub transition-colors hover:bg-brand-500/10 hover:text-ink"
        >
          {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </button>

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
            <div className="absolute right-0 top-full z-40 mt-2 w-64 rounded-2xl border border-gray-100 bg-white/95 p-1.5 shadow-xl backdrop-blur-xl">
              <div className="px-4 py-3">
                <p className="truncate text-xs font-black uppercase tracking-widest text-gray-900">
                  {currentUser?.profile?.full_name ?? 'Account'}
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
                Profile
              </button>
              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  navigate('/settings');
                }}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left text-xs font-bold uppercase tracking-widest text-gray-600 transition-colors hover:bg-gray-50 hover:text-brand-600"
              >
                <Settings className="h-4 w-4" />
                Settings
              </button>
              <div className="my-1 border-t border-gray-100/50" />
              <button
                onClick={handleSignOut}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-left text-xs font-bold uppercase tracking-widest text-red-600 transition-colors hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" />
                Log Out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
