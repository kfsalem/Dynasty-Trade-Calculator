import { useState } from 'react';
import { useInstall, type InstallMode } from '../hooks/useInstall';
import { HeaderPopover } from './HeaderPopover';

/**
 * Telling people the app can live on their home screen (#171), in two places:
 * a one-time card on My team, and a standing button in the header. iOS never
 * offers to install a web app on its own, and the Android prompt is easy to
 * miss, so without these the feature might as well not exist.
 *
 * Both show only where installing is possible and has not happened, and both
 * give the same steps for the device in hand.
 */

const BENEFIT =
  'Opens from your home screen like an app, full screen, and still opens with your last-loaded league when you are offline.';

/** Safari's Share glyph, drawn so the step can point at the button by shape. */
function ShareIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="inline h-4 w-4 align-[-2px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7" />
    </svg>
  );
}

function Steps({ mode, onInstall }: { mode: Exclude<InstallMode, 'none'>; onInstall: () => void }) {
  if (mode === 'prompt') {
    return (
      <button type="button" onClick={onInstall} className="btn-primary mt-3 text-sm">
        Install the app
      </button>
    );
  }
  return (
    <>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted">
        <li>
          In Safari, tap Share <ShareIcon /> in the toolbar.
        </li>
        <li>
          Choose <span className="font-medium text-ink">Add to Home Screen</span>, then{' '}
          <span className="font-medium text-ink">Add</span>.
        </li>
      </ol>
      <p className="mt-2 text-xs text-subtle">
        The home-screen app keeps its own storage, separate from Safari&rsquo;s, so you
        will find your league there once more the first time you open it.
      </p>
    </>
  );
}

const HIDE_KEY = 'dynasty:installHint';

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === 'hidden';
  } catch {
    return false;
  }
}

/** The one-time card on My team. "Not now" hides it for good on this device. */
export function InstallCard() {
  const { mode, install } = useInstall();
  const [hidden, setHidden] = useState(readHidden);
  if (mode === 'none' || hidden) return null;

  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(HIDE_KEY, 'hidden');
    } catch {
      // Storage disabled: it simply comes back next visit.
    }
  };

  return (
    <section aria-label="Use it like an app" className="card rise-in mb-6">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display text-lg font-bold tracking-tight">Use it like an app</h2>
        <button
          type="button"
          onClick={hide}
          className="-my-1 inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm font-medium text-accent hover:bg-raised fine:min-h-8"
        >
          Not now
        </button>
      </div>
      <p className="mt-1 text-sm text-muted">{BENEFIT}</p>
      <Steps mode={mode} onInstall={() => void install()} />
    </section>
  );
}

/** The standing way in, in the header, for whenever the card has been dismissed. */
export function InstallButton() {
  const { mode, install } = useInstall();
  if (mode === 'none') return null;

  return (
    <HeaderPopover
      label="Install the app"
      summary={
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-4 w-4 text-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
        </svg>
      }
    >
      <p className="font-semibold text-ink">Install the app</p>
      <p className="mt-1 text-sm text-muted">{BENEFIT}</p>
      <Steps mode={mode} onInstall={() => void install()} />
    </HeaderPopover>
  );
}
