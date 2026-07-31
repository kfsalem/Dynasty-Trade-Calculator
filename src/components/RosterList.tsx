import type { League } from '../types';
import type { RosterSummary } from '../engine/rosterValue';
import type { SnapShare } from '../engine/snapShare';
import type { Opportunity } from '../engine/opportunity';
import { TeamCard } from './TeamCard';
import { formatValue } from '../lib/format';

interface Props {
  league: League;
  summaries: RosterSummary[];
  myRosterId: number | null;
  snaps?: Map<string, SnapShare>;
  usage?: Map<string, Opportunity>;
  snapsMeta?: { season: number; throughWeek: number | null };
}

export function RosterList({
  league,
  summaries,
  myRosterId,
  snaps,
  usage,
  snapsMeta,
}: Props) {
  const topStarterValue = summaries[0]?.starterValue ?? 0;

  // Kickers and defenses have no dynasty market, so their absence is expected.
  // Only skill positions are worth reporting as unpriced.
  const unvalued = summaries.reduce(
    (count, s) =>
      count +
      s.players.filter(
        (p) => !p.valued && p.player.position !== 'K' && p.player.position !== 'DEF',
      ).length,
    0,
  );

  return (
    <div>
      <p className="text-sm text-gray-500">
        Ranked by the best lineup each roster can field — computed from the league's{' '}
        {league.settings.startingSlots.length} starting slots, not from whatever lineup was
        last set. Values are dynasty, from FantasyCalc, matched to this league's format,
        then measured against what it costs to replace each position{' '}
        <em>in this league</em>.
      </p>

      {snapsMeta && (
        <p className="mt-2 text-sm text-gray-400">
          Expand a team to see each player's offensive snap share
          {snapsMeta.throughWeek === null
            ? ` (${snapsMeta.season})`
            : `, ${snapsMeta.season} through Week ${snapsMeta.throughWeek}`}
          , alongside his share of the team's work in his own role — targets for a
          receiver, carries for a back. A ▲ or ▼ marks someone whose last four weeks
          differ from his season by more than ten points; a role change is the slowest
          thing the market reprices. Hover any number for the full breakdown.
        </p>
      )}

      {unvalued > 0 && (
        <p className="mt-2 text-sm text-gray-400">
          {unvalued} rostered skill {unvalued === 1 ? 'player is' : 'players are'} unranked
          by FantasyCalc and shown as ~0. Measured against DynastyProcess, these are worth
          under 0.1% of a roster each.
        </p>
      )}

      <div className="mt-6 space-y-3">
        {summaries.map((summary, i) => (
          <TeamCard
            key={summary.rosterId}
            summary={summary}
            league={league}
            rank={i + 1}
            topStarterValue={topStarterValue}
            isMine={summary.rosterId === myRosterId}
            snaps={snaps}
            usage={usage}
          />
        ))}
      </div>

      <p className="mt-8 text-center text-xs text-gray-400">
        League total: {formatValue(summaries.reduce((sum, s) => sum + s.totalValue, 0))}{' '}
        across {summaries.length} rosters
      </p>
    </div>
  );
}
