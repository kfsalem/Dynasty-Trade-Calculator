import { useCallback, useSyncExternalStore } from 'react';

/**
 * Whether, and how, this browser can put the app on a home screen (#171).
 *
 * Three cases, because the platforms disagree about who starts it:
 *
 * - **`prompt`**: Chrome, Edge and most Android browsers fire
 *   `beforeinstallprompt`, and the app can open their own install dialog from
 *   a button.
 * - **`ios`**: Safari on iPhone and iPad never prompts and offers no API. The
 *   only way in is Share → Add to Home Screen, so the app says so, step by step.
 * - **`none`**: everywhere else (desktop Safari, Firefox), or already installed.
 *   Nothing is offered, because there is nothing the reader could do with it.
 *
 * `beforeinstallprompt` can fire before React has mounted anything, so it is
 * caught at module load and kept here rather than in a component's effect.
 */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallMode = 'prompt' | 'ios' | 'none';

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

function standalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    (typeof window.matchMedia === 'function' &&
      window.matchMedia('(display-mode: standalone)').matches)
  );
}

/** iPhone, iPod, and iPadOS, which reports itself as a Mac with a touch screen. */
export function isIos(userAgent: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the browser's own mini-bar out of the way; the app offers the
    // button where the reader is, rather than over the page on load.
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    deferred = null;
    notify();
  });
}

function mode(): InstallMode {
  if (installed || standalone()) return 'none';
  if (deferred) return 'prompt';
  if (isIos(navigator.userAgent, navigator.maxTouchPoints ?? 0)) return 'ios';
  return 'none';
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInstall() {
  const current = useSyncExternalStore(subscribe, mode, () => 'none' as InstallMode);

  /** Open the browser's own install dialog. Only meaningful in `prompt` mode. */
  const install = useCallback(async () => {
    const event = deferred;
    if (!event) return;
    await event.prompt();
    const { outcome } = await event.userChoice;
    // The event is single-use either way; a dismissal may be offered again
    // later by the browser, which fires a fresh one.
    deferred = null;
    if (outcome === 'accepted') installed = true;
    notify();
  }, []);

  return { mode: current, install };
}

/** For tests: forget a captured prompt and an install, as a fresh page would. */
export function resetInstall() {
  deferred = null;
  installed = false;
  notify();
}
