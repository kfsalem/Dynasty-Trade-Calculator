import { useMemo } from 'react';
import type { DraftPick, League, Player, PlayerValue } from '../types';
import type { RosterSummary } from '../engine/rosterValue';
import { suggestTrades, type SuggestContext, type SuggestedTrade, type TradeAsset } from '../engine/suggest';
import type { FreeAgent } from '../engine/freeAgents';
import type { RoleTrends } from '../engine/roleTrend';
import type { ManagerModel } from '../engine/managers';
import { countPhrase, type Countable } from '../lib/learnedText';
import { describeTrade } from '../lib/tradeText';
import type { SeasonOdds } from '../engine/analysis';
import { deadlineNotice, tradeWindow } from '../engine/tradeWindow';
import { RoleTrendPanel } from './RoleTrendPanel';
import { FAIRNESS_LABEL } from '../engine/trade';
import { POSITION_STYLES, formatValue } from '../lib/format';
import type { PendingTrade } from './TradeBuilder';
import { PlayerAvatar } from './PlayerAvatar';
import { PickName, PlayerName } from './PlayerName';

interface Props {
  league: League;
  players: Map<string, Player>;
  values: Map<string, PlayerValue>;
  picks: DraftPick[];
  summaries: RosterSummary[];
  myRosterId: number;
  onOpenInCalculator: (trade: PendingTrade) => void;
  /** Role trends, so the engine can propose and explain mispriced roles. */
  trends?: RoleTrends;
  /**
   * Live playoff odds, so a team whose season is gone is not offered a trade
   * that only helps it win this year. Reaches every partner, not just yours.
   */
  odds?: SeasonOdds;
  /** Season the activity data covers, for labelling an offseason preview. */
  season?: number;
  /**
   * What this league's managers have actually done, so offers are ranked by how
   * much good they do rather than only by how good they are. Absent until the
   * walk lands, and the list is then exactly the list it always was.
   */
  managers?: ManagerModel;
  /** The walk is in flight, so the order on screen is not the final one yet. */
  managersLoading?: boolean;
  /** The walk lost a request. Every partner is weighted the same, as before. */
  managersFailed?: boolean;
  /**
   * Free agents you could claim instead of trading, already narrowed to the
   * ones that are genuinely available. Absent while the board loads, and the
   * engine then makes exactly the suggestions it always did.
   */
  claimable?: FreeAgent[];
}

const TRADES: Countable = { one: 'trade', many: 'trades' };

function AssetChip({ asset }: { asset: TradeAsset }) {
  const style =
    asset.kind === 'player'
      ? POSITION_STYLES[asset.player.position].chip
      : 'bg-line text-muted';
  const badge = asset.kind === 'player' ? asset.player.position : 'PICK';

  return (
    <li className="flex min-h-11 items-center gap-2.5 text-sm fine:min-h-9">
      {asset.kind === 'player' && <PlayerAvatar player={asset.player} size="sm" />}
      <span
        className={`inline-flex w-11 shrink-0 justify-center rounded px-1.5 py-0.5 text-xs font-semibold ${style}`}
      >
        {badge}
      </span>
      {asset.kind === 'player' ? (
        <PlayerName player={asset.player} className="min-w-0 flex-1 truncate font-medium" />
      ) : (
        <PickName pick={asset.pick} className="min-w-0 flex-1 truncate font-medium" />
      )}
      {/* Market first, to agree with the fairness verdict on this same card —
          that percentage is computed on market values, so showing only the
          league-adjusted figure made an even trade look wildly lopsided. */}
      <span className="shrink-0 tabular-nums text-subtle" title="Market value">
        {formatValue(asset.marketValue)}
      </span>
      <span
        className="w-12 shrink-0 text-right text-xs font-semibold tabular-nums text-accent"
        title="Value over replacement in this league"
      >
        {formatValue(asset.value)}
      </span>
    </li>
  );
}

/**
 * One of the card's four outcomes. The sign always rides the figure, so the
 * direction never depends on the green or the red.
 */
function Outcome({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-raised p-3">
      <dt className="text-xs text-subtle">{label}</dt>
      <dd
        className={`mt-1 font-display text-lg font-bold tabular-nums ${
          value > 0 ? 'text-positive' : value < 0 ? 'text-negative' : 'text-subtle'
        }`}
      >
        {value > 0 ? '+' : value < 0 ? '−' : ''}
        {formatValue(Math.abs(value))}
      </dd>
    </div>
  );
}

function SuggestionCard({
  trade,
  rank,
  onOpen,
}: {
  trade: SuggestedTrade;
  rank: number;
  onOpen: () => void;
}) {
  return (
    <article className="card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-xl font-bold tracking-tight">
          <span className="text-subtle">#{rank}</span> Offer to {trade.partnerName}
        </h3>
        <span className="rounded-full border border-line bg-raised px-3 py-1 text-xs font-medium text-muted">
          {FAIRNESS_LABEL[trade.analysis.fairnessRating]} ·{' '}
          <span className="tabular">
            {Math.round(trade.analysis.valueDifferencePct * 100)}% apart
          </span>
        </span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
            You send <span className="float-right normal-case text-accent">market · yours</span>
          </p>
          <ul className="mt-2 space-y-1">
            {trade.give.map((asset) => (
              <AssetChip key={asset.id} asset={asset} />
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
            You get <span className="float-right normal-case text-accent">market · yours</span>
          </p>
          <ul className="mt-2 space-y-1">
            {trade.get.map((asset) => (
              <AssetChip key={asset.id} asset={asset} />
            ))}
          </ul>
        </div>
      </div>

      {/*
        The release a full roster makes to take this (#138). Named with his value
        because it is part of the price: the figures below already assume he is
        gone, and a manager should see who that is before opening the offer.
      */}
      {trade.drops.length > 0 && (
        <ul className="mt-3 space-y-1">
          {trade.drops.map((drop) => (
            <li
              key={drop.player.id}
              className="flex flex-wrap items-center gap-x-1.5 rounded-xl border border-caution/40 bg-caution-soft px-3 py-2 text-sm text-ink"
            >
              <span className="font-semibold text-caution">
                {drop.rosterId === trade.partnerRosterId
                  ? `${trade.partnerName} releases`
                  : 'You release'}
              </span>
              <PlayerName player={drop.player} className="font-medium" />
              <span className="text-muted">
                ({drop.player.position}, <span className="tabular">{formatValue(drop.value)}</span>)
                to make room on a full roster.
              </span>
            </li>
          ))}
        </ul>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Outcome label="Your lineup" value={trade.myBenefit.now} />
        <Outcome label="Your 3-year" value={trade.myBenefit.future} />
        <Outcome label="Their lineup" value={trade.theirBenefit.now} />
        <Outcome label="Their 3-year" value={trade.theirBenefit.future} />
      </dl>

      {/* The half no other calculator shows. An offer that gets declined on
          sight is worth nothing, so this is given more weight than our own. */}
      <section className="mt-4 rounded-xl border border-accent/40 bg-accent-soft p-4">
        <h4 className="text-sm font-semibold text-accent">Why {trade.partnerName} says yes</h4>
        <ul className="mt-2 space-y-1.5">
          {trade.whyTheySayYes.map((line) => (
            <li key={line} className="flex gap-2 text-sm text-ink">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      <details className="group mt-3">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-medium text-muted hover:text-ink fine:min-h-8 [&::-webkit-details-marker]:hidden">
          Why it works for you
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-4 w-4 transition-transform group-open:rotate-180"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </summary>
        <ul className="mt-1 space-y-1.5">
          {trade.rationale.map((line) => (
            <li key={line} className="flex gap-2 text-sm text-muted">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-line" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </details>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn-primary text-sm" onClick={onOpen}>
          Open in calculator
        </button>
      </div>
      <p className="sr-only">{describeTrade(trade)}</p>
    </article>
  );
}

const selectionOf = (myRosterId: number, trade: SuggestedTrade): PendingTrade => ({
  teamA: myRosterId,
  teamB: trade.partnerRosterId,
  givesA: {
    playerIds: trade.give.filter((a) => a.kind === 'player').map((a) => a.id),
    pickIds: trade.give.filter((a) => a.kind === 'pick').map((a) => a.id),
  },
  givesB: {
    playerIds: trade.get.filter((a) => a.kind === 'player').map((a) => a.id),
    pickIds: trade.get.filter((a) => a.kind === 'pick').map((a) => a.id),
  },
});

export function TradeSuggestions({
  league,
  players,
  values,
  picks,
  summaries,
  myRosterId,
  onOpenInCalculator,
  trends,
  odds,
  season,
  managers,
  managersLoading,
  managersFailed,
  claimable,
}: Props) {
  const result = useMemo(() => {
    const ctx: SuggestContext = {
      league,
      players,
      values,
      picks,
      summaries,
      trends,
      season: odds,
      managers,
      claimable,
    };
    return suggestTrades(myRosterId, ctx);
  }, [league, players, values, picks, summaries, myRosterId, trends, odds, managers, claimable]);

  /**
   * The deadline, said out loud while there is still time to act on it.
   *
   * Only ever rendered for a window that is still *open*: once it has closed,
   * the engine returns no trades and says why in `note`, and printing both
   * would state the same fact twice in two registers.
   */
  const deadline = useMemo(() => {
    const window = tradeWindow(league.settings, odds);
    return window.open ? deadlineNotice(window) : null;
  }, [league, odds]);

  const partners = summaries.length - 1;
  const firstPartner = summaries.find((s) => s.rosterId !== myRosterId)?.rosterId;
  // The search ran and found nothing, as against a rule that stopped it
  // before it started (trading off, deadline passed, a spare-less roster).
  const searched = result.considered > 0;
  const reasons = (
    [
      ['unbalanced', "couldn't be made even, even with a draft pick added"],
      ['someoneWorse', 'would leave you or them worse off'],
      ['overRoster', 'would put a roster over its limit'],
      ['tooSmall', 'help both sides, but by too little to be worth a negotiation'],
    ] as const
  )
    .map(([key, text]) => ({ key, text, count: result.rejections[key] }))
    .filter((reason) => reason.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <div className="space-y-6">
      {/*
        The answer first (#120): what these are, in a line. How they are
        ordered — and the one thing the league's feed cannot see — is one tap
        away rather than two paragraphs over the offers.
      */}
      <div>
        <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          Trade ideas
        </h2>
        <p className="mt-1 text-sm text-muted">
          Offers where both teams come out ahead — measured in what each team actually
          wants, which is not the same thing for a contender and a rebuilder.
        </p>

        {(managers || managersLoading || managersFailed) && (
          <details className="group mt-2">
            <summary className="-mx-2 inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-lg px-2 text-sm font-medium text-accent hover:bg-surface fine:min-h-8 [&::-webkit-details-marker]:hidden">
              How offers are ranked
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-4 w-4 transition-transform group-open:rotate-180"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </summary>
            <div className="mt-1 max-w-3xl space-y-2 text-sm text-subtle">
              {managers && managers.trades > 0 && (
                <p>
                  Ranked by how much good an offer does, which counts how often each
                  manager actually trades — {countPhrase(managers.trades, TRADES)}
                  {managers.seasons[0] ? ` since ${managers.seasons[0]}` : ''}
                  {/* The walk stops at `MAX_SEASONS` or at the first season
                      Sleeper has dropped, and the figure is then a floor rather
                      than a total. Said in the same words the bench panel uses. */}
                  {managers.truncated ? ', as far back as Sleeper still publishes' : ''}.
                  Only completed trades are published, never a declined one, so a quiet
                  manager may be asking and being turned down.
                </p>
              )}
              {/* The list is real and usable meanwhile — it is the ordering that
                  is provisional, not the offers. */}
              {!managers && managersLoading && (
                <p>
                  Reading this league's trade history. These are ranked on value alone
                  until it lands, and will re-order once it does.
                </p>
              )}
              {/* Same cost as the bench walk failing: this panel and nothing else. */}
              {!managers && managersFailed && (
                <p>
                  This league's trade history didn't load, so these are ranked on value
                  alone — every manager is weighted the same. Nothing else on this page is
                  affected.
                </p>
              )}
            </div>
          </details>
        )}
      </div>

      {/* Caution, not a neutral note: this one is about to expire, which is
          the whole reason it is on screen. */}
      {deadline && (
        <p className="rounded-xl border border-caution bg-caution-soft p-3 text-sm text-caution">
          {deadline}
        </p>
      )}

      {result.trades.length === 0 ? (
        /*
          An empty result is an answer too, and it should read like one: what
          happened, why, and what to do next. "Found none" on its own left the
          app's main feature a dead end.
        */
        <section className="rounded-card border border-line bg-surface p-6 elevation-raised sm:p-8">
          <h3 className="font-display text-2xl font-bold tracking-tight">
            {searched ? 'No offer works for both sides right now' : 'No offers to make'}
          </h3>
          {/* The engine's note already says how many packages it searched. */}
          <p className="mt-2 max-w-2xl text-sm text-muted">{result.note}</p>
          {/*
            Why, counted (#133). Measured on a live league, the old one-line
            excuse named the two smallest reasons and missed the largest, so
            the reader gets the breakdown instead, biggest first.
          */}
          {searched && reasons.length > 0 && (
            <ul className="mt-4 max-w-2xl space-y-2">
              {reasons.map(({ key, count, text }) => (
                <li key={key} className="flex items-baseline gap-3 text-sm">
                  <span className="w-12 shrink-0 text-right font-display text-lg font-bold tabular-nums text-ink">
                    {count.toLocaleString('en-US')}
                  </span>
                  <span className="text-muted">{text}</span>
                </li>
              ))}
            </ul>
          )}
          {searched && firstPartner !== undefined && !league.settings.tradesDisabled && (
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary text-sm"
                onClick={() =>
                  onOpenInCalculator({
                    teamA: myRosterId,
                    teamB: firstPartner,
                    givesA: { playerIds: [], pickIds: [] },
                    givesB: { playerIds: [], pickIds: [] },
                  })
                }
              >
                Build one in the calculator
              </button>
            </div>
          )}
        </section>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-subtle">
            Searched {result.considered.toLocaleString('en-US')} packages across {partners}{' '}
            teams.
          </p>
          {result.trades.map((trade, index) => (
            <SuggestionCard
              key={trade.id}
              trade={trade}
              rank={index + 1}
              onOpen={() => onOpenInCalculator(selectionOf(myRosterId, trade))}
            />
          ))}
        </div>
      )}

      {/* After the offers now, as the context behind them: the players whose
          role and price disagree, which is what several offers reach for. */}
      <RoleTrendPanel trends={trends} league={league} season={season} />
    </div>
  );
}
