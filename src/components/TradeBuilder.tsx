import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  DraftPick,
  League,
  Player,
  PlayerValue,
  Position,
  TradeAnalysis,
  TradeSideResult,
} from '../types';
import { evaluateTrade, FAIRNESS_LABEL, type TradeContext } from '../engine/trade';
import { AssetPicker } from './AssetPicker';
import { EmptyState } from './EmptyState';
import { useChanged } from '../hooks/useChanged';
import type { SnapShare } from '../engine/snapShare';
import type { Opportunity } from '../engine/opportunity';
import type { PlayerRole } from '../engine/role';
import type { ActivityAdjustment } from '../engine/activityFactor';
import { formatValue } from '../lib/format';
import type { TradeSelection } from '../lib/share';
import { withStrengths, type OddsContext, type ScoringModel } from '../engine/playoffOdds';
import { usePlayoffOdds } from '../hooks/usePlayoffOdds';

/**
 * A trade handed to the builder pre-filled — from the suggestion engine, so an
 * idea can be inspected and edited rather than only read, or from a shared link.
 *
 * The shape lives in `lib/share` because that is what a permalink encodes, and
 * one definition beats two that must agree.
 */
export type PendingTrade = TradeSelection;

interface Props {
  league: League;
  players: Map<string, Player>;
  values: Map<string, PlayerValue>;
  picks: DraftPick[];
  picksUnavailable: boolean;
  snaps?: Map<string, SnapShare>;
  usage?: Map<string, Opportunity>;
  roles?: Map<string, PlayerRole>;
  chartSeason?: number | null;
  /** What a changing role did to each value, keyed by Sleeper id. */
  adjustments?: Map<string, ActivityAdjustment>;
  /** Positions the value source prices, so an unvalued player can say which. */
  priced?: Set<Position>;
  /** Claimed team, if any — anchors the left side to you. */
  myRosterId: number | null;
  /**
   * Seeds the builder. The parent remounts on change (via `key`), so this is
   * read once — after that the selections belong to the user.
   */
  initial?: PendingTrade | null;
  /**
   * Reports the current selection so the parent can keep it in the URL.
   *
   * Null when nothing is selected, which is what clears the trade out of the
   * address bar again — a link is only worth having while there is a trade in
   * it.
   */
  onChange?: (trade: PendingTrade | null) => void;
  /**
   * How many assets a shared link named that its roster no longer holds.
   *
   * Read once at mount, like `initial` and for the same reason: it describes
   * the trade that arrived, not the one on screen a dozen edits later.
   */
  droppedFromLink?: number;
  /**
   * Standings, remaining fixtures and the playoff cut.
   *
   * Undefined when the season cannot be simulated — no schedule, a platform
   * that does not publish one, or an unknown week. The panel then reports value
   * and lineup change and says nothing about the playoffs, which is exactly
   * what it did before this existed.
   */
  odds?: OddsContext;
}

const toggle = (set: Set<string>, id: string): Set<string> => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

function VorsBadge({ delta }: { delta: number }) {
  const positive = delta > 0;
  const neutral = delta === 0;
  return (
    <span
      className={`font-semibold tabular-nums ${
        neutral ? 'text-subtle' : positive ? 'text-positive' : 'text-negative'
      }`}
    >
      {positive ? '+' : ''}
      {formatValue(delta)}
    </span>
  );
}

/**
 * Copy the current address, which is the trade.
 *
 * The button exists even though the URL is already correct in the address bar,
 * because on a phone the address bar is half-hidden and selecting it is
 * fiddly — and a trade gets discussed in a league group chat, on a phone, far
 * more often than anywhere else.
 *
 * `navigator.clipboard` needs a secure context and a permission that can be
 * refused, so the failure path shows the link instead of insisting. Falling
 * back to a `document.execCommand` trick would be the other option; showing
 * someone the thing they asked for is less clever and never breaks.
 */
function CopyLink() {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state !== 'copied') return;
    const timer = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setState('copied');
    } catch {
      setState('failed');
    }
  }

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={copy}
        className="btn-secondary text-sm"
        title="Copies a link to this exact trade. Anyone who opens it gets the league loaded and both sides filled in."
      >
        {state === 'copied' ? 'Link copied' : 'Copy link'}
      </button>
      {state === 'failed' && (
        <input
          readOnly
          value={window.location.href}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Link to this trade"
          className="mt-2 w-64 max-w-full rounded-lg border border-control px-2 py-1 text-xs text-muted"
        />
      )}
    </div>
  );
}

const pct = (odds: number): string => `${Math.round(odds * 100)}%`;

/**
 * What the trade does to this team's chances of making the playoffs.
 *
 * The one number on this panel that is a consequence rather than a valuation,
 * and the reason it earns the space: "+312 starting lineup" is a quantity a
 * manager has to interpret, and "34% to 51%" is not.
 *
 * A move smaller than a point is shown as no change rather than rounded into
 * one. Ten thousand iterations puts the standard error near half a point, so a
 * sub-point difference is the simulation's noise, and dressing it up as a
 * result would be claiming precision the model does not have.
 */
function PlayoffOdds({
  before,
  after,
  pending,
  model,
}: {
  before: number | undefined;
  after: number | undefined;
  pending: boolean;
  model: ScoringModel | undefined;
}) {
  const settled = after !== undefined && !pending;

  /**
   * The one figure on this panel that arrives after the user has stopped
   * looking for it.
   *
   * Ten thousand simulated seasons run off the main thread, so the row shows
   * "34% …" for a beat and then quietly becomes "34% → 51%". Quietly is the
   * problem: it is the most consequential number here and it is the only one
   * that can change without the user having touched anything.
   *
   * `after` itself, deliberately, and not `settled ? after : undefined`. The
   * hook keeps the previous answer on screen while a new one runs, so `after`
   * moves exactly once per simulation — at the moment the answer lands. Feeding
   * it the gated value instead made the pending dip to `undefined` count as a
   * change of its own, so the highlight lit up the "…" state a beat *before*
   * the number it was meant to be pointing at. It also earns a second
   * property: a re-run that returns the same odds does not flash, so the mark
   * means "this moved", not merely "this recomputed".
   *
   * Above the early return because it is a hook, and a league with no schedule
   * renders this component with `before` undefined on every edit.
   */
  const landed = useChanged(after);

  if (before === undefined) return null;

  /**
   * Say what the number rests on.
   *
   * Odds carry more authority than they have earned, and the difference between
   * "measured from your league" and "assumed from a typical one" is the
   * difference between a projection and an estimate. A user comparing two
   * leagues deserves to know which they are looking at.
   */
  const basis =
    model?.source === 'league'
      ? `Tuned to ${model.weeks} completed ${model.weeks === 1 ? 'week' : 'weeks'} of this league's own scoring, blended with typical values while the sample is thin.`
      : 'This league has not played enough weeks to measure its own scoring, so typical values are assumed.';

  const points = settled ? Math.round(after * 100) - Math.round(before * 100) : 0;

  return (
    <div className="flex justify-between gap-4 border-t border-line pt-1">
      <dt
        className="text-subtle"
        title={`Chance of making the playoffs, simulated over the rest of the regular season from each roster's best lineup. Ten thousand seasons, so the same trade always gives the same answer. ${basis}`}
      >
        Playoff odds
      </dt>
      <dd className={`-mx-1 px-1 tabular-nums ${landed ? 'flash-change' : ''}`}>
        {settled ? (
          <>
            <span className="text-subtle">{pct(before)}</span>
            <span className="mx-1 text-subtle" aria-hidden="true">
              →
            </span>
            <span
              className={`font-semibold ${
                points > 0
                  ? 'text-positive'
                  : points < 0
                    ? 'text-negative'
                    : ''
              }`}
            >
              {pct(after)}
            </span>
            {points !== 0 && (
              <span
                className={`ml-1 text-xs ${
                  points > 0 ? 'text-positive' : 'text-negative'
                }`}
              >
                ({points > 0 ? '+' : ''}
                {points})
              </span>
            )}
          </>
        ) : (
          <span className="text-subtle">{pct(before)} …</span>
        )}
      </dd>
    </div>
  );
}

function SideSummary({
  side,
  oddsBefore,
  oddsAfter,
  oddsPending,
  oddsModel,
}: {
  side: TradeSideResult;
  oddsBefore?: number;
  oddsAfter?: number;
  oddsPending: boolean;
  oddsModel?: ScoringModel;
}) {
  return (
    <div className="min-w-0">
      <h4 className="truncate font-semibold">{side.teamName}</h4>
      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-subtle">Receives</dt>
          <dd className="tabular-nums">{formatValue(side.incomingValue)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-subtle">Sends</dt>
          <dd className="tabular-nums">{formatValue(side.outgoingValue)}</dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-line pt-1">
          <dt className="text-subtle">Net value</dt>
          <dd
            className={`font-semibold tabular-nums ${
              side.netValue > 0
                ? 'text-positive'
                : side.netValue < 0
                  ? 'text-negative'
                  : ''
            }`}
          >
            {side.netValue > 0 ? '+' : ''}
            {formatValue(side.netValue)}
          </dd>
        </div>
        <div className="flex justify-between gap-4 border-t border-line pt-1">
          <dt
            className="text-subtle"
            title="Change in best-lineup strength, measured on win-now value — what these players do for you this season, not what they are worth as assets."
          >
            Starting lineup
          </dt>
          <dd>
            <VorsBadge delta={side.vorsDelta} />
          </dd>
        </div>
        <div className="flex justify-between gap-4 text-xs text-subtle">
          <dt>&nbsp;</dt>
          <dd className="tabular-nums">
            {formatValue(side.starterValueBefore)} → {formatValue(side.starterValueAfter)}
          </dd>
        </div>
        <PlayoffOdds
          before={oddsBefore}
          after={oddsAfter}
          pending={oddsPending}
          model={oddsModel}
        />
      </dl>

      {side.warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {side.warnings.map((warning) => (
            <li key={warning} className="flex gap-1.5 text-xs text-caution">
              <span aria-hidden="true">▲</span>
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The answer, once there is a trade to answer about.
 *
 * Its own component so that mounting it *is* the event. The card is rendered
 * only while something is selected, so React inserts it the moment the first
 * asset is ticked and `.rise-in` plays exactly then, for free — no "has this
 * appeared before" flag to keep in sync with the selection.
 *
 * That framing also fixes the flash below at no cost: `useChanged` never fires
 * on its own first render, so the fairness chip stays still while the card is
 * arriving and only lights up when a later edit moves the verdict. Two
 * animations on the same element in the same 250ms was the alternative, and it
 * reads as a stutter rather than as two facts.
 */
/** The chip's colour, shared by the verdict card and the sticky phone bar. */
function fairnessChip(rating: TradeAnalysis['fairnessRating']): string {
  if (rating === 'very_fair' || rating === 'fair') return 'bg-positive-soft text-positive';
  if (rating === 'slightly_unfair') return 'bg-caution-soft text-caution';
  return 'bg-negative-soft text-negative';
}

/**
 * The verdict, pinned to the bottom of a phone while a trade is being built.
 *
 * On a desktop the two pickers sit side by side and the verdict is a short
 * scroll below them. On a phone the picker runs its full length — a 40-player
 * roster is several screens — so the answer to "what did that do" was a long
 * way from the checkbox that changed it, in a place the user had to remember to
 * go and look. Pinning the two facts that matter keeps the consequence in view
 * while the cause is still under the thumb, and the bar is a button so the full
 * reasoning is one tap away rather than hidden.
 */
function StickyVerdict({
  analysis,
  myRosterId,
  onJump,
}: {
  analysis: TradeAnalysis;
  myRosterId: number | null;
  onJump: () => void;
}) {
  // Your side if you are in this trade, otherwise the left one — the same
  // perspective the builder anchors to.
  const side =
    analysis.sides.find((s) => s.rosterId === myRosterId) ?? analysis.sides[0];
  const label = FAIRNESS_LABEL[analysis.fairnessRating];
  const net = `${side.netValue > 0 ? '+' : ''}${formatValue(side.netValue)}`;

  return (
    <div
      /*
        `env(safe-area-inset-bottom)` so the bar clears the home indicator on a
        modern iPhone rather than sitting under it.
      */
      className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:hidden"
    >
      <button
        type="button"
        onClick={onJump}
        // The visible content is three fragments that only read as a sentence
        // if you can see them laid out, so the button carries its own.
        aria-label={`${label}. ${side.teamName} nets ${net}. Jump to the full verdict.`}
        // `min-h-11`: the chip and the figure are both short, so the row came
        // out 28px — a bar pinned within thumb reach that is too small to hit
        // with a thumb.
        className="flex min-h-11 w-full items-center gap-3"
      >
        <span
          aria-hidden="true"
          className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${fairnessChip(
            analysis.fairnessRating,
          )}`}
        >
          {label}
        </span>
        <span aria-hidden="true" className="min-w-0 flex-1 truncate text-right text-sm">
          <span className="text-subtle">{side.teamName} </span>
          <span
            className={`font-semibold tabular ${
              side.netValue > 0
                ? 'text-positive'
                : side.netValue < 0
                  ? 'text-negative'
                  : ''
            }`}
          >
            {net}
          </span>
        </span>
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-5 w-5 shrink-0 text-subtle"
        >
          <path
            fillRule="evenodd"
            d="M14.77 12.79a.75.75 0 01-1.06-.02L10 8.83l-3.71 3.94a.75.75 0 11-1.08-1.04l4.25-4.5a.75.75 0 011.08 0l4.25 4.5a.75.75 0 01-.02 1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>
    </div>
  );
}

function Verdict({
  analysis,
  before,
  after,
  oddsPending,
  oddsModel,
}: {
  analysis: TradeAnalysis;
  before: Map<number, number> | null;
  after: Map<number, number> | null;
  oddsPending: boolean;
  oddsModel: ScoringModel | undefined;
}) {
  /**
   * Only when the *rating* moves — not when the numbers behind it do.
   *
   * Ticking one more mid-round pick nudges every figure on this panel, so a
   * flash on any of them would fire on every click and mean nothing. Crossing
   * from "Fair" to "Lopsided" happens rarely and is the moment the user is
   * actually hunting for, which is what makes it worth marking.
   */
  const verdictMoved = useChanged(analysis.fairnessRating);

  return (
    <div className="card rise-in mt-4">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            verdictMoved ? 'flash-change' : ''
          } ${fairnessChip(analysis.fairnessRating)}`}
        >
          {FAIRNESS_LABEL[analysis.fairnessRating]}
        </span>
        <span className="text-sm text-subtle tabular-nums">
          {formatValue(analysis.valueDifference)} apart (
          {Math.round(analysis.valueDifferencePct * 100)}%)
        </span>
      </div>

      <p className="mt-3 text-muted">{analysis.summary}</p>

      <div className="mt-5 grid gap-6 border-t border-line pt-5 sm:grid-cols-2">
        {analysis.sides.map((side) => (
          <SideSummary
            key={side.rosterId}
            side={side}
            oddsBefore={before?.get(side.rosterId)}
            oddsAfter={after?.get(side.rosterId)}
            oddsPending={oddsPending}
            oddsModel={oddsModel}
          />
        ))}
      </div>
    </div>
  );
}

export function TradeBuilder({
  league,
  players,
  values,
  picks,
  picksUnavailable,
  myRosterId,
  initial,
  onChange,
  droppedFromLink,
  odds,
  snaps,
  usage,
  roles,
  chartSeason,
  adjustments,
  priced,
}: Props) {
  // Anchor the left side to the claimed team so the trade reads from your
  // perspective, and make sure the right side is never the same roster.
  const defaultA = initial?.teamA ?? myRosterId ?? league.rosters[0]?.rosterId ?? 1;
  const defaultB =
    initial?.teamB ??
    league.rosters.find((r) => r.rosterId !== defaultA)?.rosterId ??
    defaultA + 1;

  const [teamA, setTeamA] = useState(defaultA);
  const [teamB, setTeamB] = useState(defaultB);
  const [givesA, setGivesA] = useState({
    playerIds: new Set<string>(initial?.givesA.playerIds),
    pickIds: new Set<string>(initial?.givesA.pickIds),
  });
  const [givesB, setGivesB] = useState({
    playerIds: new Set<string>(initial?.givesB.playerIds),
    pickIds: new Set<string>(initial?.givesB.pickIds),
  });

  /**
   * The link's losses, retired at the first touch.
   *
   * Held here rather than read from the prop on every render because the notice
   * speaks about the trade *as it arrived*. Once the user has moved an asset the
   * trade is theirs, and a standing complaint about a link they have already
   * edited past — or cleared outright — is a statement about something that is
   * no longer on the screen. A fresh seed remounts this component and brings its
   * own count, so nothing needs to be reset by hand.
   */
  const [dropped, setDropped] = useState(droppedFromLink ?? 0);

  const ctx: TradeContext = useMemo(
    () => ({ league, players, values, picks }),
    [league, players, values, picks],
  );

  const anySelected =
    givesA.playerIds.size + givesA.pickIds.size + givesB.playerIds.size + givesB.pickIds.size >
    0;

  // Publish the selection upward so the address bar always describes what is on
  // screen. Doing this only behind the copy button was the tempting shortcut and
  // the wrong one: people copy from the address bar out of habit, and a URL that
  // silently lagged the page would send someone the wrong offer.
  useEffect(() => {
    onChange?.(
      anySelected
        ? {
            teamA,
            teamB,
            givesA: {
              playerIds: [...givesA.playerIds],
              pickIds: [...givesA.pickIds],
            },
            givesB: {
              playerIds: [...givesB.playerIds],
              pickIds: [...givesB.pickIds],
            },
          }
        : null,
    );
  }, [anySelected, teamA, teamB, givesA, givesB, onChange]);

  const analysis = useMemo(() => {
    if (!anySelected) return null;
    return evaluateTrade(
      { rosterId: teamA, playerIds: [...givesA.playerIds], pickIds: [...givesA.pickIds] },
      { rosterId: teamB, playerIds: [...givesB.playerIds], pickIds: [...givesB.pickIds] },
      ctx,
    );
  }, [anySelected, teamA, teamB, givesA, givesB, ctx]);

  /**
   * The league before and after the trade, as two scenarios to simulate.
   *
   * Both substitute, and that is the point. The obvious version leaves the
   * "before" run on the strengths that arrived in `odds` and only replaces
   * lineups in the "after" — but those two numbers come from different places.
   * `odds.teams` carries `RosterSummary.starterValue`, while
   * `starterValueBefore` is computed inside `evaluateTrade`. They ought to
   * agree, and any day they did not the difference would surface as a phantom
   * swing in the odds attributed to a trade that had not caused it.
   *
   * Taking both ends from the same `analysis` makes the delta mean exactly one
   * thing: the trade, and nothing about how two parts of the engine round.
   */
  const scenarios = useMemo(() => {
    if (!odds || !analysis) return { before: odds ?? null, after: null };

    const at = (pick: (s: TradeSideResult) => number) =>
      new Map(analysis.sides.map((side) => [side.rosterId, pick(side)]));

    return {
      before: { ...odds, teams: withStrengths(odds.teams, at((s) => s.starterValueBefore)) },
      after: { ...odds, teams: withStrengths(odds.teams, at((s) => s.starterValueAfter)) },
    };
  }, [odds, analysis]);

  const before = usePlayoffOdds(scenarios.before);
  const after = usePlayoffOdds(scenarios.after);

  // Market value, to match the "Sends"/"Receives" figures in the verdict below —
  // both are the numbers the other manager will check.
  const sumValue = (playerIds: Set<string>, pickIds: Set<string>) => {
    let total = 0;
    for (const id of playerIds) total += values.get(id)?.marketValue ?? 0;
    for (const id of pickIds) total += picks.find((p) => p.id === id)?.marketValue ?? 0;
    return total;
  };

  // Every edit below retires the shared-link notice, and only edits do — the
  // mount-time report to `onChange` above must leave it standing, or a link
  // would explain itself and be dismissed in the same commit.
  function togglePlayer(side: 'a' | 'b', id: string) {
    setDropped(0);
    const set = side === 'a' ? setGivesA : setGivesB;
    set((s) => ({ ...s, playerIds: toggle(s.playerIds, id) }));
  }

  function togglePick(side: 'a' | 'b', id: string) {
    setDropped(0);
    const set = side === 'a' ? setGivesA : setGivesB;
    set((s) => ({ ...s, pickIds: toggle(s.pickIds, id) }));
  }

  function changeTeam(side: 'a' | 'b', rosterId: number) {
    // Selections belong to the old roster; carrying them over would price
    // players the new team doesn't own.
    setDropped(0);
    if (side === 'a') {
      setTeamA(rosterId);
      setGivesA({ playerIds: new Set(), pickIds: new Set() });
    } else {
      setTeamB(rosterId);
      setGivesB({ playerIds: new Set(), pickIds: new Set() });
    }
  }

  function reset() {
    setDropped(0);
    setGivesA({ playerIds: new Set(), pickIds: new Set() });
    setGivesB({ playerIds: new Set(), pickIds: new Set() });
  }

  const outA = sumValue(givesA.playerIds, givesA.pickIds);
  const outB = sumValue(givesB.playerIds, givesB.pickIds);
  const nameOf = (rosterId: number) =>
    league.rosters.find((r) => r.rosterId === rosterId)?.teamName ?? 'Team';

  /**
   * Which side the phone is showing. Ignored from `md` up, where both render.
   *
   * The two pickers are ~900px apart once the inner scroll is gone, so stacking
   * them made the second team a scroll journey rather than a choice. One at a
   * time, switched by a control that keeps both running totals visible, is the
   * small-screen design this replaced the reflow with.
   */
  const [mobileSide, setMobileSide] = useState<'a' | 'b'>('a');
  const verdictRef = useRef<HTMLDivElement>(null);

  const jumpToVerdict = () => {
    // Honour the same preference the CSS animations do; a smooth scroll is
    // motion, and this one moves the whole page.
    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    verdictRef.current?.scrollIntoView({
      behavior: reduce ? 'auto' : 'smooth',
      block: 'start',
    });
  };

  return (
    /*
      Room at the foot of the page for the pinned bar, which is `fixed` and so
      would otherwise sit on top of the last thing the user scrolled to — which
      is the verdict it is a summary of.
    */
    <div className={analysis ? 'pb-24 md:pb-0' : undefined}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Trade calculator</h2>
          <p className="mt-1 text-sm text-subtle">
            Check the assets each team sends. Values reflect this league's format.
          </p>
        </div>
        {anySelected && (
          <div className="flex items-start gap-2">
            <CopyLink />
            <button type="button" onClick={reset} className="btn-secondary text-sm">
              Clear
            </button>
          </div>
        )}
      </div>

      {dropped > 0 && (
        <p className="mt-3 rounded-lg border border-caution bg-caution-soft p-3 text-sm text-caution">
          {dropped === 1 ? 'One asset' : `${dropped} assets`} in that link{' '}
          {dropped === 1 ? 'is' : 'are'} no longer on the roster that was sending{' '}
          {dropped === 1 ? 'it' : 'them'}, so {dropped === 1 ? 'it has' : 'they have'}{' '}
          been left out. The trade below is not quite the one that was shared.
        </p>
      )}

      {/*
        Two reasons the pick columns are empty, and they call for opposite
        reactions from the reader: one is a temporary failure worth waiting out,
        the other is a rule that will never change. "Unavailable right now" is
        actively misleading in a league that has switched pick trading off, so
        the rule is checked first and the outage message is not reached at all.
      */}
      {!league.settings.pickTrading ? (
        <p className="mt-3 rounded-lg border border-line bg-raised p-3 text-sm text-muted">
          This league has pick trading switched off, so trades here are players only.
        </p>
      ) : (
        picksUnavailable && (
          <p className="mt-3 rounded-lg border border-caution bg-caution-soft p-3 text-sm text-caution">
            Draft pick values are unavailable right now, so only players can be traded.
          </p>
        )
      )}

      {/*
        The side switch, phones only.

        Plain buttons with `aria-pressed`, not a tablist: this shows one of two
        panels, so `role="tab"` is the tempting label — but declaring it
        promises arrow-key navigation between the tabs, and the app already has
        one real tablist honouring that contract. A second, fake one would teach
        a screen reader user a keyboard behaviour that does not exist here.

        Both totals stay on the control, so switching sides is a choice made
        with the other side's number in hand rather than from memory.
      */}
      <div className="mt-5 grid grid-cols-2 gap-1 rounded-xl border border-line p-1 md:hidden">
        {([
          ['a', teamA, outA],
          ['b', teamB, outB],
        ] as const).map(([side, rosterId, out]) => {
          const active = mobileSide === side;
          return (
            <button
              key={side}
              type="button"
              onClick={() => setMobileSide(side)}
              aria-pressed={active}
              className={`min-w-0 rounded-lg px-3 py-2 text-left transition-colors ${
                active ? 'bg-accent-soft' : 'hover:bg-page'
              }`}
            >
              <span
                className={`block truncate text-sm font-semibold ${
                  active ? 'text-accent' : 'text-muted'
                }`}
              >
                {nameOf(rosterId)}
              </span>
              <span className="tabular block truncate text-xs text-subtle">
                sends {formatValue(out)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 md:mt-5 md:grid-cols-2">
        {/* `contents` so the wrapper leaves no box of its own and the picker is
            still a direct child of the two-column grid on a desktop. */}
        <div className={mobileSide === 'a' ? 'contents' : 'hidden md:contents'}>
          <AssetPicker
            league={league}
            rosterId={teamA}
            onRosterChange={(id) => changeTeam('a', id)}
            excludeRosterId={teamB}
            players={players}
            values={values}
            picks={picks}
            selectedPlayerIds={givesA.playerIds}
            selectedPickIds={givesA.pickIds}
            onTogglePlayer={(id) => togglePlayer('a', id)}
            onTogglePick={(id) => togglePick('a', id)}
            outgoingValue={outA}
            snaps={snaps}
            usage={usage}
            roles={roles}
            chartSeason={chartSeason}
            adjustments={adjustments}
            priced={priced}
          />
        </div>
        <div className={mobileSide === 'b' ? 'contents' : 'hidden md:contents'}>
          <AssetPicker
            league={league}
            rosterId={teamB}
            onRosterChange={(id) => changeTeam('b', id)}
            excludeRosterId={teamA}
            players={players}
            values={values}
            picks={picks}
            selectedPlayerIds={givesB.playerIds}
            selectedPickIds={givesB.pickIds}
            onTogglePlayer={(id) => togglePlayer('b', id)}
            onTogglePick={(id) => togglePick('b', id)}
            outgoingValue={outB}
            snaps={snaps}
            usage={usage}
            roles={roles}
            chartSeason={chartSeason}
            adjustments={adjustments}
            priced={priced}
          />
        </div>
      </div>

      {analysis ? (
        <div ref={verdictRef}>
          <Verdict
            analysis={analysis}
            before={before.odds}
            after={after.odds}
            oddsPending={after.pending}
            oddsModel={odds?.model}
          />
        </div>
      ) : (
        /*
          The state a shared link lands on when its assets have all gone, and
          the state every first-time user starts in. It used to be one grey
          sentence, which spent the only moment anyone reads this tab saying
          nothing — so it now says what the two columns are for and what the
          second number in them means, which is the same idea the first-run
          screen opens on.
        */
        <div className="mt-6">
          <EmptyState title="Nothing on the table yet">
            Tick what each team would send. Every asset is priced twice: what the
            market pays for it, and what it adds to that team's starting lineup in
            this league — the second is the one worth trading on.
          </EmptyState>
        </div>
      )}

      {analysis && (
        <StickyVerdict
          analysis={analysis}
          myRosterId={myRosterId}
          onJump={jumpToVerdict}
        />
      )}
    </div>
  );
}
