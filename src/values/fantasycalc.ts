import { z } from 'zod';
import { fetchJson } from '../lib/http';
import { cached, TTL } from '../lib/cache';
import type { LeagueSettings, PlayerValue } from '../types';

const BASE = 'https://api.fantasycalc.com/values/current';

const entrySchema = z.object({
  player: z.object({
    id: z.number(),
    name: z.string(),
    position: z.string().nullish(),
    sleeperId: z.string().nullish(),
    mflId: z.string().nullish(),
    espnId: z.string().nullish(),
    fleaflickerId: z.string().nullish(),
    ffpcId: z.string().nullish(),
    maybeAge: z.number().nullish(),
  }),
  value: z.number(),
  redraftValue: z.number().nullish(),
  overallRank: z.number(),
  positionRank: z.number().nullish(),
  trend30Day: z.number().nullish(),
  maybeTier: z.number().nullish(),
});

const responseSchema = z.array(entrySchema);

/** FantasyCalc only publishes values for these league sizes. */
const SUPPORTED_TEAM_COUNTS = [8, 10, 12, 14, 16];
/** …and these reception-point settings. */
const SUPPORTED_PPR = [0, 0.5, 1];

const nearest = (target: number, options: number[]): number =>
  options.reduce((best, o) => (Math.abs(o - target) < Math.abs(best - target) ? o : best));

/**
 * Cross-platform id map, harvested from the same payload as the values.
 *
 * FantasyCalc carries sleeper/mfl/espn/fleaflicker/ffpc ids on every player,
 * which is what will let a second platform adapter resolve against the same
 * value table without us maintaining an id crosswalk by hand.
 */
export interface ValueBundle {
  /** Keyed by Sleeper player id. */
  bySleeperId: Map<string, PlayerValue>;
  /** Highest raw value in the set, before normalization. */
  rawMax: number;
  fetchedAt: number;
}

export async function fetchFantasyCalcValues(
  settings: LeagueSettings,
): Promise<ValueBundle> {
  const numTeams = nearest(settings.teamCount, SUPPORTED_TEAM_COUNTS);
  const ppr = nearest(settings.ppr, SUPPORTED_PPR);
  const params = new URLSearchParams({
    isDynasty: String(settings.isDynasty),
    numQbs: String(settings.numQbs),
    numTeams: String(numTeams),
    ppr: String(ppr),
  });

  const url = `${BASE}?${params.toString()}`;
  const key = `fantasycalc:${params.toString()}:v1`;

  return cached(key, TTL.VALUES, async () => {
    const rows = await fetchJson(url, responseSchema);

    const rawMax = rows.reduce((max, r) => Math.max(max, r.value), 0) || 1;
    const bySleeperId = new Map<string, PlayerValue>();

    for (const row of rows) {
      const sleeperId = row.player.sleeperId;
      if (!sleeperId) continue;

      bySleeperId.set(sleeperId, {
        playerId: sleeperId,
        // Normalized to a source-independent 0-10000 scale so a second value
        // source can be blended in later without mixing incompatible units.
        value: Math.round((row.value / rawMax) * 10000),
        redraftValue: Math.round(((row.redraftValue ?? 0) / rawMax) * 10000),
        overallRank: row.overallRank,
        positionRank: row.positionRank ?? 0,
        trend30Day: row.trend30Day ?? 0,
        tier: row.maybeTier ?? null,
        source: 'fantasycalc',
      });
    }

    return { bySleeperId, rawMax, fetchedAt: Date.now() };
  });
}
