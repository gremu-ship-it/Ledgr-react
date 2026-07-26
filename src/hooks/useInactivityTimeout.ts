import { useEffect, useRef, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAppStore } from '@/store/useAppStore';

const INACTIVITY_MS = 60 * 60 * 1000;
const WARNING_BEFORE_MS = 2 * 60 * 1000;
const WARNING_MS = INACTIVITY_MS - WARNING_BEFORE_MS;
const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'pointerdown'];

export interface InactivityState {
  showWarning: boolean;
  secondsRemaining: number;
  extendSession: () => void;
}

export function useInactivityTimeout(): InactivityState {
  const navigate = useNavigate();
  const currentUser = useAppStore((s) => s.currentUser);
  const reset = useAppStore((s) => s.reset);
  const [showWarning, setShowWarning] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState(WARNING_BEFORE_MS / 1000);
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Lazy-init on first read so the call site (in an effect) isn't during
  // render, which would trip react-hooks v6's purity rule.
  const lastActivityRef = useRef<number | null>(null);
  const getLastActivity = () => (lastActivityRef.current ??= Date.now());

  const clearAllTimers = useCallback(() => {
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
  }, []);

  const doLogout = useCallback(async () => {
    clearAllTimers(); setShowWarning(false);
    await supabase.auth.signOut({ scope: 'local' });
    reset();
    navigate('/login', { replace: true, state: { reason: 'inactivity' } });
  }, [clearAllTimers, navigate, reset]);

  const startCountdown = useCallback(() => {
    setSecondsRemaining(WARNING_BEFORE_MS / 1000); setShowWarning(true);
    countdownRef.current = setInterval(() => {
      setSecondsRemaining((s) => { if (s <= 1) { clearInterval(countdownRef.current!); return 0; } return s - 1; });
    }, 1000);
  }, []);

  const scheduleTimers = useCallback(() => {
    clearAllTimers(); setShowWarning(false);
    warningTimerRef.current = setTimeout(() => {
      startCountdown();
      logoutTimerRef.current = setTimeout(() => { void doLogout(); }, WARNING_BEFORE_MS);
    }, WARNING_MS);
  }, [clearAllTimers, startCountdown, doLogout]);

  const extendSession = useCallback(() => {
    lastActivityRef.current = Date.now(); scheduleTimers();
  }, [scheduleTimers]);

  // Establish a baseline activity timestamp and start the inactivity
  // timers when the user becomes available. The `didInit` ref confines
  // the initial synchronous setState in `scheduleTimers` to the first
  // effect run only; subsequent re-runs (when `currentUser` toggles)
  // re-attach the activity listeners without resetting warning state.
  const didInitRef = useRef(false);
  useEffect(() => {
    if (!currentUser) return;
    if (!didInitRef.current) {
      didInitRef.current = true;
      getLastActivity();
      scheduleTimers();
    }
    function handleActivity() {
      if (Date.now() - getLastActivity() > 10_000) { lastActivityRef.current = Date.now(); scheduleTimers(); }
    }
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        if (Date.now() - getLastActivity() >= INACTIVITY_MS) { void doLogout(); }
        else { scheduleTimers(); }
      } else { clearAllTimers(); }
    }
    ACTIVITY_EVENTS.forEach((ev) => window.addEventListener(ev, handleActivity, { passive: true }));
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearAllTimers();
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, handleActivity));
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentUser, scheduleTimers, clearAllTimers, doLogout]);

  return { showWarning, secondsRemaining, extendSession };
}
