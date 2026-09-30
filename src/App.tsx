import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LeagueImport } from './components/LeagueImport';
import { LeagueHeader } from './components/LeagueHeader';
import { ScoringBadge } from './components/ScoringBadge';
import { PlayerDetail } from './components/PlayerDetail';
import { LeagueHistory } from './components/LeagueHistory';
import { useStandingsMode } from './hooks/useStandingsMode';
import { OpenPlayerContext } from './hooks/useOpenPlayer';
import { pickDetail, playerDetail } from './engine/playerDetail';
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
import {
  useBenchReport,
  useHistoryStats,
  useBidModel,
  useLeagueSummaries,
  useManagerModel,
} from './hooks/useLeagueData';
import { runsFaab } from './engine/bids';
import { useMyRoster } from './hooks/useMyRoster';
import { decodeTrade, encodeTrade, resolveShare } from './lib/share';
import { picksForRoster } from './engine/picks';

const STORAGE_KEY = 'dynasty:leagueId';

type Tab = 'analysis' | 'ideas' | 'rosters' | 'agents' | 'trade' | 'league';

/**
 * Value, name, and the name to show when space is short.
 *
 * Since #52 there are six, and on a phone they share a bottom bar of six equal
 * columns — about 57px each at 375px — so every long label has a short form
 * there. The full name stays the accessible name in both layouts.
 *
 * The four full labels measure ~367px against the 343px a 375px phone actually
 * offers once the page gutters are taken out, so the strip scrolled and the
 * last tab was cut mid-word. Only one label is long enough to matter, and
 * "Calculator" loses nothing next to "Trade ideas" — the row is already about
 * trades. The full name stays as the accessible name, so what a screen reader
 * announces does not depend on the viewport.
 */
const TABS: [Tab, string, string][] = [
  ['analysis', 'My team', 'Team'],
  ['ideas', 'Trade ideas', 'Trades'],
  ['rosters', 'Rosters', 'Rosters'],
  ['agents', 'Free agents', 'Wire'],
  ['trade', 'Trade calculator', 'Calc'],
  ['league', 'League', 'League'],
];

/**
 * One icon per tab, for the phone's bottom bar (#120), where a label alone at
 * 11px is too little to find a tab by. Stroke paths in one 24px box so they
 * sit at one weight; decorative, since each tab keeps its label.
 */
const TAB_ICON: Record<Tab, ReactNode> = {
  analysis: <path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z" />,
  ideas: <path d="M7 7h13M16 3l4 4-4 4M17 17H4M8 13l-4 4 4 4" />,
  rosters: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M17 11a3 3 0 100-6M21 20c0-2.6-1.6-4.8-4-5.6" />
    </>
  ),
  agents: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </>
  ),
  trade: <path d="M12 3v18M5 7h14M5 7l-3 6a3 3 0 006 0zM19 7l-3 6a3 3 0 006 0z" />,
  league: <path d="M8 4h8v6a4 4 0 01-8 0zM8 6H5a3 3 0 003 3M16 6h3a3 3 0 01-3 3M12 14v4M8 21h8M10 18h4" />,
};

/** The product mark: a rising line on the action azure. */
function BrandMark() {
  return (
    <div className="flex shrink-0 items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-action text-on-action elevation-raised">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 17l5-5 4 4 7-8" />
          <path d="M15 8h5v5" />
        </svg>
      </span>
      <span className="hidden font-display text-lg font-extrabold tracking-tight sm:inline">
        Dynasty Utility
      </span>
    </div>
  );
}

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
    scoringFidelity,
    premium,
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
    wireBoard,
    projected,
    projections,
    evidence,
    evidenceWeek,
    lockedTeams,
    claimable,
    activityCurrent,
    adjustments,
    priced,
    trends,
    isLoading,
    error,
    retry,
    retrying,
  } = useLeagueSummaries(leagueId);

  /**
   * Points left on the bench, and the only query in the app somebody has to ask
   * for.
   *
   * Gated on the team tab being open with a team claimed, because that is the
   * only place it is read and because it costs a request per week per season —
   * roughly seventy for a four-year league. A visitor pasting a league id to
   * price a trade never pays for it; once it has loaded, react-query keeps it
   * and switching tabs costs nothing.
   */
  const bench = useBenchReport(leagueId, tab === 'analysis' && myRosterId !== null);

  /*
    The league's history (#52), walked only when the League tab is open. The
    season being played is cut off at its last finished week, so a week in
    progress never becomes a record.
  */
  const { mode: standingsMode, setMode: setStandingsMode } = useStandingsMode();
  const inSeason = seasonPhase === 'regular' || seasonPhase === 'post';
  const historyCurrent =
    inSeason && league && currentWeek !== null
      ? { season: league.season, lastCompleteWeek: Math.max(0, currentWeek - 1) }
      : undefined;
  const history = useHistoryStats(leagueId, tab === 'league', standingsMode, historyCurrent);
  /*
    Gated on the tab that reads it, the same way the bench walk is. Nothing else
    in the app ranks a partner, so a visitor who never opens Trade ideas never
    pays the seventy requests this costs.

    And on the rule that decides whether the tab renders a list at all: a league
    with trading switched off shows the explanation below instead of any offers,
    so the walk would have bought seventy requests' worth of a ranking nothing
    was going to display.
  */
  const managers = useManagerModel(
    leagueId,
    tab === 'ideas' && myRosterId !== null && !league?.settings.tradesDisabled,
  );

  /*
    The same walk the manager model makes, read for a different answer — one
    query key, so whichever tab is opened first pays and the other does not.

    Gated on the tab that shows it *and* on the rule that decides whether there
    is anything to show: a league running rolling waivers has no bid to give, so
    the seventy requests would buy a panel that says nothing.
  */
  const bids = useBidModel(
    leagueId,
    league?.settings,
    // The Free agents tab shows what a claim costs too (#152), and needs no
    // claimed team to: the prices are the league's, only the budget is his.
    ((tab === 'analysis' && myRosterId !== null) || tab === 'agents') &&
      runsFaab(league?.settings),
  );

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

  /*
    The player panel (#68). One id in state for the whole app, and the detail
    read out of what is already loaded — so opening a player costs a lookup,
    never a request. Cleared with the league, since an id means nothing in
    another one.
  */
  const [openPlayerId, setOpenPlayerId] = useState<string | null>(null);
  useEffect(() => setOpenPlayerId(null), [leagueId]);
  const openPlayer = useCallback((id: string) => setOpenPlayerId(id), []);
  const closePlayer = useCallback(() => setOpenPlayerId(null), []);
  // A pick id ("2027-1-3") and a player id never collide, so one id in state
  // serves both; the pick list is asked first because it is the shorter.
  const openPick = useMemo(
    () =>
      openPlayerId && league && picks
        ? pickDetail(openPlayerId, { league, picks, myRosterId })
        : null,
    [openPlayerId, league, picks, myRosterId],
  );
  const detail = useMemo(
    () =>
      openPlayerId && !openPick && league && summaries
        ? playerDetail(openPlayerId, {
            league,
            summaries,
            myRosterId,
            freeAgents: freeAgents?.all,
            snaps,
            usage,
            roles,
            adjustments,
            trends,
          })
        : null,
    [openPlayerId, openPick, league, summaries, myRosterId, freeAgents, snaps, usage, roles, adjustments, trends],
  );

  return (
    <OpenPlayerContext.Provider value={openPlayer}>
    <main className="min-h-screen bg-page text-ink">
      {/*
        max-w-6xl, not 4xl. At 896px the trade calculator truncated player names
        to "Ja'Marr …" on a 1440px screen while the 390px mobile layout showed
        them in full — the desktop view was the degraded one. See
        docs/DESIGN-SYSTEM.md §2.
      */}
      {/*
        Bottom padding on a phone clears the fixed tab bar (#120); from `sm` up
        the tabs are back in the flow.
      */}
      <div className="mx-auto max-w-6xl px-4 pt-4 pb-28 sm:px-6 sm:pt-6 sm:pb-16">
        {/*
          The header (#120): the mark, then the league and its scoring check as
          pills that open onto their detail, then the theme. The league's
          badges and the scoring paragraph used to stand over every tab; the
          verdicts stay here and the evidence is a tap away.
        */}
        <header className="mb-8 flex items-center gap-2 sm:gap-3">
          <BrandMark />
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {ready && (
              <>
                <LeagueHeader league={league} onReset={() => changeLeague(null)} />
                <ScoringBadge fidelity={scoringFidelity} premium={premium} />
              </>
            )}
            <ThemeToggle />
          </div>
        </header>
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
                One tablist, two places (#120). On a phone it is a bar fixed to
                the bottom of the screen, where a thumb already is — five equal
                columns with an icon over each label, so nothing scrolls or
                wraps at 320px. From `sm` up it is a segmented control in the
                flow. Where it sits is a question about the window, so this one
                is keyed to width; how tall each tab is stays keyed to the
                pointer (§2).

                Same element in both, so the keyboard contract below — roving
                tabIndex, arrows, Home and End — holds in both.
              */
              className="fixed inset-x-3 bottom-3 z-20 grid grid-cols-6 rounded-card border border-line bg-surface/95 p-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] elevation-overlay backdrop-blur sm:static sm:inline-grid sm:auto-cols-max sm:grid-flow-col sm:grid-cols-none sm:rounded-2xl sm:bg-surface sm:elevation-raised"
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
                    At least 44px tall on a touch device either way (#18): the
                    phone bar stacks icon over label, and the segmented control
                    keeps `py-3` until a fine pointer takes it down.

                    `whitespace-nowrap` because a tab that wraps *internally*
                    ("Trade / calculator") is the same failure one level down.
                    The focus ring is inset so it stays inside the pill and
                    does not collide with its neighbours.
                  */
                  className={`flex min-h-11 flex-col items-center justify-center gap-1 whitespace-nowrap rounded-xl px-1 py-1.5 text-[11px] font-medium transition-colors focus-visible:[outline-offset:-2px] sm:flex-row sm:gap-2 sm:px-4 sm:py-3 sm:text-sm fine:sm:py-2 ${
                    tab === value
                      ? 'text-accent sm:bg-raised sm:text-ink sm:elevation-raised'
                      : 'text-subtle hover:text-ink'
                  }`}
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className={`h-5 w-5 sm:hidden ${tab === value ? 'text-accent' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {TAB_ICON[value]}
                  </svg>
                  {short === label ? (
                    label
                  ) : (
                    <>
                      <span className="sm:hidden">{short}</span>
                      <span className="hidden sm:inline">{label}</span>
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
                    freeAgents={wireBoard}
                    projected={projected}
                    projections={projections}
                    evidence={evidence}
                    evidenceWeek={evidenceWeek}
                    lockedTeams={lockedTeams}
                    activityCurrent={activityCurrent}
                    bench={bench}
                    bids={bids}
                    picks={picksForRoster(picks, myRosterId)}
                    picksSettled={picksSettled}
                    roles={roles}
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
                    managers={managers.model}
                    managersLoading={managers.loading}
                    managersFailed={managers.failed}
                    claimable={claimable}
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
                    bids={bids}
                    roster={league.rosters.find((r) => r.rosterId === myRosterId)}
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

              {tab === 'league' && (
                <LeagueHistory
                  stats={history.stats}
                  loading={history.loading}
                  failed={history.failed}
                  truncated={history.truncated}
                  mode={standingsMode}
                  onModeChange={setStandingsMode}
                  myKey={league.rosters.find((r) => r.rosterId === myRosterId)?.ownerId ?? null}
                />
              )}
            </div>
          </>
        )}
      </div>
      <PlayerDetail
        detail={detail}
        pick={openPick}
        chartSeason={snapsMeta?.chartSeason ?? null}
        priced={priced}
        onClose={closePlayer}
      />
    </main>
    </OpenPlayerContext.Provider>
  );
}

export default App;
