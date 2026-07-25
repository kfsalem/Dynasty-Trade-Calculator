import type { League } from '../types';
import type { RosterSummary } from '../engine/rosterValue';
import { analyzeTeam, type PositionalStrength, type Quadrant } from '../engine/analysis';
import { POSITION_STYLES, formatValue } from '../lib/format';

interface Props {
  league: League;
  summaries: RosterSummary[];
  myRosterId: number;
  onChangeTeam: () => void;
}

const QUADRANT_STYLE: Record<Quadrant, string> = {
  juggernaut: 'bg-emerald-50 border-emerald-200 text-emerald-900',
  win_now: 'bg-amber-50 border-amber-200 text-amber-900',
  rebuilding: 'bg-blue-50 border-blue-200 text-blue-900',
  danger: 'bg-red-50 border-red-200 text-red-900',
};

/** Diverging bar: strengths grow right, weaknesses left, centred on the median. */
function StrengthBar({ item }: { item: PositionalStrength }) {
  const magnitude = Math.min(Math.abs(item.z), 2) / 2; // 0-1, clamped at 2σ
  const width = magnitude * 50;
  const strong = item.z > 0;
  const style = POSITION_STYLES[item.position];

  return (
    <div className="flex items-center gap-3">
      <span
        className={`inline-flex w-11 shrink-0 justify-center rounded px-1.5 py-0.5 text-xs font-semibold ${style.chip}`}
      >
        {item.position}
      </span>

      <div className="relative h-6 flex-1 rounded bg-gray-100">
        <div className="absolute inset-y-0 left-1/2 w-px bg-gray-300" aria-hidden="true" />
        <div
          className={`absolute inset-y-1 rounded ${
            item.verdict === 'strength'
              ? 'bg-emerald-500'
              : item.verdict === 'weakness'
                ? 'bg-red-500'
                : 'bg-gray-400'
          }`}
          style={
            strong
              ? { left: '50%', width: `${width}%` }
              : { right: '50%', width: `${width}%` }
          }
        />
      </div>

      <span className="w-28 shrink-0 text-right text-sm tabular-nums text-gray-500">
        {formatValue(item.starterValue)}
        <span className="text-gray-400"> / {formatValue(item.leagueMedian)}</span>
      </span>
    </div>
  );
}

export function TeamAnalysis({ league, summaries, myRosterId, onChangeTeam }: Props) {
  const analysis = analyzeTeam(myRosterId, summaries, league.settings);
  const roster = league.rosters.find((r) => r.rosterId === myRosterId);

  if (!analysis || !roster) {
    return (
      <div className="card">
        <p className="text-gray-600">That team is no longer in this league.</p>
        <button type="button" onClick={onChangeTeam} className="btn-secondary mt-3 text-sm">
          Pick a different team
        </button>
      </div>
    );
  }

  const { contention, positions, surpluses, focus } = analysis;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight">{roster.teamName}</h2>
          <p className="mt-1 text-sm text-gray-500">
            Measured against the other {contention.teamCount - 1} teams in this league.
          </p>
        </div>
        <button type="button" onClick={onChangeTeam} className="btn-secondary text-sm">
          Not my team
        </button>
      </div>

      <div className={`mt-5 rounded-xl border p-5 ${QUADRANT_STYLE[contention.quadrant]}`}>
        <p className="text-xs font-semibold uppercase tracking-wide opacity-70">
          Contention window
        </p>
        <h3 className="mt-1 text-2xl font-bold">{contention.label}</h3>
        <p className="mt-2 text-sm">{contention.advice}</p>

        <div className="mt-4 flex gap-6 border-t border-current/15 pt-3 text-sm">
          <div>
            <span className="opacity-70">Now</span>{' '}
            <span className="font-semibold tabular-nums">
              #{contention.nowRank} of {contention.teamCount}
            </span>
          </div>
          <div>
            <span className="opacity-70">In 3 years</span>{' '}
            <span className="font-semibold tabular-nums">
              #{contention.futureRank} of {contention.teamCount}
            </span>
          </div>
        </div>
      </div>

      <section className="card mt-4">
        <h3 className="font-semibold">Strengths and weaknesses</h3>
        <p className="mt-1 text-sm text-gray-500">
          Starting value at each position versus the league median. Flex slots count
          toward the position of whoever fills them.
        </p>
        <div className="mt-4 space-y-2">
          {positions.map((item) => (
            <StrengthBar key={item.position} item={item} />
          ))}
        </div>
      </section>

      <section className="card mt-4">
        <h3 className="font-semibold">Tradeable surplus</h3>
        <p className="mt-1 text-sm text-gray-500">
          Players who don't crack your lineup but would start elsewhere. These are what
          you trade from.
        </p>
        {surpluses.length === 0 ? (
          <p className="mt-4 text-sm text-gray-400">
            No clear surplus — every player good enough to start somewhere is already in
            your lineup.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {surpluses.map((surplus) => (
              <li key={surplus.player.id} className="flex items-center gap-3 text-sm">
                <span
                  className={`inline-flex w-11 shrink-0 justify-center rounded px-1.5 py-0.5 text-xs font-semibold ${
                    POSITION_STYLES[surplus.player.position].chip
                  }`}
                >
                  {surplus.player.position}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {surplus.player.name}
                </span>
                <span className="shrink-0 text-gray-500">
                  starts on {surplus.wouldStartOn}{' '}
                  {surplus.wouldStartOn === 1 ? 'team' : 'teams'}
                </span>
                <span className="w-16 shrink-0 text-right tabular-nums text-gray-500">
                  {formatValue(surplus.value)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card mt-4">
        <h3 className="font-semibold">What to focus on</h3>
        <ul className="mt-3 space-y-2.5">
          {focus.map((item) => (
            <li key={item} className="flex gap-2 text-sm text-gray-700">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-500" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
