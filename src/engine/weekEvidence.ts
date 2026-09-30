import type { OpportunityFile, ScoringFile, SnapCountsFile } from '../data/types';
import type { ScoringSettings } from '../types';
import { scoreWeeks } from './scoring';

/**
 * What a player has actually done this season, for the lineup panel to show
 * beside a call (#149).
 *
 * Evidence, never an input to the ranking. Fitted on 2024 and tested on 2025,
 * none of these moved the weekly projection closer to the truth — the
 * projection already contains them — and points per game on its own chose
 * lineups that lost to the manager's by 2.5 points a week. They are here
 * because a manager deciding between two receivers wants to see the role
 * behind the number, and a call that hides its evidence is one he cannot
 * check.
 */
export interface WeekEvidence {
  /** Games this season with a snap report. */
  games: number;
  /** Mean offensive snap share this season, 0-1. */
  snapShare: number | null;
  targetsPerGame: number | null;
  carriesPerGame: number | null;
  /** Points per game this season, under the league's own rules. */
  pointsPerGame: number | null;
}

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Evidence for everyone the three weekly files cover, from the season being
 * played only.
 *
 * A file from another season contributes nothing. Last November's snap share
 * is fair context in July, and the free-agent board labels it as such — but
 * beside a call for this Sunday it would read as this year's role.
 */
export function weekEvidence({
  season,
  snaps,
  usage,
  scoring,
  rules,
}: {
  season: number;
  snaps: SnapCountsFile | null | undefined;
  usage: OpportunityFile | null | undefined;
  scoring: ScoringFile | null | undefined;
  rules: ScoringSettings;
}): Map<string, WeekEvidence> {
  const out = new Map<string, WeekEvidence>();
  const row = (id: string): WeekEvidence => {
    let evidence = out.get(id);
    if (!evidence) {
      evidence = {
        games: 0,
        snapShare: null,
        targetsPerGame: null,
        carriesPerGame: null,
        pointsPerGame: null,
      };
      out.set(id, evidence);
    }
    return evidence;
  };

  if (snaps?.season === season) {
    for (const [id, player] of Object.entries(snaps.players)) {
      if (player.weeks.length === 0) continue;
      const evidence = row(id);
      evidence.games = player.weeks.length;
      evidence.snapShare = mean(player.weeks.map(([, , pct]) => pct));
    }
  }

  if (usage?.season === season) {
    for (const [id, player] of Object.entries(usage.players)) {
      if (player.weeks.length === 0) continue;
      const evidence = row(id);
      evidence.targetsPerGame = mean(player.weeks.map(([, targets]) => targets));
      evidence.carriesPerGame = mean(player.weeks.map((week) => week[5]));
    }
  }

  if (scoring?.season === season) {
    for (const [id, player] of Object.entries(scoring.players)) {
      if (player.weeks.length === 0) continue;
      row(id).pointsPerGame = scoreWeeks(player.weeks, player.pos, rules) / player.weeks.length;
    }
  }

  return out;
}

/**
 * The last week every current-season evidence file covers, or null.
 *
 * The lowest of the three, so the line on screen never claims more than the
 * stalest file supports. The files refresh on Tuesdays; a run that fails
 * leaves them a week behind with nothing else on the page to say so, which is
 * why the panel prints this rather than trusting it.
 */
export function evidenceThrough(
  season: number,
  files: ({ season: number; throughWeek: number | null } | null | undefined)[],
): number | null {
  const weeks = files
    .filter((file) => file?.season === season && file.throughWeek !== null)
    .map((file) => file!.throughWeek as number);
  return weeks.length > 0 ? Math.min(...weeks) : null;
}
