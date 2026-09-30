import type { LineupSlot } from '../types';
import type { FreeAgent, FreeAgentBoard } from './freeAgents';
import { slotEligibility, type LineupAssignment, type ValuedPlayer } from './rosterValue';
import { CLEAR_MARGIN, relativeMargin } from './startSit';
import { canPlayThisWeek } from './availability';
import { onBye } from './byes';
import { outscoreChance, WORTH_ACTING } from './projections';

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
  /**
   * The free agent to claim. On a value plan always one the market prices —
   * see above; on a projection plan anyone projected, priced or not.
   */
  add: FreeAgent;
  /** His win-now value, or his projected points on a projection plan. */
  addValue: number;
  /** The chance he outscores `replaces` this week. Null on a value plan. */
  chance: number | null;
  /** The man he would replace in that slot. */
  replaces: ValuedPlayer;
  /** Same measure the change rows use, against the same bar. */
  margin: number;
  /**
   * Who comes off the roster to make room, or null when nobody has to.
   *
   * Named because nearly every add is an add/drop, and a recommendation that
   * ignores the cost is only half of one. Null has two meanings, told apart by
   * `room`: an open roster spot takes the claim with no drop at all, or there
   * is genuinely nobody who could go, which is a choice this panel is not
   * entitled to make for him.
   */
  drop: ValuedPlayer | null;
  /** True when an open spot on the active roster takes this claim, so nobody goes. */
  room: boolean;
}

/** The roster the claims land on. `Roster` narrowed to what room depends on. */
export interface WireRoster {
  playerIds: string[];
  taxiIds: string[];
  reserveIds: string[];
}

export interface WireInput {
  /** The lineup being recommended, from `StartSitPlan.lineup`. */
  lineup: LineupAssignment[];
  /** Every rostered player, valued. `RosterSummary.players`. */
  entries: ValuedPlayer[];
  board: FreeAgentBoard | undefined;
  /** Teams with no game this week, so a claim is not made for one of them. */
  byeTeams?: ReadonlySet<string> | null;
  /** Whose roster the claims land on, for who takes up a spot. */
  roster: WireRoster;
  /**
   * This week's projected points, when the plan ranked on them.
   *
   * Changes who is eligible as well as how they rank. Three quarters of the
   * wire has no market price, and kickers and defences have none at all (#10),
   * so on value they can never be offered; a projection is a real number for
   * every one of them, and the rule against inventing a price no longer
   * applies once nobody has to. Must be the same map the plan used, or the two
   * sides of each comparison are in different units.
   */
  projected?: ReadonlyMap<string, number>;
  /**
   * Players the active roster holds: starters plus bench, `allSlots.length`.
   * Taxi and IR are separate allowances and are not counted against it.
   */
  activeLimit: number;
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
 * Only a player on the active roster makes room. Releasing a man from IR or
 * the taxi squad frees an IR or taxi spot, which a claimed player cannot use,
 * so the claim still does not fit — the same rule `suggest.chooseDrops` applies
 * to trades. Before it was applied here the panel told one manager to drop an
 * injured player who was taking up no space at all.
 *
 * Nobody who stays in the recommended lineup is a candidate. The man the claim
 * displaces is: once the free agent takes his slot he is a bench body like any
 * other, and he is often exactly the one to cut.
 */
function dropCandidate(
  entries: ValuedPlayer[],
  eligible: (entry: ValuedPlayer) => boolean,
): ValuedPlayer | null {
  const spare = entries.filter(eligible);
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
  roster,
  activeLimit,
  projected,
}: WireInput): WireUpgrade[] {
  if (!board) return [];

  const off = byeTeams ?? new Set<string>();
  const worth = (fa: FreeAgent): number =>
    projected ? (projected.get(fa.player.id) ?? 0) : (fa.value?.winNowValue ?? 0);
  const available = (projected ? board.all : board.priced).filter(
    (fa) =>
      (projected || fa.value !== null) &&
      worth(fa) > 0 &&
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
      const addValue = worth(fa);
      const margin = relativeMargin(addValue, entry.winNowValue);
      const chance = projected ? outscoreChance(addValue - entry.winNowValue) : null;
      // The same bar the plan holds a bench swap to, in the plan's own units.
      if (chance !== null ? chance < WORTH_ACTING : margin < CLEAR_MARGIN) continue;

      candidates.push({
        slot,
        index,
        add: fa,
        addValue,
        replaces: entry,
        margin,
        chance,
        drop: null,
        room: false,
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

  const held = new Set([...roster.taxiIds, ...roster.reserveIds]);
  const active = roster.playerIds.filter((id) => !held.has(id)).length;
  /** Open spots on the active roster, spent one claim at a time, best claim first. */
  let open = Math.max(0, activeLimit - active);

  /** Starters who stay starters, once every claim so far has taken its slot. */
  const displaced = new Set<string>();

  for (const candidate of candidates) {
    if (taken.has(candidate.add.player.id) || filled.has(candidate.index)) continue;
    taken.add(candidate.add.player.id);
    filled.add(candidate.index);
    displaced.add(candidate.replaces.player.id);

    const room = open > 0;
    let drop: ValuedPlayer | null = null;
    if (room) {
      open--;
    } else {
      drop = dropCandidate(
        entries,
        (entry) =>
          !held.has(entry.player.id) &&
          !dropped.has(entry.player.id) &&
          (!starting.has(entry.player.id) || displaced.has(entry.player.id)),
      );
      if (drop) dropped.add(drop.player.id);
    }

    upgrades.push({
      slot: candidate.slot,
      index: candidate.index,
      add: candidate.add,
      addValue: candidate.addValue,
      replaces: candidate.replaces,
      margin: candidate.margin,
      chance: candidate.chance,
      drop,
      room,
    });
  }

  return upgrades;
}
