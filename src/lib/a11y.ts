import { useId } from 'react';

/**
 * Accessibility utilities — small helpers used across Ledgr.
 *
 * Most notably, `announce()` posts a message into a hidden `aria-live` region
 * so assistive technology (screen readers) can read out dynamic content
 * changes (toast notifications, loading states, save confirmations, etc.)
 * without stealing keyboard focus from the user.
 *
 * WCAG: 4.1.3 Status Messages (Level AA)
 */

/**
 * Post a message to the live region for screen readers.
 * Trims trailing whitespace, clears after a short delay so the same
 * message can be re-announced.
 */
export function announce(message: string, politeness: 'polite' | 'assertive' = 'polite'): void {
  if (typeof document === 'undefined') return;
  const region = document.getElementById('ledgr-live-region');
  if (!region) return;

  // Apply the requested urgency. Callers pass 'assertive' for errors so the
  // message interrupts rather than queueing behind other announcements;
  // previously this argument was accepted and then discarded, so every
  // announcement was polite regardless.
  region.setAttribute('aria-live', politeness);

  // Clear first so the announcement is re-triggered even if the text
  // is identical to the previous one.
  region.textContent = '';
  // Force a microtask delay so screen readers reliably pick up the change.
  setTimeout(() => {
    region.textContent = message.trim();
  }, 50);
}

/**
 * Generate a stable, unique id for `aria-describedby`/`aria-labelledby`
 * pairings. Falls back to a counter when `useId` is not available.
 */
let _idCounter = 0;
export function useA11yId(prefix = 'ledgr'): string {
  const reactId = useId();
  return `${prefix}-${reactId || _idCounter++}`;
}

/**
 * Keyboard helpers — used to build roving tabindex menus.
 */
export const KEY = {
  Enter: 'Enter',
  Space: ' ',
  Escape: 'Escape',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  Home: 'Home',
  End: 'End',
  Tab: 'Tab',
} as const;
