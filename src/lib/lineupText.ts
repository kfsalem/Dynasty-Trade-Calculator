import type { LineupChange } from '../engine/startSit';
import { INJURY_LABEL } from '../engine/availability';
import { COIN_FLIP } from '../engine/projections';
import type { WeekEvidence } from '../engine/weekEvidence';
import { formatChance, formatPoints } from './format';

/**
 * Why a slot changes, in a sentence.
 *
 * Prose lives here rather than in the engine for the reason the rest of this
 * folder exists: `startSit` decides what is true, and this decides how to say
 * it. Keeping them apart is what lets the engine be tested on causes rather
 * than on wording.
 *
 * Every sentence names the man being replaced where there is one, because the
 * action is "start A over B" and half of that is on the other row. The
 * exceptions are the two cases where nobody is being replaced — an empty slot
 * and a player who has left the roster — and saying "for nobody" there would be
 * worse than saying nothing.
 */
export function describeChange(change: LineupChange): string {
  const name = change.sit?.player.name;

  switch (change.cause) {
    case 'empty':
      return change.startIsNew
        ? 'This slot is empty — a slot with nobody in it scores nothing.'
        : 'This slot is empty. Move him up into it; nothing else about the lineup changes.';

    case 'dropped':
      return 'Whoever is in this slot is no longer on your roster.';

    /*
      Named as the team's week off, not as anything about the player. He is
      healthy and carries no designation, which is exactly why this is the
      change most likely to be missed — there is nothing on his row anywhere
      else in the app to suggest he will not play.
    */
    case 'bye':
      return name
        ? `${name} is on bye — his team does not play this week, so the slot scores nothing.`
        : 'This slot holds a player whose team is on bye, so it scores nothing.';

    case 'sidelined': {
      const label = change.status ? INJURY_LABEL[change.status] : 'Unavailable';
      return name ? `${name} — ${label.toLowerCase()}.` : `${label}.`;
    }

    case 'move':
      return 'The same players, in different slots. Worth nothing on its own.';

    default:
      if (change.chance !== null && change.start && change.sit && !change.sitStays) {
        return outscoreSentence(
          change.chance,
          name as string,
          change.start.winNowValue,
          change.sit.winNowValue,
        );
      }
      // Deliberately not "worth more *this week*". The same rows render in the
      // offseason, where there is no this week, and the panel's own header is
      // the thing that says which register it is speaking in.
      return change.sitStays
        ? `${name} moves to another slot to make room.`
        : `Worth more than ${name}.`;
  }
}

/**
 * The verb on a change row.
 *
 * "Start" and "move" are not interchangeable and the distinction is the whole
 * of what the row is asking for: one brings a man off the bench, the other
 * shuffles a starter already in the lineup. A row that says "start" about
 * somebody who is already starting reads as a bug in the app.
 */
export const changeAction = (change: LineupChange): string =>
  change.startIsNew ? 'Start' : 'Move';

/**
 * How sure a projection call is, in a sentence.
 *
 * The chance comes first because it is the answer; the two projections come
 * after because they are how a manager checks it. Below `COIN_FLIP` the
 * sentence says so outright — across 60,000 measured pairs a gap that small
 * goes the other way almost half the time, and a confident "start him" there
 * is the app claiming a precision nobody has.
 */
export function outscoreSentence(
  chance: number,
  otherName: string,
  projected: number,
  otherProjected: number,
): string {
  const figures = `${formatPoints(projected)} projected against ${formatPoints(otherProjected)}`;
  return chance < COIN_FLIP
    ? `A coin flip with ${otherName}: ${figures}.`
    : `${formatChance(chance)} likely to outscore ${otherName}: ${figures}.`;
}

/**
 * The facts behind a player's projection, as one short line.
 *
 * Opponent first, since it is the one thing that changes week to week; then
 * role — snaps, and targets or carries, whichever he gets more of — and then
 * what he has scored. Each part is left out when it is not known rather than
 * shown as a zero, and the whole line is null when nothing is.
 *
 * A quarterback gets no role at all. Every starter plays every snap, and his
 * handful of scrambles counted as "carries" read as though they were his job,
 * which is what the live panel said about Patrick Mahomes the first time it ran.
 */
export function evidenceLine(
  opponent: string | null | undefined,
  evidence: WeekEvidence | undefined,
  position?: string,
): string | null {
  const parts: string[] = [];
  if (opponent) parts.push(`vs ${opponent}`);
  if (evidence && position !== 'QB') {
    if (evidence.snapShare !== null) parts.push(`${Math.round(evidence.snapShare * 100)}% of snaps`);
    const targets = evidence.targetsPerGame ?? 0;
    const carries = evidence.carriesPerGame ?? 0;
    if (targets >= 1 && targets >= carries) parts.push(`${targets.toFixed(1)} targets a game`);
    else if (carries >= 1) parts.push(`${carries.toFixed(1)} carries a game`);
  }
  if (evidence?.pointsPerGame != null) {
    parts.push(`${formatPoints(evidence.pointsPerGame)} points a game`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}
