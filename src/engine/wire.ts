import type { LineupSlot } from '../types';
import type { FreeAgent, FreeAgentBoard } from './freeAgents';
import { slotEligibility, type LineupAssignment, type ValuedPlayer } from './rosterValue';
import { CLEAR_MARGIN, relativeMargin } from './startSit';
import { canPlayThisWeek } from './availability';
import { onBye } from './byes';

/**
 * Free agents who would improve the lineup you are about to field.
 *
 * The lineup panel stops at the edge of the roster, so the app can say "start
 * Smith over Jones" and cannot say the more valuable thing: that the best
 * receiver on the wire is better than both. #46 made that comparison legal —
 * free agents are priced against the same replacement levels as every rostered
 * player, deliberately, so a free agent's 900 and a starter's 900 mean the same
 * thing — and nothing had used it.
 *
 * Measured against the real ten-team league on 2026-08-27: **7 of 100 starting
 * slots held a man an unrostered player would beat.** Five were quarterbacks,
 * which is exactly right for a 1QB league — ten teams start ten of them, so
 * QB11 is on the wire by construction and somebody is always starting worse.
 *
 * **Priced free agents only, and that is a rule rather than a shortcut.** Three
 * quarters of the wire has no published value (649 of 858 on that league), and
 * #10's standing rule is that no published value is not the same as worth
 * nothing. Claiming an unpriced player beats a starter would require inventing
 * the number that comparison rests on, which is the one thing the free-agent
 * board was built not to do. Those players are ranked by playing time on their
 * own board, where no arithmetic crosses between the two groups; this panel
 * links there rather than repeating it in a currency it does not have.
 */

export interface WireUpgrade {
  slot: LineupSlot;
  /** Position in `startingSlots`, so a league's two FLEX slots stay distinct. */
  index: number;
  /** The free agent to claim. Always one the market prices — see above. */
  add: FreeAgent;
  /** His win-now value, already league-adjusted. */
  addValue: number;
  /** The man he would replace in that slot. */
  replaces: ValuedPlayer;
  /** Same measure the change rows use, against the same bar. */
  margin: number;
  /**
   * Who comes off the roster to make room, or null when nothing is spare.
   *
   * Named because nearly every add is an add/drop, and a recommendation that
   * ignores the cost is only half of one. Null is an honest answer: a roster
   * with no droppable player is being told the claim costs something it has to
   * choose, which is not this panel's decision to make.
   */
  drop: ValuedPlayer | null;
}

export interface WireInput {
  /** The lineup being recommended, from `StartSitPlan.lineup`. */
  lineup: LineupAssignment[];
  /** Every rostered player, valued. `RosterSummary.players`. */
  entries: ValuedPlayer[];
  board: FreeAgentBoard | undefined;
  /** Teams with no game this week, so a claim is not made for one of them. */
  byeTeams?: ReadonlySet<string> | null;
}

/**
 * The cheapest player to let go, in dynasty terms.
 *
 * A drop is an asset decision even when the add is a lineup one — you keep the
 * points either way and lose the player for good — so this ranks on `value`,
 * not on `winNowValue`. Ranking on win-now would offer up a 22-year-old with no
 * role ahead of a 31-year-old bench body, which is backwards: the rookie is the
 * asset and the veteran is the roster spot.
 *
 * Nobody in the recommended lineup is ever a candidate, including anyone the
 * wire is about to displace — a slot cannot be filled by dropping the man
 * filling it.
 */
function dropCandidate(
  entries: ValuedPlayer[],
  keep: ReadonlySet<string>,
): ValuedPlayer | null {
  const spare = entries.filter((entry) => !keep.has(entry.player.id));
  if (spare.length === 0) return null;

  return spare.reduce((worst, entry) => (entry.value < worst.value ? entry : worst));
}

/**
 * One suggested claim per starting slot, best first.
 *
 * A free agent is only offered where he clears `CLEAR_MARGIN` over the man in
 * the slot, the same bar an internal swap has to clear. Telling somebody to
 * spend a waiver claim on a 3% upgrade is worse advice than telling him to bench
 * a starter for one, because it costs him a roster spot as well as being noise —
 * and the real league had exactly that case, a receiver beating a starter by 3%.
 *
 * One player is never offered twice. The best quarterback on the wire beats a
 * starter on several rosters at once, but he does not beat several slots on
 * *yours* — offering him for two of them would be one claim presented as two
 * upgrades.
 */
export function wireUpgrades({
  lineup,
  entries,
  board,
  byeTeams,
}: WireInput): WireUpgrade[] {
  if (!board) return [];

  const off = byeTeams ?? new Set<string>();
  const available = board.priced.filter(
    (fa) =>
      fa.value !== null &&
      fa.value.winNowValue > 0 &&
      canPlayThisWeek(fa.player) &&
      !onBye(fa.player.team, off),
  );
  if (available.length === 0) return [];

  const starting = new Set(
    lineup.map((a) => a.entry?.player.id).filter((id): id is string => Boolean(id)),
  );

  const taken = new Set<string>();
  const upgrades: WireUpgrade[] = [];

  // Best slots first, so the scarcest free agent is spent on the biggest hole
  // rather than on whichever slot the league happens to list first.
  const candidates: (WireUpgrade & { sort: number })[] = [];

  for (const [index, { slot, entry }] of lineup.entries()) {
    if (!entry) continue;
    const eligible = slotEligibility(slot);

    for (const fa of available) {
      if (!eligible.includes(fa.player.position)) continue;
      const addValue = fa.value?.winNowValue ?? 0;
      const margin = relativeMargin(addValue, entry.winNowValue);
      if (margin < CLEAR_MARGIN) continue;

      candidates.push({
        slot,
        index,
        add: fa,
        addValue,
        replaces: entry,
        margin,
        drop: null,
        sort: addValue - entry.winNowValue,
      });
    }
  }

  candidates.sort((a, b) => b.sort - a.sort || a.index - b.index);

  const filled = new Set<number>();
  /**
   * Bodies already spoken for as a drop.
   *
   * Two claims need two roster spots. Without this both would nominate the same
   * worst player, which reads as one spot doing two jobs — and a manager who
   * followed both would be a man over the limit.
   */
  const dropped = new Set<string>();

  for (const candidate of candidates) {
    if (taken.has(candidate.add.player.id) || filled.has(candidate.index)) continue;
    taken.add(candidate.add.player.id);
    filled.add(candidate.index);

    const drop = dropCandidate(entries, new Set([...starting, ...dropped]));
    if (drop) dropped.add(drop.player.id);

    upgrades.push({
      slot: candidate.slot,
      index: candidate.index,
      add: candidate.add,
      addValue: candidate.addValue,
      replaces: candidate.replaces,
      margin: candidate.margin,
      drop,
    });
  }

  return upgrades;
}
