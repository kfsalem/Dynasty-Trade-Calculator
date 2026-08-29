import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LeagueImport } from './components/LeagueImport';
import { LeagueHeader } from './components/LeagueHeader';
import { RosterList } from './components/RosterList';
import { TradeBuilder, type PendingTrade } from './components/TradeBuilder';
import { TradeSuggestions } from './components/TradeSuggestions';
import { TeamAnalysis } from './components/TeamAnalysis';
import { ClaimTeam } from './components/ClaimTeam';
import { ThemeToggle } from './components/ThemeToggle';
import { LeagueSkeleton } from './components/LeagueSkeleton';
import { LeagueError } from './components/LeagueError';
import { ReplacementLevel } from './components/ReplacementLevel';
import { FreeAgentBoard } from './components/FreeAgentBoard';
import { EmptyState } from './components/EmptyState';
import { useLeagueSummaries } from './hooks/useLeagueData';
import { useMyRoster } from './hooks/useMyRoster';
import { decodeTrade, encodeTrade, resolveShare } from './lib/share';

const STORAGE_KEY = 'dynasty:leagueId';

type Tab = 'analysis' | 'ideas' | 'rosters' | 'agents' | 'trade';

/**
 * Value, name, and the name to show when space is short.
 *
 * The four full labels measure ~367px against the 343px a 375px phone actually
 * offers once the page gutters are taken out, so the strip scrolled and the
 * last tab was cut mid-word. Only one label is long enough to matter, and
 * "Calculator" loses nothing next to "Trade ideas" — the row is already about
 * trades. The full name stays as the accessible name, so what a screen reader
 * announces does not depend on the viewport.
 */
const TABS: [Tab, string, string][] = [
  ['analysis', 'My team', 'My team'],
  ['ideas', 'Trade ideas', 'Trade ideas'],
  ['rosters', 'Rosters', 'Rosters'],
  ['agents', 'Free agents', 'Free agents'],
  ['trade', 'Trade calculator', 'Calculator'],
];

/**
 * What the two trade tabs show in a league that has trading switched off.
 *
 * An explanation, not an empty state — the distinction matters. "No trades
 * found" reads as a failure of the search and invites the reader to try again,
 * change teams, or conclude the app is broken. None of those help: the league
 * decided this, and the honest thing is to say so and point at what still
 * works. The shell is the existing `EmptyState` because the shape is right; it
 * is the copy that has to do the work.
 */
function TradingDisabled({ children }: { children: ReactNode }) {
  return <EmptyState title="This league doesn't do trades">{children}</EmptyState>;
}

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
    season,
    snaps,
    usage,
    roles,
    byeTeams,
    snapsMeta,
    seasonPhase,
    currentWeek,
    freeAgents,
    activityCurrent,
    adjustments,
    priced,
    trends,
    isLoading,
    error,
    retry,
    retrying,
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
   * The picks that may legally change hands in this league.
   *
   * `pick_trading` is a league rule, so it is applied once, here, rather than
   * by each surface that shows a pick. The trade *engine* reads the setting
   * itself — it has to, since it decides what to propose — but everything that
   * merely renders or resolves a pick can work from a list that already holds
   * only the legal ones, which is how the asset picker and a shared link stay
   * consistent with each other without either knowing the rule.
   *
   * Note this is deliberately not applied to the roster or free-agent views:
   * a pick you cannot trade is still a pick you own.
   */
  const tradablePicks = useMemo(
    () => (league && !league.settings.pickTrading ? [] : picks),
    [league, picks],
  );

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
    return resolveShare(linkedTrade, league, tradablePicks);
  }, [league, tradablePicks, picksSettled]);

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
  /**
   * Nobody has picked a league yet — as opposed to having picked one that
   * failed. Both show the import form; only the first is a first run, and
   * stacking the explainer under an error message would bury the one thing on
   * screen the user needs to read.
   */
  const firstRun = !leagueId;

  return (
    <main className="min-h-screen bg-page text-ink">
      {/*
        max-w-6xl, not 4xl. At 896px the trade calculator truncated player names
        to "Ja'Marr …" on a 1440px screen while the 390px mobile layout showed
        them in full — the desktop view was the degraded one. See
        docs/DESIGN-SYSTEM.md §2.
      */}
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
        <div className="mb-6 flex justify-end">
          <ThemeToggle />
        </div>
        {showImport && (
          <div className="mx-auto max-w-xl">
            <p className="text-sm font-semibold uppercase tracking-widest text-accent">
              Dynasty Fantasy Football
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">
              A trade calculator that knows your league
            </h1>
            <p className="mt-4 text-muted">
              Import a Sleeper dynasty league to see every roster valued against your
              actual lineup settings.
            </p>

            <div className="card mt-8">
              <LeagueImport onSubmit={changeLeague} busy={isLoading} />
            </div>

            {error && (
              <LeagueError error={error as Error} onRetry={retry} retrying={retrying} />
            )}

            {firstRun && <ReplacementLevel />}
          </div>
        )}

        {/* No wrapper: the skeleton starts where `LeagueHeader` will, so the
            page does not shift when the league lands. */}
        {leagueId && isLoading && !error && <LeagueSkeleton />}

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
              /*
                Scrolls sideways rather than wrapping, once it has to.

                Four labels plus padding measure ~367px, so 375px fits and
                320px does not — and a tablist in two rows reads as two groups
                of tabs. A strip that slides is the standard answer and, unlike
                shortening the labels, it holds for any label and any locale.

                It costs one thing: `overflow-x: auto` makes this a scroll
                container in both axes, which would clip the 2px focus ring the
                base layer draws *outside* each tab. The tabs therefore draw
                theirs inside — see the button below.
              */
              className="mt-6 flex gap-1 overflow-x-auto border-b border-line [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
              {TABS.map(([value, label, short]) => (
                <button
                  key={value}
                  id={`tab-${value}`}
                  role="tab"
                  aria-selected={tab === value}
                  aria-controls="tabpanel"
                  // Pinned, so the announced name is the full one in both
                  // layouts — and in jsdom, where no CSS decides which span
                  // would have been visible.
                  aria-label={label}
                  // Roving: only the selected tab is in the page's tab order,
                  // so Tab moves past the bar rather than through every view.
                  tabIndex={tab === value ? 0 : -1}
                  onClick={() => setTab(value)}
                  /*
                    Tighter horizontally and taller vertically on a touch
                    device: the four labels at the pointer padding measure
                    ~426px against a 375px phone, and `py-3` is what makes each
                    tab a 44px target (#18).

                    `whitespace-nowrap` because a tab that wraps *internally*
                    ("Trade / calculator") is the same failure one level down,
                    and the focus ring is inset because the scrolling strip
                    above would clip an outset one.
                  */
                  className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-2 py-3 text-sm font-medium transition-colors focus-visible:[outline-offset:-2px] fine:px-4 fine:py-2 ${
                    tab === value
                      ? 'border-accent text-accent'
                      : 'border-transparent text-subtle hover:text-ink'
                  }`}
                >
                  {short === label ? (
                    label
                  ) : (
                    <>
                      <span className="fine:hidden">{short}</span>
                      <span className="hidden fine:inline">{label}</span>
                    </>
                  )}
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
                    seasonPhase={seasonPhase}
                    currentWeek={currentWeek}
                    byeTeams={byeTeams}
                    season={season}
                    freeAgents={freeAgents}
                    activityCurrent={activityCurrent}
                    onChangeTeam={() => setMyRoster(null)}
                  />
                ))}

              {tab === 'ideas' &&
                (league.settings.tradesDisabled ? (
                  <TradingDisabled>
                    Trading is switched off in this league's settings, so there are no
                    offers to suggest. The roster and free-agent views are where the
                    value in this app is for you — every player is still priced against
                    this league's own replacement levels.
                  </TradingDisabled>
                ) : myRosterId === null ? (
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
                    odds={season}
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

              {tab === 'agents' &&
                (freeAgents ? (
                  <FreeAgentBoard
                    board={freeAgents}
                    roles={roles}
                    snapsMeta={snapsMeta}
                    activityCurrent={activityCurrent}
                    priced={priced}
                  />
                ) : (
                  <EmptyState title="The wire is still loading">
                    Free agents are priced against this league's replacement levels, so
                    the board waits for the values every roster is measured on.
                  </EmptyState>
                ))}

              {tab === 'trade' &&
                (league.settings.tradesDisabled ? (
                  <TradingDisabled>
                    Trading is switched off in this league's settings, so a trade built
                    here could not be made. The calculator stays out of the way rather
                    than pricing offers nobody can accept.
                  </TradingDisabled>
                ) : (
                  <TradeBuilder
                    key={seed.seq}
                    league={league}
                    players={players}
                    values={values}
                    picks={tradablePicks}
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
                ))}
            </div>
          </>
        )}
      </div>
    </main>
  );
}

export default App;
