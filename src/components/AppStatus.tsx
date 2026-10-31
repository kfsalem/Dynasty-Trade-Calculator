import { useEffect, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * Two facts the service worker makes worth saying (#171).
 *
 * **A new version is ready.** The app is served from the device's cache now,
 * so a deploy does not reach a reader until the new copy has downloaded and
 * the page reloads. Reloading for them mid-trade would lose the trade, so the
 * app asks instead, and only once there is something to reload into.
 *
 * **You are offline.** The last-loaded league still opens from the cache, and
 * the reader should know the figures are as of then rather than live.
 */
export function AppStatus() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      // Look for a new deploy hourly as well as on each load, for the tab
      // that is left open all week.
      if (registration) setInterval(() => void registration.update(), 60 * 60 * 1000);
    },
  });

  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  return (
    <>
      {offline && (
        <p
          role="status"
          className="mb-4 rounded-xl border border-caution bg-caution-soft p-3 text-sm text-caution"
        >
          You&rsquo;re offline. This is what the device last loaded, so the values and
          rosters may be out of date.
        </p>
      )}
      {needRefresh && (
        <div
          role="status"
          className="rise-in fixed inset-x-3 bottom-24 z-30 flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 elevation-overlay sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-96"
        >
          <p className="text-sm text-ink">A new version of the app is ready.</p>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => setNeedRefresh(false)}
              className="inline-flex min-h-11 items-center rounded-lg px-2 text-sm text-subtle hover:bg-raised fine:min-h-8"
            >
              Later
            </button>
            <button
              type="button"
              onClick={() => void updateServiceWorker(true)}
              className="btn-primary text-sm"
            >
              Reload
            </button>
          </div>
        </div>
      )}
    </>
  );
}
