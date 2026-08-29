import type { ScoringSettings } from '../types';

/**
 * A league's scoring, in words a manager would use.
 *
 * The header said "PPR" and stopped, which for the league this was written
 * against is true and badly incomplete: it is also TE-premium with six-point
 * passing touchdowns, and both change what a player is worth far more than the
 * reception point does. Saying so is the visible half of reading the rules at
 * all — a manager who sees "TE premium" on his own league knows the app is
 * pricing his tight ends the way his league pays them.
 */

/** Sleeper's default for a rule, so only a *deviation* is worth a badge. */
const DEFAULTS: Record<string, number> = {
  pass_td: 4,
  rec_td: 6,
  rush_td: 6,
  pass_yd: 0.04,
  rush_yd: 0.1,
  rec_yd: 0.1,
};

export function pprLabel(ppr: number): string {
  if (ppr >= 1) return 'PPR';
  if (ppr > 0) return `${ppr} PPR`;
  return 'Standard';
}

/**
 * The handful of rules worth putting on the header, and nothing else.
 *
 * A badge per non-zero rule would be fifty badges. These are the ones that move
 * a *position* against the others rather than scaling everyone together, which
 * is what a reader scanning a header can actually act on.
 */
export function scoringBadges(scoring: ScoringSettings): string[] {
  const badges: string[] = [];
  const rule = (key: string) => scoring[key] ?? 0;

  for (const [key, label] of [
    ['bonus_rec_te', 'TE'],
    ['bonus_rec_rb', 'RB'],
    ['bonus_rec_wr', 'WR'],
  ] as const) {
    const bonus = rule(key);
    if (bonus > 0) badges.push(`${label} premium +${bonus}`);
  }

  const passTd = rule('pass_td');
  if (passTd && passTd !== DEFAULTS.pass_td) badges.push(`${passTd}-pt pass TD`);

  // Only worth saying where it is unusual: a quarter-point per yard is four
  // times Sleeper's default and reshapes quarterback value on its own.
  const passYd = rule('pass_yd');
  if (passYd && passYd !== DEFAULTS.pass_yd) badges.push(`${passYd}/pass yd`);

  if (rule('pass_int') < -2) badges.push(`${rule('pass_int')} per INT`);

  return badges;
}

/** Sleeper's rule keys, as a sentence fragment rather than an identifier. */
const RULE_LABELS: Record<string, string> = {
  pass_td_40p: '40+ yard passing touchdowns',
  pass_td_50p: '50+ yard passing touchdowns',
  rush_td_40p: '40+ yard rushing touchdowns',
  rush_td_50p: '50+ yard rushing touchdowns',
  rec_td_40p: '40+ yard receiving touchdowns',
  rec_td_50p: '50+ yard receiving touchdowns',
  pass_int_td: 'interceptions returned for a score',
  rec_0_4: 'receptions by length',
  rec_5_9: 'receptions by length',
  rec_10_19: 'receptions by length',
  rec_20_29: 'receptions by length',
  rec_30_39: 'receptions by length',
  fgm_yds: 'field-goal distance',
  fgm_yds_over_30: 'field-goal distance',
};

/**
 * Name the rules the engine cannot express, without repeating itself.
 *
 * The reception-length bands are five separate Sleeper keys describing one
 * idea, and listing all five would read as five separate failures. Deduped on
 * the label rather than the key for that reason.
 */
export function describeRules(rules: readonly string[]): string[] {
  const labels = rules.map((rule) => RULE_LABELS[rule] ?? rule);
  return [...new Set(labels)];
}

/** "a and b", "a, b and c" — a list a person would read aloud. */
export function joinWords(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * What the league's scoring did to the market's prices, in one sentence.
 *
 * Only the positions that actually moved, and only by how much. The market
 * prices every player for standard scoring at the league's reception value, so
 * in a TE-premium league every tight end arrives underpriced by the size of the
 * premium — this is the app saying it corrected that, and by how much, rather
 * than quietly doing it.
 */
export function premiumSentence(premium: {
  byPosition: Partial<Record<string, number>>;
}): string | null {
  const moved = Object.entries(premium.byPosition)
    .map(([position, multiplier]) => ({
      position,
      pct: Math.round(((multiplier ?? 1) - 1) * 100),
    }))
    .filter((entry) => entry.pct !== 0)
    .sort((a, b) => b.pct - a.pct);

  if (moved.length === 0) return null;

  const phrases = moved.map(
    ({ position, pct }) => `${position} ${pct > 0 ? '+' : ''}${pct}%`,
  );
  return `Market prices are corrected for it: ${joinWords(phrases)}.`;
}
