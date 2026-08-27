import { useMemo } from 'react';
import type { DraftPick, League, Player, PlayerValue } from '../types';
import type { RosterSummary } from '../engine/rosterValue';
import { suggestTrades, type SuggestContext, type SuggestedTrade, type TradeAsset } from '../engine/suggest';
import type { RoleTrends } from '../engine/roleTrend';
import type { SeasonOdds } from '../engine/analysis';
import { RoleTrendPanel } from './RoleTrendPanel';
import { FAIRNESS_LABEL } from '../engine/trade';
import { POSITION_STYLES, formatValue } from '../lib/format';
import type { PendingTrade } from './TradeBuilder';

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
}

function AssetChip({ asset }: { asset: TradeAsset }) {
  const style =
    asset.kind === 'player'
      ? POSITION_STYLES[asset.player.position].chip
      : 'bg-line text-muted';
  const badge = asset.kind === 'player' ? asset.player.position : 'PICK';

  return (
    <li className="flex items-center gap-2 text-sm">
      <span
        className={`inline-flex w-11 shrink-0 justify-center rounded px-1.5 py-0.5 text-xs font-semibold ${style}`}
      >
        {badge}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{asset.label}</span>
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

function Delta({ value }: { value: number }) {
  return (
    <span
      className={`font-semibold tabular-nums ${
        value > 0 ? 'text-positive' : value < 0 ? 'text-negative' : 'text-subtle'
      }`}
    >
      {value > 0 ? '+' : ''}
      {formatValue(value)}
    </span>
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
  const ids = (assets: TradeAsset[], kind: TradeAsset['kind']) =>
    assets.filter((a) => a.kind === kind).map((a) => a.id);

  return (
    <article className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">
          <span className="text-subtle">#{rank}</span> Offer to {trade.partnerName}
        </h3>
        <span className="text-xs text-subtle">
          {FAIRNESS_LABEL[trade.analysis.fairnessRating]} —{' '}
          {Math.round(trade.analysis.valueDifferencePct * 100)}% apart
        </span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
            You send <span className="float-right normal-case text-accent">market · yours</span>
          </p>
          <ul className="mt-2 space-y-1.5">
            {trade.give.map((asset) => (
              <AssetChip key={asset.id} asset={asset} />
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
            You get <span className="float-right normal-case text-accent">market · yours</span>
          </p>
          <ul className="mt-2 space-y-1.5">
            {trade.get.map((asset) => (
              <AssetChip key={asset.id} asset={asset} />
            ))}
          </ul>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line pt-3 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-subtle">Your lineup</dt>
          <dd>
            <Delta value={trade.myBenefit.now} />
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-subtle">Their lineup</dt>
          <dd>
            <Delta value={trade.theirBenefit.now} />
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-subtle">Your 3-year</dt>
          <dd>
            <Delta value={trade.myBenefit.future} />
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-subtle">Their 3-year</dt>
          <dd>
            <Delta value={trade.theirBenefit.future} />
          </dd>
        </div>
      </dl>

      {/* The half no other calculator shows. An offer that gets declined on
          sight is worth nothing, so this is given more weight than our own. */}
      <section className="mt-4 rounded-lg border border-accent bg-accent-soft/60 p-4">
        <h4 className="text-sm font-semibold text-accent">
          Why {trade.partnerName} says yes
        </h4>
        <ul className="mt-2 space-y-1.5">
          {trade.whyTheySayYes.map((line) => (
            <li key={line} className="flex gap-2 text-sm text-accent/90">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-3">
        <h4 className="text-sm font-semibold text-muted">Why it works for you</h4>
        <ul className="mt-2 space-y-1.5">
          {trade.rationale.map((line) => (
            <li key={line} className="flex gap-2 text-sm text-muted">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-line" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary text-sm"
          onClick={onOpen}
        >
          Open in calculator
        </button>
      </div>
      <p className="sr-only">
        {ids(trade.give, 'player').length} players and {ids(trade.give, 'pick').length} picks
        sent.
      </p>
    </article>
  );
}

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
    };
    return suggestTrades(myRosterId, ctx);
  }, [league, players, values, picks, summaries, myRosterId, trends, odds]);

  return (
    <div>
      <h2 className="text-xl font-bold tracking-tight">Trade ideas</h2>
      <p className="mt-1 text-sm text-subtle">
        Offers where both teams come out ahead — measured in what each team actually
        wants, which is not the same thing for a contender and a rebuilder.
      </p>

      {/* Above the offers on purpose. These are the players the suggestions
          below are reaching for, and seeing why makes the offers legible
          instead of arbitrary. */}
      <div className="mt-6">
        <RoleTrendPanel trends={trends} league={league} season={season} />
      </div>

      {result.trades.length === 0 ? (
        <p className="mt-6 rounded-lg border border-line bg-surface p-5 text-sm text-muted">
          {result.note}
        </p>
      ) : (
        <>
          <p className="mt-3 text-xs text-subtle">
            Searched {result.considered.toLocaleString('en-US')} packages across{' '}
            {summaries.length - 1} teams.
          </p>
          <div className="mt-4 space-y-4">
            {result.trades.map((trade, index) => (
              <SuggestionCard
                key={trade.id}
                trade={trade}
                rank={index + 1}
                onOpen={() =>
                  onOpenInCalculator({
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
                  })
                }
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
