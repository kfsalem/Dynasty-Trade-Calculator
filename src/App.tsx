import { useEffect, useState } from 'react';
import { LeagueImport } from './components/LeagueImport';
import { LeagueHeader } from './components/LeagueHeader';
import { RosterList } from './components/RosterList';
import { TradeBuilder, type PendingTrade } from './components/TradeBuilder';
import { TradeSuggestions } from './components/TradeSuggestions';
import { TeamAnalysis } from './components/TeamAnalysis';
import { ClaimTeam } from './components/ClaimTeam';
import { useLeagueSummaries } from './hooks/useLeagueData';
import { useMyRoster } from './hooks/useMyRoster';

const STORAGE_KEY = 'dynasty:leagueId';

type Tab = 'analysis' | 'ideas' | 'rosters' | 'trade';

const TABS: [Tab, string][] = [
  ['analysis', 'My team'],
  ['ideas', 'Trade ideas'],
  ['rosters', 'Rosters'],
  ['trade', 'Trade calculator'],
];

/**
 * The "profile": a league id plus which roster is yours, both in localStorage.
 * No account, no backend — that covers essentially everything people want from
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
  const [tab, setTab] = useState<Tab>('analysis');
  // A suggestion sent to the calculator. Bumping `seq` remounts the builder so
  // it re-reads the seed rather than keeping the user's previous selections.
  const [pending, setPending] = useState<{ trade: PendingTrade; seq: number } | null>(null);
  const { myRosterId, setMyRoster } = useMyRoster(leagueId);
  const {
    league,
    players,
    values,
    scarcity,
    summaries,
    picks,
    picksUnavailable,
    snaps,
    usage,
    roles,
    snapsMeta,
    adjustments,
    isLoading,
    error,
  } = useLeagueSummaries(leagueId);

  useEffect(() => {
    try {
      if (leagueId) localStorage.setItem(STORAGE_KEY, leagueId);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage disabled — the app still works, it just won't remember.
    }
  }, [leagueId]);

  const showImport = !leagueId || Boolean(error);
  const ready = league && players && values && !isLoading && !error;

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-16">
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

        {ready && (
          <>
            <LeagueHeader league={league} onReset={() => setLeagueId(null)} />

            <div
              role="tablist"
              aria-label="League views"
              className="mt-6 flex gap-1 border-b border-gray-200"
            >
              {TABS.map(([value, label]) => (
                <button
                  key={value}
                  role="tab"
                  aria-selected={tab === value}
                  onClick={() => setTab(value)}
                  className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                    tab === value
                      ? 'border-primary-600 text-primary-700'
                      : 'border-transparent text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-6">
              {tab === 'analysis' &&
                (myRosterId === null ? (
                  <ClaimTeam league={league} onClaim={setMyRoster} />
                ) : (
                  <TeamAnalysis
                    league={league}
                    summaries={summaries}
                    myRosterId={myRosterId}
                    scarcity={scarcity}
                    onChangeTeam={() => setMyRoster(null)}
                  />
                ))}

              {tab === 'ideas' &&
                (myRosterId === null ? (
                  <ClaimTeam league={league} onClaim={setMyRoster} />
                ) : (
                  <TradeSuggestions
                    league={league}
                    players={players}
                    values={values}
                    picks={picks}
                    summaries={summaries}
                    myRosterId={myRosterId}
                    onOpenInCalculator={(trade) => {
                      setPending((prev) => ({ trade, seq: (prev?.seq ?? 0) + 1 }));
                      setTab('trade');
                    }}
                  />
                ))}

              {tab === 'rosters' && (
                <RosterList
                  league={league}
                  summaries={summaries}
                  myRosterId={myRosterId}
                  snaps={snaps}
                  usage={usage}
                  roles={roles}
                  snapsMeta={snapsMeta}
                  adjustments={adjustments}
                />
              )}

              {tab === 'trade' && (
                <TradeBuilder
                  key={pending?.seq ?? 'blank'}
                  league={league}
                  players={players}
                  values={values}
                  picks={picks}
                  picksUnavailable={picksUnavailable}
                  myRosterId={myRosterId}
                  initial={pending?.trade ?? null}
                  snaps={snaps}
                  usage={usage}
                  roles={roles}
                  chartSeason={snapsMeta?.chartSeason ?? null}
                  adjustments={adjustments}
                />
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

export default App;
