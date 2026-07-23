import { useEffect, useState } from 'react';
import { Download, X, Share } from 'lucide-react';

/**
 * The `beforeinstallprompt` event isn't in lib.dom.d.ts (it's
 * Chromium-specific), so we declare the shape we actually use.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'ledgr-install-prompt-dismissed';

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function isInStandaloneMode(): boolean {
  return (
    ('standalone' in window.navigator &&
      Boolean((window.navigator as { standalone?: boolean }).standalone)) ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}

/**
 * Install prompt banner, compatible with both:
 *
 * - Android / desktop Chrome, Edge, Samsung Internet: listens for the
 *   `beforeinstallprompt` event, suppresses the browser's default mini-
 *   infobar, and shows our own "Install App" button that calls
 *   `event.prompt()` when clicked.
 * - iOS Safari: does NOT support `beforeinstallprompt` at all (no API to
 *   trigger install programmatically). Instead, shows manual instructions
 *   ("Tap Share, then Add to Home Screen") since that's the only install
 *   path iOS offers.
 *
 * Hidden entirely if the app is already running standalone (installed),
 * or if the user has previously dismissed it (persisted in localStorage).
 */
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosInstructions, setShowIosInstructions] = useState(false);
  const [dismissed, setDismissed] = useState(
    () => window.localStorage.getItem(DISMISSED_KEY) === 'true',
  );

  useEffect(() => {
    if (isInStandaloneMode() || dismissed) return;

    function handleBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    if (isIos()) {
      setShowIosInstructions(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, [dismissed]);

  function handleDismiss() {
    window.localStorage.setItem(DISMISSED_KEY, 'true');
    setDismissed(true);
  }

  async function handleInstallClick() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted' || outcome === 'dismissed') {
      setDeferredPrompt(null);
      handleDismiss();
    }
  }

  if (dismissed || isInStandaloneMode()) return null;
  if (!deferredPrompt && !showIosInstructions) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto max-w-md rounded-2xl border border-line bg-card p-4 shadow-lg sm:left-auto sm:right-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/10">
          <Download className="h-5 w-5 text-brand-600 dark:text-brand-400" />
        </div>

        <div className="flex-1">
          <p className="text-sm font-semibold text-ink">Install Ledgr</p>

          {showIosInstructions ? (
            <p className="mt-1 text-sm text-muted">
              Tap <Share className="inline h-3.5 w-3.5 -translate-y-px" aria-hidden /> then{' '}
              <span className="font-medium text-sub">Add to Home Screen</span> to install.
            </p>
          ) : (
            <p className="mt-1 text-sm text-muted">
              Install Ledgr on this device for quick access and offline use.
            </p>
          )}

          {!showIosInstructions && (
            <button
              onClick={() => void handleInstallClick()}
              className="mt-3 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700"
            >
              Install App
            </button>
          )}
        </div>

        <button
          onClick={handleDismiss}
          className="shrink-0 rounded-lg p-1 text-muted transition-colors hover:bg-surface hover:text-sub"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
