import type { InjuryStatus, Player } from '../types';

/**
 * Can this player fill a starting slot this season?
 *
 * `Player.injury` has been mapped from Sleeper since Phase 1 and read by
 * nothing but a badge. Meanwhile `bestLineup` — which decides every roster
 * ranking, every VORS delta and every trade suggestion — happily started a
 * receiver on injured reserve, because a roster's `playerIds` includes its IR
 * and taxi men and nothing downstream asked whether they could play.
 *
 * The split below is the whole model. Two statuses, two different mistakes:
 *
 * - **Out for the season.** A player on IR or PUP is not a worse starter, he is
 *   not a starter. Leaving him in the lineup overstates the roster *and*
 *   understates the hole the trade engine should be solving for, which is the
 *   more expensive half — a team whose best tight end is on PUP reads as set at
 *   the position and gets offered nothing.
 * - **Week to week.** Questionable and doubtful are surfaced and nothing else.
 *   They are noise on a season-length question: most questionable players play,
 *   the tag flips twice a week, and a model that repriced on it would rewrite
 *   every roster in the league each Friday. `out` sits here too — Sleeper's
 *   "Out" means out for the *next game*, not the year.
 *
 * Nothing here touches a value. An injured player is still worth what the market
 * says he is worth: dynasty value already prices the risk that a 24-year-old
 * misses a season, and marking him down a second time in this app would charge
 * him twice. He simply is not in the lineup — which is what R8 built a separate
 * win-now scale to be able to say.
 *
 * Deliberately read from the NFL designation rather than from the manager's own
 * IR slot (`Roster.reserveIds`), which was the tempting alternative and is the
 * wrong input. On the real league one manager parks three players in IR slots,
 * of whom two are merely questionable — reserve slots are spare bench space in
 * the offseason, so trusting them would bench a healthy WR1 on a roster-
 * management choice.
 */
export type Availability = 'available' | 'week_to_week' | 'out_for_season';

/**
 * Statuses that keep a player out of every lineup this season.
 *
 * `sus` groups with the injuries because the feed carries no return date for a
 * suspension, and a suspension of unknown length is not something to guess at.
 * `dnr` and `na` are roster designations rather than injuries, and they are here
 * for the plainest possible reason: a player who has not reported to his team,
 * or who is not on an active NFL roster, cannot score points for yours. Both are
 * live cases — the real league rosters a receiver whose only designation is
 * `DNR`, and until this list existed the mapper dropped that word on the floor.
 */
const OUT_FOR_SEASON = new Set<InjuryStatus['status']>(['ir', 'pup', 'sus', 'dnr', 'na']);

/**
 * How a status reads in a sentence, where the badge shows only the abbreviation.
 */
export const INJURY_LABEL: Record<InjuryStatus['status'], string> = {
  healthy: 'Healthy',
  questionable: 'Questionable',
  doubtful: 'Doubtful',
  out: 'Out this week',
  ir: 'On injured reserve',
  pup: 'On the physically-unable-to-perform list',
  sus: 'Suspended',
  dnr: 'On the did-not-report list',
  na: 'Not on an active NFL roster',
  unknown: 'Status unclear',
};

function classify(status: InjuryStatus['status'] | undefined): Availability {
  if (!status || status === 'healthy') return 'available';
  // An unrecognised designation falls through to week-to-week rather than being
  // treated as season-ending. Both directions are wrong when the status is a
  // mystery, but only one of them silently deletes a starter from a lineup on
  // the strength of a word nobody has read.
  return OUT_FOR_SEASON.has(status) ? 'out_for_season' : 'week_to_week';
}

export const availability = (player: Player): Availability =>
  classify(player.injury?.status);

/** True when a player may be picked for a starting slot. */
export const canStart = (player: Player): boolean =>
  availability(player) !== 'out_for_season';

/**
 * The sentence behind the badge: what the status is, and what the app did
 * about it.
 *
 * The second half is the part worth writing. A player vanishing from a lineup
 * with no explanation is indistinguishable from a bug, and this app has already
 * been bitten once by a number that was right on a screen that did not say what
 * it meant.
 */
export function injuryNote(injury: InjuryStatus): string {
  const label =
    injury.status === 'unknown' && injury.description
      ? `Carrying the status "${injury.description}", which this app does not recognise`
      : INJURY_LABEL[injury.status];

  switch (classify(injury.status)) {
    case 'out_for_season':
      return `${label}. Held out of the best lineup — he cannot fill a starting slot this season. His value as an asset is unchanged.`;
    case 'week_to_week':
      return `${label}. Week to week, so he still fills a slot and his value is not marked down for it.`;
    default:
      return label;
  }
}
