import { useEffect, useState } from 'react';
import { LeagueImport } from './components/LeagueImport';
import { LeagueView } from './components/LeagueView';
import { useLeagueSummaries } from './hooks/useLeagueData';

const STORAGE_KEY = 'dynasty:leagueId';

/**
 * The "profile" for now: one league id in localStorage. No account, no backend
 * — remembering your league covers nearly everything people actually want from
 * a profile on a single device.
 */
function readStoredLeagueId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function App() {
  const [leagueId, setLeagueId] = useState<string | null>(readStoredLeagueId);
  const { league, summaries, isLoading, error } = useLeagueSummaries(leagueId);

  useEffect(() => {
    try {
      if (leagueId) localStorage.setItem(STORAGE_KEY, leagueId);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage disabled — the app still works, it just won't remember.
    }
  }, [leagueId]);

  const showImport = !leagueId || Boolean(error);

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
        {showImport && (
          <div className="mx-auto max-w-xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-primary-600">
              Dynasty Fantasy Football
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              A trade calculator that knows your league
            </h1>
            <p className="mt-4 text-gray-600">
              Import a Sleeper dynasty league to see every roster valued against your
              actual lineup settings.
            </p>

            <div className="card mt-8">
              <LeagueImport onSubmit={setLeagueId} busy={isLoading} />
            </div>

            {error && (
              <div
                role="alert"
                className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
              >
                <p className="font-semibold">Couldn't load that league.</p>
                <p className="mt-1">{(error as Error).message}</p>
              </div>
            )}
          </div>
        )}

        {leagueId && isLoading && !error && (
          <div className="py-20 text-center">
            <div
              className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-primary-600"
              role="status"
              aria-label="Loading league"
            />
            <p className="mt-4 text-sm text-gray-500">
              Loading rosters and dynasty values…
            </p>
          </div>
        )}

        {league && !isLoading && !error && (
          <LeagueView
            league={league}
            summaries={summaries}
            onReset={() => setLeagueId(null)}
          />
        )}
      </div>
    </main>
  );
}

export default App;
