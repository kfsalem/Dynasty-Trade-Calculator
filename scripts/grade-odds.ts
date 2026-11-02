/**
 * Grade the playoff odds against finished seasons, and print the record (#164).
 *
 *     npm run grade:odds
 *
 * Replays every regular-season week of every finished season of the two test
 * leagues: the standings as they stood before the week, the fixtures left, a
 * scoring model `calibrate`d on the weeks already played, and `simulate` run
 * exactly as the app runs it. Each team's stated odds are then graded against
 * whether it reached that season's winners bracket.
 *
 * **Strength is the one input that cannot be replayed.** The app ranks teams
 * on `starterValue`, a sum of FantasyCalc win-now values, and FantasyCalc
 * publishes only today's. So each roster's strength here is its best lineup by
 * Sleeper's projections, which #164 showed are honest for past weeks. A man
 * with no projection this week — a bye, mostly — keeps his latest earlier one,
 * so a bye week does not read as a weaker team. #157 found the projection ranks
 * players at least as well as win-now value, so this is a fair stand-in for
 * the app's input, not a flattering one.
 *
 * Three comparisons:
 *
 * - **Without drift:** the simulation as it stood before #164 measured it,
 *   every team held at today's strength for the rest of the season. See
 *   `STRENGTH_DRIFT`.
 * - **Records only:** the same simulation with `pointsPerSD` at zero, so every
 *   game left is a coin flip and only the standings count.
 * - **The base rate:** six of ten teams, stated to everyone.
 *
 * It also sweeps the drift, to show the measured value is not a lucky pick.
 *
 * Not in CI, for the reason `check:slots` is not: it needs live endpoints.
 */

import {
  getBracket,
  getLeague,
  getMatchups,
  getPlayers,
  getProjections,
  type PlayerIndex,
} from '../src/platforms/sleeper/client';
import type { SleeperMatchup, SleeperProjection } from '../src/platforms/sleeper/schema';
import { mapMatchups, mapPlayer, mapSettings } from '../src/platforms/sleeper/mapper';
import { scoreProjection } from '../src/engine/projections';
import { startSit } from '../src/engine/startSit';
import { canStart } from '../src/engine/availability';
import { calibrate, playedFixtures, simulate, type TeamState } from '../src/engine/playoffOdds';
import type { ValuedPlayer } from '../src/engine/rosterValue';
import type { LeagueSettings, Matchup } from '../src/types';
import { TRACK_RECORD_LEAGUES } from './ingest/trackRecord';

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;

/** One team's stated odds before one week, and what happened. */
interface Graded {
  league: number;
  season: number;
  week: number;
  rosterId: number;
  /** The app's simulation, on projected strength. */
  odds: number;
  /** The same with no drift: every team held at today's strength. */
  still: number;
  /** The same simulation with strength switched off. */
  records: number;
  /** The base rate: playoff teams over teams. */
  base: number;
  made: 0 | 1;
  /** The simulation at each drift in `SWEEP`, in order. */
  sweep: number[];
}

const SWEEP = [0, 2, 3, 3.5, 4, 5, 6];

/** Records and points for, from the fixtures played before `week`. */
function standings(rosterIds: number[], fixtures: Matchup[], week: number) {
  const table = new Map(rosterIds.map((id) => [id, { wins: 0, losses: 0, ties: 0, pointsFor: 0 }]));
  for (const fixture of fixtures) {
    if (fixture.week >= week || !fixture.points) continue;
    const [a, b] = fixture.rosterIds;
    const [pa, pb] = fixture.points;
    const ta = table.get(a);
    const tb = table.get(b);
    if (!ta || !tb) continue;
    ta.pointsFor += pa;
    tb.pointsFor += pb;
    if (pa > pb) {
      ta.wins++;
      tb.losses++;
    } else if (pb > pa) {
      tb.wins++;
      ta.losses++;
    } else {
      ta.ties++;
      tb.ties++;
    }
  }
  return table;
}

/** Each roster's best lineup by projected points. */
function strengths(
  rows: readonly SleeperMatchup[],
  settings: Pick<LeagueSettings, 'startingSlots'>,
  latest: ReadonlyMap<string, number>,
  teamThen: ReadonlyMap<string, string>,
  players: PlayerIndex,
): Map<number, number> {
  const out = new Map<number, number>();
  for (const row of rows) {
    const entries: ValuedPlayer[] = [];
    for (const id of row.players ?? []) {
      const slim = players[id];
      const player = slim
        ? mapPlayer({ ...slim, team: teamThen.get(id) ?? slim.team, injuryStatus: null })
        : null;
      if (!player) continue;
      entries.push({
        player,
        value: 0,
        marketValue: 0,
        winNowValue: 0,
        valued: false,
        onTaxi: false,
        available: canStart(player),
      });
    }
    const plan = startSit({
      entries,
      startingSlots: settings.startingSlots,
      setLineup: [],
      projected: latest,
    });
    out.set(row.roster_id, plan.recommendedValue);
  }
  return out;
}

const projectionCache = new Map<string, Promise<SleeperProjection[]>>();
const projectionsFor = (season: string, week: number) => {
  const key = `${season}:${week}`;
  if (!projectionCache.has(key)) projectionCache.set(key, getProjections(season, week, POSITIONS));
  return projectionCache.get(key)!;
};

async function replaySeason(leagueIndex: number, leagueId: string, players: PlayerIndex) {
  const league = await getLeague(leagueId);
  const season = Number(league.season);
  const settings = mapSettings(league);
  const lastRegular = (league.settings?.playoff_week_start ?? 15) - 1;

  const weeks = await Promise.all(
    Array.from({ length: lastRegular }, (_, i) => getMatchups(leagueId, i + 1)),
  );
  const fixtures = weeks.flatMap((rows, i) => mapMatchups(i + 1, rows));
  const bracket = await getBracket(leagueId, 'winners');
  const made = new Set(
    bracket.flatMap((game) => [game.t1, game.t2]).filter((t): t is number => typeof t === 'number'),
  );
  const rosterIds = [...new Set(weeks[0].map((row) => row.roster_id))].sort((a, b) => a - b);
  const base = settings.playoffTeams / rosterIds.length;

  const latest = new Map<string, number>();
  const teamThen = new Map<string, string>();
  const graded: Graded[] = [];

  for (let week = 1; week <= lastRegular; week++) {
    for (const row of await projectionsFor(league.season, week)) {
      if (row.team) teamThen.set(row.player_id, row.team);
      const stats = Object.fromEntries(
        Object.entries(row.stats).filter((entry): entry is [string, number] => entry[1] != null),
      );
      latest.set(row.player_id, scoreProjection(stats, settings.scoring));
    }

    const strength = strengths(weeks[week - 1], settings, latest, teamThen, players);
    const table = standings(rosterIds, fixtures, week);
    const teams: TeamState[] = rosterIds.map((rosterId) => ({
      rosterId,
      ...table.get(rosterId)!,
      strength: strength.get(rosterId) ?? 0,
    }));
    const played = playedFixtures(fixtures, week);
    const remaining = fixtures.filter((f) => f.week >= week);
    const model = calibrate(teams, played);

    const input = { teams, remaining, playoffTeams: settings.playoffTeams, model };
    const byRoster = (odds: ReturnType<typeof simulate>) =>
      new Map(odds.map((r) => [r.rosterId, r.odds]));
    const odds = simulate(input);
    const still = byRoster(simulate({ ...input, drift: 0 }));
    const records = byRoster(simulate({ ...input, model: { ...model, pointsPerSD: 0 } }));
    const sweep = SWEEP.map((drift) => byRoster(simulate({ ...input, drift })));
    for (const { rosterId, odds: stated } of odds) {
      graded.push({
        league: leagueIndex,
        season,
        week,
        rosterId,
        odds: stated,
        still: still.get(rosterId)!,
        records: records.get(rosterId)!,
        base,
        made: made.has(rosterId) ? 1 : 0,
        sweep: sweep.map((at) => at.get(rosterId)!),
      });
    }
  }
  console.log(
    `  replayed ${season} league ${leagueIndex}: ${rosterIds.length} teams, ` +
      `${lastRegular} weeks, ${made.size} in the bracket`,
  );
  return graded;
}

// ---------------------------------------------------------------------------
// Reading the record
// ---------------------------------------------------------------------------

type Model = 'odds' | 'still' | 'records' | 'base';
const MODELS: Model[] = ['odds', 'still', 'records', 'base'];
const LABEL: Record<Model, string> = {
  odds: 'simulation',
  still: 'without drift',
  records: 'records only',
  base: 'base rate',
};

const brierOf = (rows: Graded[], stated: (row: Graded) => number) =>
  rows.reduce((sum, row) => sum + (stated(row) - row.made) ** 2, 0) / rows.length;
const brier = (rows: Graded[], model: Model) => brierOf(rows, (row) => row[model]);

const pct = (share: number) => `${(share * 100).toFixed(1)}%`.padStart(6);
const signed = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(4)}`;

/**
 * A 95% interval on a Brier difference, resampling team-seasons.
 *
 * Not team-weeks: one team's fourteen statements share an outcome, so they are
 * one piece of evidence fourteen times over, and resampling them singly would
 * shrink the interval by about the square root of fourteen for nothing.
 */
function interval(rows: Graded[], a: Model, b: Model): [number, number] {
  const groups = new Map<string, Graded[]>();
  for (const row of rows) {
    const key = `${row.league}:${row.season}:${row.rosterId}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const keys = [...groups.keys()];
  let state = 0x5eed;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const draws: number[] = [];
  for (let i = 0; i < 2000; i++) {
    const sample = keys.flatMap(() => groups.get(keys[Math.floor(next() * keys.length)])!);
    draws.push(brier(sample, a) - brier(sample, b));
  }
  draws.sort((x, y) => x - y);
  return [draws[50], draws[1949]];
}

function brierTable(title: string, rows: Graded[]) {
  if (rows.length === 0) return;
  const teams = new Set(rows.map((r) => `${r.league}:${r.season}:${r.rosterId}`)).size;
  console.log(`\n${title}: ${rows.length} statements, ${teams} team-seasons`);
  console.log(`  Brier  ${MODELS.map((m) => `${LABEL[m]} ${brier(rows, m).toFixed(4)}`).join('   ')}`);
  for (const other of ['still', 'records', 'base'] as const) {
    const [low, high] = interval(rows, 'odds', other);
    console.log(
      `  simulation minus ${LABEL[other].padEnd(13)} ${signed(brier(rows, 'odds') - brier(rows, other))}` +
        `  95% [${signed(low)}, ${signed(high)}]`,
    );
  }
}

const BINS = [0, 0.05, 0.2, 0.4, 0.6, 0.8, 0.95, 1.0000001];

function calibration(title: string, rows: Graded[], model: Model) {
  console.log(`\n${title}`);
  console.log('  stated        teams  made it   stated mean');
  for (let i = 0; i < BINS.length - 1; i++) {
    const inside = rows.filter((r) => r[model] >= BINS[i] && r[model] < BINS[i + 1]);
    if (inside.length === 0) continue;
    const made = inside.reduce((s, r) => s + r.made, 0) / inside.length;
    const stated = inside.reduce((s, r) => s + r[model], 0) / inside.length;
    const label = `${Math.round(BINS[i] * 100)}–${Math.min(100, Math.round(BINS[i + 1] * 100))}%`;
    console.log(`  ${label.padEnd(10)} ${String(inside.length).padStart(7)}  ${pct(made)}    ${pct(stated)}`);
  }
}

// ---------------------------------------------------------------------------

const players = await getPlayers();
const rows: Graded[] = [];
for (const [index, id] of TRACK_RECORD_LEAGUES.entries()) {
  let next: string | null | undefined = id;
  while (next && next !== '0') {
    const league = await getLeague(next);
    if (league.status === 'complete') rows.push(...(await replaySeason(index, next, players)));
    next = league.previous_league_id;
  }
}

brierTable('All weeks', rows);
console.log('\nBrier by drift (points a week), all weeks / weeks 1–7 / weeks 8–14');
for (const [i, drift] of SWEEP.entries()) {
  const at = (subset: Graded[]) => brierOf(subset, (row) => row.sweep[i]).toFixed(4);
  console.log(
    `  ${String(drift).padStart(4)}  ${at(rows)}  ${at(rows.filter((r) => r.week <= 7))}  ` +
      `${at(rows.filter((r) => r.week >= 8))}`,
  );
}
brierTable('Weeks 1–4', rows.filter((r) => r.week <= 4));
brierTable('Weeks 5–9', rows.filter((r) => r.week >= 5 && r.week <= 9));
brierTable('Weeks 10–14', rows.filter((r) => r.week >= 10));
for (const season of [...new Set(rows.map((r) => r.season))].sort()) {
  brierTable(`Season ${season}`, rows.filter((r) => r.season === season));
}
calibration('Calibration, simulation, all weeks', rows, 'odds');
calibration('Calibration, without drift, all weeks', rows, 'still');
calibration('Calibration, records only, all weeks', rows, 'records');
calibration('Calibration, simulation, weeks 1–7', rows.filter((r) => r.week <= 7), 'odds');
calibration('Calibration, without drift, weeks 1–7', rows.filter((r) => r.week <= 7), 'still');
calibration('Calibration, simulation, weeks 8–14', rows.filter((r) => r.week >= 8), 'odds');
