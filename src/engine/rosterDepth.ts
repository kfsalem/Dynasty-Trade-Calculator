import type { LineupSlot } from '../types';
import {
  bestLineup,
  byWinNow,
  type LineupAssignment,
  type RosterSummary,
  type ValuedPlayer,
} from './rosterValue';

/**
 * A lineup read as slots rather than as positions, and what happens to it when
 * a starter goes down.
 *
 * Both halves exist because `analysis` measures a roster at the wrong grain.
 * `positionalStarterValue` sums a position across the whole lineup, so two
 * elite receivers and a hole at WR3 add up to *strength at WR* — the hole is
 * arithmetically hidden by the men above it. A manager never asks the summed
 * question. He asks whether his WR3 is better than the other WR3s, because that
 * is the matchup his Sunday actually contains.
 *
 * Nothing here values a player. Every number is a regroup or a re-run of what
 * `rosterValue` already computed, which is the point: the machinery outran the
 * surfaces reading it.
 */

/**
 * One starting slot, identified finely enough to compare across rosters.
 *
 * A lineup carries repeats — three WR slots, two RB — and `bestLineup` fills
 * them in an order that is deliberate about restrictiveness and arbitrary about
 * everything else, so which of two receivers lands in the first WR slot means
 * nothing. Ranking the occupants within their own slot kind is what makes the
 * identity stable: `WR2` is the second-best receiver a roster starts, on every
 * roster, however the filler happened to order them.
 */
export interface SlotOccupant {
  slot: LineupSlot;
  /** 1-based rank among slots of the same kind. `WR2` has ordinal 2. */
  ordinal: number;
  /** `QB`, `WR2`, `FLEX` — the ordinal is dropped when the kind is unique. */
  label: string;
  entry: ValuedPlayer | null;
  /** Win-now value, and 0 for a slot nobody fills. */
  value: number;
}

/** One slot, this roster's occupant of it, and the league's at the same slot. */
export interface SlotStrength extends SlotOccupant {
  leagueMedian: number;
  /** 1 is the best in the league at this slot. Ties share the better rank. */
  rank: number;
  teamCount: number;
  /**
   * Fraction of the league this roster is at or above here, 0-1.
   *
   * The margin the rank throws away. "3rd of 10 at WR2" reads identically
   * whether the two above are 2% better or 40% better, and `contentionProfile`
   * already learned this once when `nowShare` was added for the same reason.
   */
  share: number;
  /**
   * Standard deviations from the league mean at this slot.
   *
   * Kept alongside `share` because the verdict is cut on it, at the same 0.75
   * bar `analyzeTeam` has always used for positions. The grain changes here;
   * the bar deliberately does not, so a verdict that moves moved because the
   * measurement was regrouped and not because the threshold was retuned under
   * cover of the same change.
   */
  z: number;
  verdict: 'strength' | 'weakness' | 'neutral';
}

/**
 * What one starter is actually worth to the lineup he is in, and what is behind
 * him.
 *
 * This is replacement level pointed inward. `engine/replacement` asks what a
 * position is worth against the league's supply of it; this asks what a man is
 * worth against *this roster's* next body, which is a different number and the
 * one that decides whether losing him is a headline or a shrug. The two must
 * not be confused in the UI.
 */
export interface StarterDepth {
  entry: ValuedPlayer;
  /** The slot he occupies, by `SlotOccupant.label`. */
  slotLabel: string;
  /**
   * Win-now value the lineup loses without him.
   *
   * The whole lineup's drop, not his value less the next man at his position,
   * and the difference is the reason this is computed rather than derived. Take
   * a starting receiver out and the greedy filler cascades: the FLEX moves up
   * into the empty WR slot and a bench body drops into the FLEX. What the
   * roster loses is the bottom of that chain, which can be far less than the
   * man removed at the top of it.
   */
  marginalValue: number;
  /**
   * The player who enters the lineup in his absence, or null when nobody does.
   *
   * Well-defined despite the cascade: removing one man from the pool admits at
   * most one new man to the starting eleven, whichever slot he ends up in.
   */
  replacement: ValuedPlayer | null;
  /**
   * The lineup fields one man fewer without him — the slot cannot be refilled.
   *
   * A hard fact with no threshold in it, which is why fragility is counted on
   * this rather than on a drop large enough to look like a cliff. A league that
   * starts one tight end and a roster that carries one tight end is one
   * hamstring from fielding ten men, and no bar has to be chosen to say so.
   */
  uncovered: boolean;
}

/** How much of this lineup has nothing behind it. */
export interface Fragility {
  /**
   * Starters whose slot cannot be refilled *and* whose absence costs something.
   *
   * Both halves are load-bearing, and the second one is why this is a count
   * rather than a filter on `uncovered` alone. Nobody carries a backup kicker.
   * In a league that starts a K and a DEF — as this one does — every roster has
   * two bare slots at all times, so counting the raw fact would put the same
   * two-item warning on all twelve teams every week of the season. That is
   * furniture, and furniture stops being read, which costs the sentence its
   * force in the weeks a bare *quarterback* slot actually matters.
   *
   * `marginalValue > 0` is the filter, and it is a zero rather than a tuned
   * bar: K and DEF carry no value in this app at all (#10), so they fall out
   * on their own without the measure having to name a position.
   */
  uncoveredSlots: number;
  /** The single largest drop any one absence would cost. */
  worstDrop: number;
  /** Every starter, by drop, worst first. */
  starters: StarterDepth[];
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

const lineupValue = (lineup: LineupAssignment[]): number =>
  lineup.reduce((sum, slot) => sum + (slot.entry?.winNowValue ?? 0), 0);

const filledSlots = (lineup: LineupAssignment[]): number =>
  lineup.filter((slot) => slot.entry !== null).length;

/**
 * Regroup a filled lineup into ranked slots.
 *
 * Sorted by win-now value within each slot kind, because that is the scale the
 * lineup was filled on and the scale a Sunday is decided on. An empty slot
 * sorts to the bottom at 0, so a roster starting two receivers in three WR
 * slots reports a WR3 worth nothing rather than reporting no WR3 — which is the
 * hole the summed measure was hiding, stated in the place it belongs.
 */
export function slotOccupants(lineup: LineupAssignment[]): SlotOccupant[] {
  const byKind = new Map<LineupSlot, (ValuedPlayer | null)[]>();
  for (const { slot, entry } of lineup) {
    const group = byKind.get(slot);
    if (group) group.push(entry);
    else byKind.set(slot, [entry]);
  }

  const out: SlotOccupant[] = [];
  for (const [slot, entries] of byKind) {
    const ranked = [...entries].sort((a, b) =>
      a === null && b === null ? 0 : a === null ? 1 : b === null ? -1 : byWinNow(a, b),
    );
    ranked.forEach((entry, i) => {
      out.push({
        slot,
        ordinal: i + 1,
        label: entries.length === 1 ? String(slot) : `${slot}${i + 1}`,
        entry,
        value: entry?.winNowValue ?? 0,
      });
    });
  }
  return out;
}

/**
 * Every slot of one roster, ranked against the same slot on every other.
 *
 * The comparison `positionalStarterValue` cannot make. It costs nothing beyond
 * a regroup — `bestLineup` has already run for every roster in the league by
 * the time a summary exists, so the whole slot-level distribution is data the
 * app is holding rather than a new computation.
 *
 * A roster whose lineup has a slot kind the rest of the league does not is
 * compared against itself, which reads as exactly average. That is a league
 * whose rosters disagree about their own settings, so there is no distribution
 * to rank against and claiming one would be inventing it.
 */
export function slotStrengths(summary: RosterSummary, all: RosterSummary[]): SlotStrength[] {
  const leagueByLabel = new Map<string, number[]>();
  for (const other of all) {
    for (const occupant of slotOccupants(other.lineup)) {
      const values = leagueByLabel.get(occupant.label);
      if (values) values.push(occupant.value);
      else leagueByLabel.set(occupant.label, [occupant.value]);
    }
  }

  return slotOccupants(summary.lineup).map((occupant) => {
    const league = leagueByLabel.get(occupant.label) ?? [occupant.value];
    const mean = league.reduce((a, b) => a + b, 0) / league.length;
    const variance = league.reduce((sum, v) => sum + (v - mean) ** 2, 0) / league.length;
    const stdDev = Math.sqrt(variance);
    const z = stdDev > 0 ? (occupant.value - mean) / stdDev : 0;

    return {
      ...occupant,
      leagueMedian: median(league),
      rank: league.filter((v) => v > occupant.value).length + 1,
      teamCount: league.length,
      // A single team is its own whole league and sits in the middle of it,
      // matching `contentionProfile`'s share rather than claiming an extreme.
      share:
        league.length <= 1
          ? 0.5
          : league.filter((v) => v < occupant.value).length / (league.length - 1),
      z,
      verdict: z >= 0.75 ? 'strength' : z <= -0.75 ? 'weakness' : 'neutral',
    };
  });
}

/**
 * What each starter is worth to his own lineup, by taking him out of it.
 *
 * One `bestLineup` per starter, which is the honest way to get it: the cascade
 * a removal sets off is exactly what the number is supposed to capture, and any
 * closed form for it would be re-deriving the filler's own rules in a second
 * place. The cost is one lineup fill per starting slot for one roster — the
 * same order `futureScore` already pays for every roster in the league.
 *
 * Run on the win-now scale and against this season's available players, because
 * the question is who plays on Sunday if this man cannot.
 */
export function starterDepth(
  summary: RosterSummary,
  startingSlots: LineupSlot[],
): StarterDepth[] {
  const full = lineupValue(summary.lineup);
  const fullSlots = filledSlots(summary.lineup);

  const out: StarterDepth[] = [];
  for (const occupant of slotOccupants(summary.lineup)) {
    const entry = occupant.entry;
    if (!entry) continue;

    const without = bestLineup(
      summary.players.filter((e) => e.player.id !== entry.player.id),
      startingSlots,
    );

    const replacement =
      without
        .map((slot) => slot.entry)
        .find((e): e is ValuedPlayer => e !== null && !summary.starterIds.has(e.player.id)) ??
      null;

    out.push({
      entry,
      slotLabel: occupant.label,
      marginalValue: full - lineupValue(without),
      replacement,
      // Asked of the lineup rather than of the roster's eligibility, because
      // the cascade decides this and a direct eligibility test gets it wrong.
      // A roster starting one tight end at TE and another in the FLEX *can*
      // cover TE — the second man slides across and a bench body takes the
      // FLEX behind him — so "no eligible non-starter at this position" would
      // report a covered slot as bare. Fielding one man fewer is the fact, and
      // the filler is what establishes it.
      uncovered: filledSlots(without) < fullSlots,
    });
  }

  return out.sort(
    (a, b) =>
      b.marginalValue - a.marginalValue ||
      (a.entry.player.id < b.entry.player.id ? -1 : 1),
  );
}

/** Starters with nothing behind them and something to lose. See `uncoveredSlots`. */
export const bareSlots = (starters: StarterDepth[]): StarterDepth[] =>
  starters.filter((s) => s.uncovered && s.marginalValue > 0);

/** `starterDepth`, plus the two counts a manager reads off it. */
export function fragility(summary: RosterSummary, startingSlots: LineupSlot[]): Fragility {
  const starters = starterDepth(summary, startingSlots);
  return {
    uncoveredSlots: bareSlots(starters).length,
    worstDrop: starters.length > 0 ? starters[0].marginalValue : 0,
    starters,
  };
}
