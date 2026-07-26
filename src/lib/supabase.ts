import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/dal/types/database';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Check your .env file.',
  );
}

// Select the browser storage at sign-in time. This makes “session only” a real
// browser-session cookie rather than merely a UI preference. The marker is set
// by LoginPage before signInWithPassword writes the session.
const authStorage: Storage = {
  get length() { return localStorage.length; },
  clear() { localStorage.clear(); sessionStorage.clear(); },
  getItem(key) { return (sessionStorage.getItem('ledgr-session-only') ? sessionStorage : localStorage).getItem(key); },
  key(index) { return (sessionStorage.getItem('ledgr-session-only') ? sessionStorage : localStorage).key(index); },
  removeItem(key) { localStorage.removeItem(key); sessionStorage.removeItem(key); },
  setItem(key, value) { (sessionStorage.getItem('ledgr-session-only') ? sessionStorage : localStorage).setItem(key, value); },
};

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: { storage: authStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});