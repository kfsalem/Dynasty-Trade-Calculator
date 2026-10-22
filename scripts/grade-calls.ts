/**
 * Replay the lineup panel over past weeks and grade the odds it states (#164).
 *
 * Every "start X over Y" row on the panel carries a chance — `outscoreChance`
 * of the projection gap between the two men. That curve was fitted on 60,000
 * same-position pairs of *all* startable players, and the rows the panel
 * prints are not a random sample of those: they are exactly the slots where
 * the manager and the projection disagree, which is where calls are close and
 * where a manager may know something the projection does not. So the curve
 * being right on all pairs does not make it right on these. This checks it on
 * these.
 *
 *     npm run grade:calls
 *
 * For each regular-season week of each test league, back through
 * `previous_league_id`: the projections Sleeper serves for that week, scored
 * under the league's rules; the lineup each manager actually set; and what
 * Sleeper actually paid each player. Each roster goes through `startSit`
 * exactly as the panel would run it before kickoff, and each row that benches
 * one man for another is graded on whether the man it starts outscored the man
 * it sits.
 *
 * Replaying served projections is honest. Sleeper does revise a past week's
 * projections after the snapshot a forward test takes, but measured on 2026
 * weeks 4–6 the served versions rank players no better than the frozen
 * pre-game ones (57.9%, 69.3%, 62.1% of pairs against 58.9%, 71.0%, 61.8%), so
 * the revisions carry no results.
 *
 * What a replay cannot know, and how each is handled:
 *
 * - **Injury designations as they stood.** The player index is today's, so
 *   designations are dropped. A man who was out had a projection of zero or
 *   none, and the panel would not have started him on it.
 * - **Teams as they stood.** Also today's in the index, so each man's team is
 *   taken from that week's projection row, and the week's byes from that
 *   season's schedule.
 * - **Who was on the taxi squad or injured reserve.** Also today's only, so
 *   nobody is treated as either. A call that starts such a man is one the panel
 *   would not have made, and is counted all the same; it is rare, because both
 *   are usually projected for nothing.
 * - **Locks.** Every call is made as if from before Thursday's kickoff, so
 *   nothing is locked. A manager's late swap is then a disagreement like any
 *   other.
 *
 * Not in CI, for the reason `check:slots` is not: it needs live endpoints. The
 * responses are cached under `node_modules/.cache/grade-calls`, since every
 * week but the current one is immutable and a season's projections are tens of
 * megabytes.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  getLeague,
  getMatchups,
  getNflSchedule,
  getPlayers,
  getProjections,
  getState,
} from '../src/platforms/sleeper/client';
import { mapPlayer, mapSettings, mapSetLineup } from '../src/platforms/sleeper/mapper';
import { scoreProjection } from '../src/engine/projections';
import { startSit, type ChangeCause } from '../src/engine/startSit';
import { canStart } from '../src/engine/availability';
import type { ValuedPlayer } from '../src/engine/rosterValue';
import type { SleeperLeague } from '../src/platforms/sleeper/schema';

const LEAGUES: Record<string, string> = {
  'Eternal Rebuild': '1336802780030988288',
  'Tight Ends': '1235622229488717824',
};
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;
const CACHE = 'node_modules/.cache/grade-calls';

/** A response read from disk if this week is already finished and cached. */
async function cachedJson<T>(name: string, immutable: boolean, load: () => Promise<T>): Promise<T> {
  const file = `${CACHE}/${name}.json`;
  if (immutable && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as T;
  const data = await load();
  if (immutable) {
    mkdirSync(CACHE, { recursive: true });
    writeFileSync(file, JSON.stringify(data));
  }
  return data;
}

interface Call {
  league: string;
  season: string;
  week: number;
  position: string;
  chance: number;
  cause: ChangeCause;
  /** What the man the panel would sit was projected for. Zero means he was not expected to play. */
  sitProjected: number;
  decisive: boolean;
  /** True when the man the panel would start outscored the man it would sit. */
  hit: boolean;
}

/** Every regular-season week of one league-season that has been played. */
async function gradeSeason(
  name: string,
  league: SleeperLeague,
  players: Awaited<ReturnType<typeof getPlayers>>,
  now: { season: string; week: number },
): Promise<Call[]> {
  const settings = mapSettings(league);
  const lastRegular = (league.settings?.playoff_week_start ?? 15) - 1;
  const calls: Call[] = [];
  const schedule = await cachedJson(`schedule_${league.season}`, league.season !== now.season, () =>
    getNflSchedule(league.season),
  );
  const teams = new Set(schedule.flatMap((game) => [game.home, game.away]));

  for (let week = 1; week <= lastRegular; week++) {
    const finished = league.season !== now.season || week < now.week;
    const rows = await cachedJson(`matchups_${league.league_id}_${week}`, finished, () =>
      getMatchups(league.league_id, week),
    );
    // A week nobody has played yet pays nothing to anyone.
    if (!rows.some((row) => Object.values(row.players_points ?? {}).some((p) => p !== 0))) break;

    const projections = await cachedJson(`projections_${league.season}_${week}`, finished, () =>
      getProjections(league.season, week, POSITIONS),
    );
    const playing = new Set(
      schedule.filter((game) => game.week === week).flatMap((game) => [game.home, game.away]),
    );
    const byeTeams = new Set([...teams].filter((team) => !playing.has(team)));
    // The index holds today's teams; the week's own projection row holds that week's.
    const teamThen = new Map<string, string>();
    const projected = new Map<string, number>();
    for (const row of projections) {
      if (row.team) teamThen.set(row.player_id, row.team);
      const stats = Object.fromEntries(
        Object.entries(row.stats).filter((entry): entry is [string, number] => entry[1] != null),
      );
      projected.set(row.player_id, scoreProjection(stats, settings.scoring));
    }

    for (const row of rows) {
      const paid = row.players_points ?? {};
      const entries: ValuedPlayer[] = [];
      for (const id of row.players ?? []) {
        const slim = players[id];
        const mapped = slim
          ? mapPlayer({ ...slim, team: teamThen.get(id) ?? slim.team, injuryStatus: null })
          : null;
        if (!mapped) continue;
        entries.push({
          player: mapped,
          value: 0,
          marketValue: 0,
          winNowValue: 0,
          valued: false,
          onTaxi: false,
          available: canStart(mapped),
        });
      }
      const plan = startSit({
        entries,
        startingSlots: settings.startingSlots,
        setLineup: mapSetLineup(row.starters, settings.startingSlots.length),
        byeTeams,
        projected,
      });

      for (const change of plan.changes) {
        // Only a row that benches one man for another is a call that can come true.
        if (change.chance === null || !change.start || !change.sit || change.sitStays) continue;
        const started = paid[change.start.player.id] ?? 0;
        const sat = paid[change.sit.player.id] ?? 0;
        if (started === sat) continue;
        calls.push({
          league: name,
          season: league.season,
          week,
          position: change.start.player.position,
          chance: change.chance,
          cause: change.cause,
          sitProjected: projected.get(change.sit.player.id) ?? 0,
          decisive: change.decisive,
          hit: started > sat,
        });
      }
    }
  }
  return calls;
}

const BUCKETS = [0.5, 0.55, 0.6, 0.7, 0.8, 0.9, 1.0001];

const pct = (share: number) => `${(share * 100).toFixed(1)}%`.padStart(6);

/**
 * A 95% Wilson interval on a hit rate, so a thin bucket says it is thin. The
 * normal approximation would print 18 hits of 18 as certain.
 */
function wilson(hits: number, n: number): [number, number] {
  const z = 1.96;
  const p = hits / n;
  const centre = (p + (z * z) / (2 * n)) / (1 + (z * z) / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
  return [centre - half, centre + half];
}

/** One line of the table: how many calls, how many came true, and what was stated. */
function line(label: string, calls: Call[]) {
  const hits = calls.filter((c) => c.hit).length;
  const stated = calls.reduce((sum, c) => sum + c.chance, 0) / calls.length;
  const [low, high] = wilson(hits, calls.length);
  const counts = `${label.padEnd(9)} ${String(calls.length).padStart(6)}`;
  const cameTrue = `${pct(hits / calls.length)} (${pct(low)}–${pct(high)})`;
  console.log(`  ${counts}  ${cameTrue}  ${pct(stated)}`);
}

function report(title: string, calls: Call[]) {
  console.log(`\n${title}: ${calls.length} calls`);
  console.log('  stated     calls  came true (95% interval)  stated mean');
  for (let i = 0; i < BUCKETS.length - 1; i++) {
    const inBucket = calls.filter((c) => c.chance >= BUCKETS[i] && c.chance < BUCKETS[i + 1]);
    const top = Math.min(100, Math.round(BUCKETS[i + 1] * 100));
    if (inBucket.length) line(`${Math.round(BUCKETS[i] * 100)}–${top}%`, inBucket);
  }
  if (calls.length) line('all', calls);
}

const players = await getPlayers();
const state = await getState();
const now = { season: state.season, week: state.week ?? 0 };
const all: Call[] = [];
for (const [name, id] of Object.entries(LEAGUES)) {
  let next: string | null | undefined = id;
  while (next) {
    const league = await getLeague(next);
    if (Number(league.season) < 2024) break;
    const calls = await gradeSeason(name, league, players, now);
    console.log(`${name} ${league.season}: ${calls.length} calls`);
    all.push(...calls);
    next = league.previous_league_id;
  }
}

/*
  Two kinds of call, graded apart. Benching a man projected to play is the
  projection's opinion against the manager's, and the curve is a claim about
  exactly that. Benching a man who was on bye or projected for nothing is a
  fact about the roster: the curve still prints a chance for it, from the
  newcomer's projection alone, but it is not the question the curve answers.
*/
const opinions = all.filter((c) => c.cause === 'upgrade' && c.sitProjected > 0);
const facts = all.filter((c) => !opinions.includes(c));

report('Opinions: benching a man projected to play', opinions);
report('Opinions the panel states as a change to make', opinions.filter((c) => c.decisive));
report('Facts: benching a man on bye or projected for nothing', facts);
for (const season of [...new Set(opinions.map((c) => c.season))].sort()) {
  report(`Opinions, ${season}`, opinions.filter((c) => c.season === season));
}
for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
  const at = opinions.filter((c) => c.position === position);
  if (at.length) report(`Opinions, ${position}`, at);
}
