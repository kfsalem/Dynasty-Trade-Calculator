import type { League } from '../types';
import type { RoleTrend, RoleTrends } from '../engine/roleTrend';
import { POSITION_STYLES, formatValue } from '../lib/format';
import { RoleMoveDumbbell } from './charts/RoleMoveDumbbell';

const pct = (share: number): string => `${Math.round(share * 100)}%`;

/** The evidence behind one row, in the sentence a manager would say it in. */
function evidence(trend: RoleTrend): string {
  const lead = trend.reasons[0];
  if (!lead) return `${trend.games} games of usage`;

  const direction = lead.to > lead.from ? 'up from' : 'down from';
  return `${pct(lead.to)} ${lead.label}, ${direction} ${pct(lead.from)} over ${trend.games} ${
    trend.games === 1 ? 'game' : 'games'
  }`;
}

/**
 * The half of the row a change-based list cannot say.
 *
 * "76% snaps, up from 64%" is true of Jahmyr Gibbs and tells you nothing,
 * because he is priced as the workhorse he is. What makes a row actionable is
 * the second sentence: he plays like the 8th-best back at his position and
 * costs like the 25th. Stating both ranks is what separates this from a usage
 * leaderboard.
 */
function mispricing(trend: RoleTrend, rising: boolean): string {
  const rank = (share: number) => `top ${Math.max(1, Math.round((1 - share) * 100))}%`;
  const { role, price } = trend.pricing;

  return rising
    ? `plays ${rank(role)} at ${trend.player.position}, priced ${rank(price)}`
    : `priced ${rank(price)} at ${trend.player.position}, plays ${rank(role)}`;
}

function TrendRow({
  trend,
  teamName,
  rising,
}: {
  trend: RoleTrend;
  teamName: string;
  rising: boolean;
}) {
  const style = POSITION_STYLES[trend.player.position];
  const lead = trend.reasons[0];

  return (
    <li className="flex items-baseline gap-2 py-1.5">
      <span
        className={`inline-flex w-11 shrink-0 justify-center rounded px-1.5 py-0.5 text-xs font-semibold ${style.chip}`}
      >
        {style.label}
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate">
          {trend.player.name}
          <span className="ml-1.5 text-xs text-subtle">{teamName}</span>
        </div>
        {/*
          Wraps, and the text can shrink.

          The dumbbell is a fixed 104px and this row's text had `min-width:
          auto` from being a flex item, so at 320px the pair could not fit and
          pushed the whole page 44px wide — the one horizontal scroll left in
          the app. The mark keeps its width because a rescaled track would draw
          every move the same length (see `RoleMoveDumbbell`); the sentence
          beside it is what gives way.
        */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-subtle">
          {/* The sentence carries the numbers; the mark carries their scale.
              See `RoleMoveDumbbell` for why this one is not a ChartFigure. */}
          {lead && (
            <RoleMoveDumbbell
              from={lead.from}
              to={lead.to}
              position={trend.player.position}
            />
          )}
          <span className="min-w-0">
            {evidence(trend)}
            {/* Never hidden, and never silently down-ranked into invisibility: a
                three-game trend is worth reading with the caveat attached, and
                worth nothing without it. */}
            {trend.thin && (
              <span className="ml-1 font-medium text-caution">· short window</span>
            )}
          </span>
        </div>
        {/* The reason the row cleared the gate, not decoration. Without it the
            list reads as "these players' usage moved", which is the claim that
            put the second-most-expensive asset in dynasty at the top of a
            buy-low list. */}
        <div className="text-xs text-subtle">{mispricing(trend, rising)}</div>
      </div>

      <span
        className={`shrink-0 tabular-nums text-sm font-semibold ${
          rising ? 'text-positive' : 'text-negative'
        }`}
      >
        {rising ? '+' : '−'}
        {formatValue(Math.abs(trend.gap))}
      </span>
    </li>
  );
}

function TrendList({
  title, blurb, trends, teamName, rising, empty,
}: {
  title: string;
  blurb: string;
  trends: RoleTrend[];
  teamName: (rosterId: number) => string;
  rising: boolean;
  empty: string;
}) {
  return (
    // `min-w-0`: a grid item defaults to `min-width: auto`, so this column
    // refused to go below its widest row's min-content (327px) and pushed the
    // page sideways at 320px instead of letting the rows inside it wrap.
    <div className="min-w-0">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-subtle">{title}</h4>
      <p className="mt-1 text-sm text-subtle">{blurb}</p>
      {trends.length === 0 ? (
        <p className="mt-3 text-sm text-subtle">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line text-sm">
          {trends.map((trend) => (
            <TrendRow
              key={trend.player.id}
              trend={trend}
              teamName={teamName(trend.rosterId)}
              rising={rising}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The two lists the activity data exists to produce.
 *
 * Ranked in value points rather than percent, because that is the unit the
 * decision is made in: a 3% move on a 6,000-point starter is a bigger edge than
 * a 20% move on a bench body, and a list sorted by percentage puts the bench
 * body on top.
 */
export function RoleTrendPanel({
  trends,
  league,
  season,
}: {
  trends: RoleTrends | undefined;
  league: League;
  season?: number;
}) {
  if (!trends || (trends.buyLow.length === 0 && trends.sellHigh.length === 0)) return null;

  const teamName = (rosterId: number) =>
    league.rosters.find((r) => r.rosterId === rosterId)?.teamName ?? `Team ${rosterId}`;

  return (
    <section className="card">
      <h3 className="text-lg font-semibold tracking-tight">Role trends</h3>
      <p className="mt-1 text-sm text-subtle">
        The market reprices a role change slowly, so the gap between what a player costs and
        what his current role is worth is the edge. Two things have to be true: his role
        moved, and the role he moved to is not already in his price. Ranked by that gap in
        value points.
      </p>

      {/* The single most important sentence on the panel. A previewed gap is a
          real role change that is deliberately *not* in any price yet, and a
          reader who mistakes it for one already applied would double-count it
          in exactly the way the season gate exists to prevent. */}
      {!trends.applied && (
        <p className="mt-2 rounded border border-caution bg-caution-soft px-3 py-2 text-sm text-caution">
          Preview{season ? ` of the ${season} season` : ''}. These moves are real, but the
          market has had all offseason to price them, so none of it is applied to any value
          on this page. The adjustment resumes once the season being played has data.
        </p>
      )}

      <div className="mt-4 grid gap-6 sm:grid-cols-2">
        <TrendList
          title="Buy low"
          blurb="Role is rising and the price has not followed."
          trends={trends.buyLow}
          teamName={teamName}
          rising
          empty="Nobody's role has outgrown their price."
        />
        <TrendList
          title="Sell high"
          blurb="Role is falling and the price still says otherwise."
          trends={trends.sellHigh}
          teamName={teamName}
          rising={false}
          empty="Nobody's price is outrunning their role."
        />
      </div>
    </section>
  );
}
