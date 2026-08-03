import { useCallback, useEffect, useMemo, useState } from 'react';
import { LeagueImport } from './components/LeagueImport';
import { LeagueHeader } from './components/LeagueHeader';
import { RosterList } from './components/RosterList';
import { TradeBuilder, type PendingTrade } from './components/TradeBuilder';
import { TradeSuggestions } from './components/TradeSuggestions';
import { TeamAnalysis } from './components/TeamAnalysis';
import { ClaimTeam } from './components/ClaimTeam';
import { useLeagueSummaries } from './hooks/useLeagueData';
import { useMyRoster } from './hooks/useMyRoster';
import { decodeTrade, encodeTrade, resolveShare } from './lib/share';

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

/**
 * A shared trade, read once from the address the page was opened at.
 *
 * Read outside the component and never re-read. The URL is rewritten on every
 * edit from here on, so treating it as live state would mean the app reading
 * back its own writes — and a link is an *opening* position, not a channel.
 */
const linkedTrade = decodeTrade(window.location.search);

function App() {
  // A link beats the remembered league. Someone opening a trade from their
  // group chat is asking for that league, whatever they looked at last.
  const [leagueId, setLeagueId] = useState<string | null>(
    () => linkedTrade?.leagueId ?? readStoredLeagueId(),
  );
  const [tab, setTab] = useState<Tab>(linkedTrade ? 'trade' : 'analysis');
  /**
   * The trade the app currently believes in: what the builder holds, what the
   * address bar says, and what the builder is re-seeded from.
   *
   * One piece of state for all three, because they were never allowed to
   * disagree.
   */
  const [shared, setShared] = useState<PendingTrade | null>(null);
  /**
   * What last arrived from *outside* the builder — a suggestion or a link.
   *
   * Bumping `seq` remounts the builder so it re-reads the seed instead of
   * keeping the user's previous selections. `dropped` rides along because it is
   * a fact about one particular arrival: how much of that seed went missing on
   * the way in. Kept together so it cannot outlive the trade it describes —
   * the moment a suggestion lands, a link's losses are somebody else's story.
   */
  const [seed, setSeed] = useState({ seq: 0, dropped: 0 });
  /**
   * Whether the link the page was opened at has been dealt with — seeded,
   * judged unusable, or abandoned by a league switch. Until it has, the address
   * bar is left strictly alone; see the effect that writes it.
   */
  const [linkHandled, setLinkHandled] = useState(false);

  const seedTrade = useCallback((trade: PendingTrade, dropped = 0) => {
    setShared(trade);
    setSeed((s) => ({ seq: s.seq + 1, dropped }));
  }, []);

  /**
   * Switching leagues abandons the trade, and the incoming link with it.
   *
   * Roster and asset ids mean nothing in another league. Carrying them across
   * would seed the builder with a roster this league does not have, and
   * `buildSide` throws on one of those — the same crash `resolveShare` guards
   * the front door against, reached through the back. The link is marked
   * handled in the same breath: a link to a league nobody is looking at any
   * more has no business holding the address bar.
   */
  const changeLeague = useCallback((next: string | null) => {
    setLeagueId(next);
    setShared(null);
    setLinkHandled(true);
  }, []);
  const { myRosterId, setMyRoster } = useMyRoster(leagueId);
  const {
    league,
    players,
    values,
    scarcity,
    summaries,
    picks,
    picksUnavailable,
    picksSettled,
    oddsContext,
    snaps,
    usage,
    roles,
    snapsMeta,
    adjustments,
    priced,
    trends,
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

  /**
   * The shared trade, checked against the league that has now loaded.
   *
   * Deferred until the league is in hand because the link cannot be trusted:
   * roster ids can be edited by anyone with an address bar, and `buildSide`
   * throws on one it does not recognise — which would take the whole render
   * down rather than showing a slightly wrong trade.
   *
   * And deferred until the *picks* are in hand too, which is subtler and was a
   * real bug: pick values load in their own query, so `picks` is empty for a
   * moment after the league arrives. Resolving in that window dropped every
   * traded pick out of the link and then told the recipient, in as many words,
   * that those picks were no longer on the roster — a false statement produced
   * by asking the question early.
   */
  const fromLink = useMemo(() => {
    if (!linkedTrade || !league || !picksSettled) return null;
    if (linkedTrade.leagueId !== league.id) return null;
    return resolveShare(linkedTrade, league, picks);
  }, [league, picks, picksSettled]);

  /**
   * Whether the link has been *judged*, as opposed to merely not seeded yet.
   *
   * `fromLink` is null in two situations that must not be confused: before the
   * league has arrived, and after a link has been found unusable. The first is
   * a link still worth protecting in the address bar; the second is one worth
   * clearing out of it. This says which.
   */
  const linkDecided = Boolean(linkedTrade && league && picksSettled);

  // Seeded exactly once, through the same door the suggestion engine uses.
  useEffect(() => {
    if (!linkDecided || linkHandled) return;
    setLinkHandled(true);
    if (fromLink) seedTrade(fromLink.trade, fromLink.dropped);
  }, [linkDecided, fromLink, linkHandled, seedTrade]);

  /**
   * Keep the address bar describing what is on screen.
   *
   * `replaceState`, not `pushState`: every checkbox tick is a URL, and pushing
   * each one would turn the back button into an undo history nobody asked for
   * and leave the page unreachable by going back.
   *
   * An unhandled link is not touched at all. Writing the bare path here is how
   * the URL gets *cleared*, and on the first commit there is nothing to write
   * instead — so an untouched version of this effect deletes the trade from the
   * address bar a second or more before the league arrives to restore it. That
   * window is not cosmetic: a refresh on a slow connection lands on a stripped
   * URL, and a league that fails to load leaves the recipient looking at an
   * error page with no link left to retry. The link outranks the empty state
   * until something real replaces it.
   */
  useEffect(() => {
    if (!shared && linkedTrade && !linkHandled) return;
    const url =
      leagueId && shared ? encodeTrade({ leagueId, ...shared }) : window.location.pathname;
    window.history.replaceState(null, '', url);
  }, [leagueId, shared, linkHandled]);

  // Identity matters: the builder reports through this on every state change,
  // so a new function each render would re-fire the effect behind it forever.
  const handleTradeChange = useCallback((trade: PendingTrade | null) => {
    setShared(trade);
  }, []);

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
              <LeagueImport onSubmit={changeLeague} busy={isLoading} />
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
            <LeagueHeader league={league} onReset={() => changeLeague(null)} />

            {/*
              A real tablist, not just the roles.

              Declaring `role="tab"` tells a screen reader user this is a tab
              stop with arrow-key navigation, and they will try it. Announcing
              the pattern without implementing it is worse than plain buttons,
              which at least behave the way they are described. So: roving
              tabIndex, arrow/Home/End keys, and a `tabpanel` that names the tab
              controlling it.
            */}
            <div
              role="tablist"
              aria-label="League views"
              className="mt-6 flex gap-1 border-b border-gray-200"
              onKeyDown={(e) => {
                const step =
                  e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                if (!step && e.key !== 'Home' && e.key !== 'End') return;
                e.preventDefault();
                const i = TABS.findIndex(([value]) => value === tab);
                const next =
                  e.key === 'Home'
                    ? 0
                    : e.key === 'End'
                      ? TABS.length - 1
                      : (i + step + TABS.length) % TABS.length;
                setTab(TABS[next][0]);
                document.getElementById(`tab-${TABS[next][0]}`)?.focus();
              }}
            >
              {TABS.map(([value, label]) => (
                <button
                  key={value}
                  id={`tab-${value}`}
                  role="tab"
                  aria-selected={tab === value}
                  aria-controls="tabpanel"
                  // Roving: only the selected tab is in the page's tab order,
                  // so Tab moves past the bar rather than through every view.
                  tabIndex={tab === value ? 0 : -1}
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

            <div
              id="tabpanel"
              role="tabpanel"
              aria-labelledby={`tab-${tab}`}
              tabIndex={-1}
              className="mt-6"
            >
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
                    trends={trends}
                    season={snapsMeta?.season}
                    onOpenInCalculator={(trade) => {
                      seedTrade(trade);
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
                  priced={priced}
                />
              )}

              {tab === 'trade' && (
                <TradeBuilder
                  key={seed.seq}
                  league={league}
                  players={players}
                  values={values}
                  picks={picks}
                  picksUnavailable={picksUnavailable}
                  myRosterId={myRosterId}
                  // Re-seeded from the app's own copy, so switching tabs and
                  // coming back no longer discards the trade you were building.
                  initial={shared}
                  onChange={handleTradeChange}
                  droppedFromLink={seed.dropped}
                  odds={oddsContext}
                  snaps={snaps}
                  usage={usage}
                  roles={roles}
                  chartSeason={snapsMeta?.chartSeason ?? null}
                  adjustments={adjustments}
                  priced={priced}
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
