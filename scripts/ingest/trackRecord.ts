import { readFile, writeFile } from 'node:fs/promises';

import {
  getLeague,
  getMatchups,
  getNflSchedule,
  getPlayers,
  getProjections,
  type PlayerIndex,
} from '../../src/platforms/sleeper/client';
import { mapPlayer, mapSettings, mapSetLineup } from '../../src/platforms/sleeper/mapper';
import type {
  SleeperGame,
  SleeperMatchup,
  SleeperProjection,
} from '../../src/platforms/sleeper/schema';
import { scoreProjection } from '../../src/engine/projections';
import { startSit } from '../../src/engine/startSit';
import { canStart } from '../../src/engine/availability';
import type { ValuedPlayer } from '../../src/engine/rosterValue';
import type { LeagueSettings } from '../../src/types';
import {
  TRACK_RECORD_COLUMNS,
  TRACK_RECORD_FILE,
  type TrackRecordFile,
  type TrackRecordRow,
} from '../../src/engine/trackRecord';

/**
 * The lineup panel, replayed over every finished week of two real leagues and
 * graded against what Sleeper paid (#164). See `engine/trackRecord` for why.
 *
 * Measured first with `npm run grade:calls` (#177): over 548 calls from 2024
 * to 2026 week 6, the panel stated 56.6% on average and 57.5% came true, and
 * every bucket held its stated chance.
 *
 * **Replaying served projections is honest.** Sleeper revises a past week's
 * projections after kickoff, but on 2026 weeks 4–6 the served versions ranked
 * players no better than copies frozen before the games (57.9%, 69.3% and
 * 62.1% of pairs, against 58.9%, 71.0% and 61.8%). The revisions carry no
 * results.
 *
 * What a replay cannot know, and how each is handled:
 *
 * - **Injury designations as they stood.** The player index is today's, so
 *   designations are dropped. A man who was out had a projection of zero or
 *   none, and the panel would not have started him on it.
 * - **Teams as they stood.** Also today's in the index, so each man's team is
 *   taken from that week's projection row, and the week's byes from that
 *   season's schedule.
 * - **Who was on the taxi squad or injured reserve.** Today's only, so nobody
 *   is treated as either. Both are usually projected for nothing, so the
 *   panel rarely starts one.
 * - **Locks.** Every call is graded as if made before Thursday's kickoff.
 *
 * Failure policy is the value snapshot's, not the nflverse datasets': nothing
 * here fails a build. The committed file is a complete answer that is a week
 * old, and every finished week in it is final, so a failed refresh keeps it.
 */

/** The leagues replayed. Their ids are public, and already in `docs/`. */
export const TRACK_RECORD_LEAGUES = ['1336802780030988288', '1235622229488717824'] as const;

/** 2024 is the first season both leagues played with projections the panel reads. */
const FIRST_SEASON = 2024;

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const;

export const weekKey = (league: number, season: number, week: number) =>
  `${league}:${season}:${week}`;

/**
 * Whether every game of `week` is over, so its points are final.
 *
 * Asked of the schedule, not of the calendar: a week is finished when its
 * Monday game is, and the Tuesday refresh lands either side of that.
 */
export function weekFinished(schedule: readonly SleeperGame[], week: number): boolean {
  const games = schedule.filter((game) => game.week === week);
  return games.length > 0 && games.every((game) => game.status === 'complete');
}

export interface WeekInput {
  league: number;
  season: number;
  week: number;
  settings: Pick<LeagueSettings, 'startingSlots' | 'scoring'>;
  schedule: readonly SleeperGame[];
  projections: readonly SleeperProjection[];
  matchups: readonly SleeperMatchup[];
  players: PlayerIndex;
}

/** Every call the panel would have made in one league-week, graded. */
export function gradeWeek(input: WeekInput): TrackRecordRow[] {
  const { league, season, week, settings, schedule, projections, matchups, players } = input;

  const teams = new Set(schedule.flatMap((game) => [game.home, game.away]));
  const playing = new Set(
    schedule.filter((game) => game.week === week).flatMap((game) => [game.home, game.away]),
  );
  const byeTeams = new Set([...teams].filter((team) => !playing.has(team)));

  const teamThen = new Map<string, string>();
  const projected = new Map<string, number>();
  for (const row of projections) {
    if (row.team) teamThen.set(row.player_id, row.team);
    const stats = Object.fromEntries(
      Object.entries(row.stats).filter((entry): entry is [string, number] => entry[1] != null),
    );
    projected.set(row.player_id, scoreProjection(stats, settings.scoring));
  }

  const rows: TrackRecordRow[] = [];
  for (const matchup of matchups) {
    const paid = matchup.players_points ?? {};
    const entries: ValuedPlayer[] = [];
    for (const id of matchup.players ?? []) {
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
      setLineup: mapSetLineup(matchup.starters, settings.startingSlots.length),
      byeTeams,
      projected,
    });

    for (const change of plan.changes) {
      // Only a row that benches one man for another is a call that can come true.
      if (change.chance === null || !change.start || !change.sit || change.sitStays) continue;
      const started = paid[change.start.player.id] ?? 0;
      const sat = paid[change.sit.player.id] ?? 0;
      if (started === sat) continue;

      const fact = change.cause !== 'upgrade' || (projected.get(change.sit.player.id) ?? 0) <= 0;
      rows.push([
        season,
        week,
        league,
        change.start.player.position,
        Math.round(change.chance * 1000),
        started > sat ? 1 : 0,
        change.decisive ? 1 : 0,
        fact ? 1 : 0,
      ]);
    }
  }
  return rows;
}

async function committed(path: string): Promise<TrackRecordFile | null> {
  try {
    const file = JSON.parse(await readFile(path, 'utf8')) as TrackRecordFile;
    return Array.isArray(file.rows) && Array.isArray(file.graded) ? file : null;
  } catch {
    return null;
  }
}

export async function ingestTrackRecord(outDir: string, generatedAt: string): Promise<void> {
  const path = `${outDir}${TRACK_RECORD_FILE}`;
  const existing = await committed(path);
  const graded = new Set(existing?.graded ?? []);
  const rows = [...(existing?.rows ?? [])];
  let added = 0;

  try {
    // The player index is five megabytes, so it is fetched only if a week needs it.
    let players: PlayerIndex | null = null;
    const schedules = new Map<string, SleeperGame[]>();

    for (const [index, id] of TRACK_RECORD_LEAGUES.entries()) {
      let next: string | null | undefined = id;
      while (next) {
        const league = await getLeague(next);
        const season = Number(league.season);
        if (season < FIRST_SEASON) break;
        next = league.previous_league_id;

        const schedule =
          schedules.get(league.season) ?? (await getNflSchedule(league.season));
        schedules.set(league.season, schedule);
        const settings = mapSettings(league);
        const lastRegular = (league.settings?.playoff_week_start ?? 15) - 1;

        for (let week = 1; week <= lastRegular; week++) {
          if (graded.has(weekKey(index, season, week))) continue;
          if (!weekFinished(schedule, week)) break;

          const matchups = await getMatchups(league.league_id, week);
          players ??= await getPlayers();
          const projections = await getProjections(league.season, week, POSITIONS);
          const calls = gradeWeek({
            league: index,
            season,
            week,
            settings,
            schedule,
            projections,
            matchups,
            players,
          });
          rows.push(...calls);
          graded.add(weekKey(index, season, week));
          added++;
        }
      }
    }
  } catch (err) {
    // Weeks graded before the failure are final, so they are kept.
    console.warn(
      `  track record  ${err instanceof Error ? err.message : String(err)} — ` +
        (existing ? `keeping the ${existing.graded.length} weeks already graded` : 'no committed copy'),
    );
    if (added === 0) return;
  }

  const file: TrackRecordFile = {
    generatedAt: added > 0 || !existing ? generatedAt : existing.generatedAt,
    columns: TRACK_RECORD_COLUMNS,
    leagues: TRACK_RECORD_LEAGUES.length,
    graded: [...graded].sort(),
    rows: rows.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]),
  };
  const text = `${JSON.stringify(file)}\n`;
  await writeFile(path, text);
  console.log(
    `  track record  ${added} new league-weeks graded, ${file.graded.length} in all, ` +
      `${file.rows.length} calls, ${(text.length / 1024).toFixed(1)} KB`,
  );
}
