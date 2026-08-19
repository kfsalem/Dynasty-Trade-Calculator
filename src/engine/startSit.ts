import type { InjuryStatus, LineupSlot } from '../types';
import {
  bestLineup,
  byRestrictiveness,
  byWinNow,
  slotEligibility,
  type LineupAssignment,
  type ValuedPlayer,
} from './rosterValue';
import { availability, canPlayThisWeek } from './availability';

/**
 * The lineup you have set, against the lineup you could field.
 *
 * `bestLineup` has computed the second half since Phase 1, but only ever as a
 * valuation internal — a way to score a roster, never a thing the manager was
 * shown against his own lineup. R14 is the observation that the same function,
 * asked a slightly different question, is the feature people open an app for
 * every week rather than twice a season.
 *
 * The question really is different, and in one specific way. `bestLineup`
 * answers over a *season*, so `engine/availability` deliberately keeps a player
 * who is "Out" in the pool: the tag means out for the next game, and a
 * season-length valuation that repriced every roster each Friday would be
 * noise. A lineup for Sunday inverts that exactly — a man who is out scores
 * nothing, and starting him is the single most expensive mistake this surface
 * can catch. `canPlayThisWeek` is that inversion, and it is the whole reason
 * this file is not a two-line diff of `summarizeRoster`.
 *
 * **What this does not know, and does not pretend to.** Values here are
 * season-long win-now prices, corrected for role and availability. They are not
 * weekly projections: no opponent, no game script, and — because no feed this
 * app reads publishes one — no bye weeks. So it answers "who are my best
 * eligible players" and not "who scores most this Sunday", and the UI says so
 * rather than letting a confident-looking list imply otherwise.
 */

/**
 * Why a slot changes. One cause per slot, the most decisive one.
 *
 * Ordered by how much the manager needs to hear it: an empty slot is a
 * guaranteed zero, a dropped player is a lineup that no longer exists, an
 * injury is a fact he may not have seen, and only then does the app get to
 * offer an opinion about who is better.
 */
export type ChangeCause = 'empty' | 'dropped' | 'sidelined' | 'upgrade' | 'move';

export interface LineupChange {
  slot: LineupSlot;
  /** Position in `startingSlots`, so a league's two FLEX slots stay distinct. */
  index: number;
  /** Who to put in the slot, or null when nobody eligible is left to fill it. */
  start: ValuedPlayer | null;
  /**
   * Who is in it now. Null for an empty slot *and* for a player who is no
   * longer on the roster — `cause` is what tells those apart, since a dropped
   * player has no record left here to name him by.
   */
  sit: ValuedPlayer | null;
  /**
   * True when `sit` is not actually leaving the lineup, only moving to another
   * slot. Nobody is being benched, so "start X over Y" would be a false
   * sentence and the UI says something else.
   */
  sitStays: boolean;
  /**
   * True when `start` is joining the lineup rather than sliding over from
   * another slot. The difference between "start him" and "move him here", and
   * the difference between a row that is worth something and a row that is
   * tidying.
   */
  startIsNew: boolean;
  cause: ChangeCause;
  /** The designation behind a `sidelined` cause, for naming it exactly. */
  status?: InjuryStatus['status'];
  /**
   * Win-now value this row adds, counting only players entering or leaving the
   * lineup as a set — a man shuffled between two slots is worth what he was
   * worth. Row gains therefore sum to `StartSitPlan.gain` exactly, which is the
   * property that lets the panel show both without them contradicting.
   */
  gain: number;
}

export interface StartSitPlan {
  /**
   * The lineup to field, slot by slot — arranged to agree with the set one
   * wherever that is legal, so the only rows that differ are rows that matter.
   */
  lineup: LineupAssignment[];
  /** Slots where the two disagree, most valuable first. */
  changes: LineupChange[];
  /** Total win-now value the changes add. Zero when the lineup is already best. */
  gain: number;
  /** What the set lineup is worth, counting a sidelined or missing starter as nothing. */
  setValue: number;
  /** What the recommended lineup is worth. */
  recommendedValue: number;
  /**
   * No lineup to compare against — a new roster, or a platform that publishes
   * one this app cannot align to the league's slots.
   *
   * The panel then recommends instead of correcting. Telling someone he has
   * made ten mistakes when he has simply never set a lineup is the failure this
   * flag exists to prevent.
   */
  unset: boolean;
  /**
   * Recommended starters carrying a designation that could still flip before
   * kickoff — questionable, or a word this app does not recognise.
   *
   * They are in the lineup: most questionable players play, and benching on the
   * tag would empty half a lineup for nothing. Worth naming anyway, because the
   * one thing a manager can do with a questionable starter is check again later,
   * and he can only do that if he knows which one to check.
   */
  watch: ValuedPlayer[];
}

export interface StartSitInput {
  /** Every rostered player, valued. `RosterSummary.players`. */
  entries: ValuedPlayer[];
  startingSlots: LineupSlot[];
  /** `Roster.setLineup` — aligned to the slots, or empty when unknown. */
  setLineup: (string | null)[];
}

/**
 * Rearrange an already-chosen lineup to agree with the manager's own wherever
 * it legally can.
 *
 * Without this the panel reports noise. Two legal fillings of the same slots by
 * the same players are the same lineup, but a slot-by-slot diff against a
 * differently-ordered one shows every slot as a change — swap two receivers
 * between WR2 and the FLEX and the app invents two corrections that cancel.
 *
 * So: walk the slots most-restrictive first, and at each one take the player
 * the manager already has there if he is in the chosen set and eligible for it.
 * Everyone else fills in by win-now value, skipping anyone still pinned to a
 * slot further down the list. The set of starters is untouched — only their
 * arrangement moves — so the lineup's value cannot change here.
 *
 * Pinning can strand somebody: pin a running back into the FLEX and the RB slot
 * behind him may be left with only a receiver to choose from. Restrictive-first
 * order makes that rare, and the check at the end makes it harmless — a chosen
 * player left unplaced abandons the whole arrangement and returns the original,
 * which is always a complete lineup.
 */
function arrangeLike(
  chosen: LineupAssignment[],
  startingSlots: LineupSlot[],
  setLineup: (string | null)[],
): LineupAssignment[] {
  const remaining = chosen
    .map((assignment) => assignment.entry)
    .filter((entry): entry is ValuedPlayer => entry !== null)
    .sort(byWinNow);

  const take = (entry: ValuedPlayer): ValuedPlayer => {
    remaining.splice(remaining.indexOf(entry), 1);
    return entry;
  };

  const order = byRestrictiveness(startingSlots);
  const filled = new Map<number, ValuedPlayer | null>();

  for (const [step, { slot, index }] of order.entries()) {
    const eligible = slotEligibility(slot);
    const pinnedId = setLineup[index];
    const pinned = pinnedId
      ? remaining.find((entry) => entry.player.id === pinnedId)
      : undefined;

    if (pinned && eligible.includes(pinned.player.position)) {
      filled.set(index, take(pinned));
      continue;
    }

    /**
     * This slot needs somebody new, so take one who is not spoken for.
     *
     * Without this the narrow slots strip-mine the wide ones. Bench a receiver
     * from the WR slot and the greedy refill takes the best man left — who is
     * the receiver the manager already has in his FLEX — which pushes a third
     * receiver into the FLEX and turns one bench into two corrections. Skipping
     * candidates still pinned to a slot ahead leaves each of them where he was,
     * and the report says the one thing that actually happened.
     */
    const laterPins = new Set(
      order
        .slice(step + 1)
        .map(({ index: later }) => setLineup[later])
        .filter((id): id is string => Boolean(id)),
    );
    const candidates = remaining.filter((entry) =>
      eligible.includes(entry.player.position),
    );
    const next = candidates.find((entry) => !laterPins.has(entry.player.id)) ?? candidates[0];
    filled.set(index, next ? take(next) : null);
  }

  // Somebody could not be placed around the pins. The original arrangement is
  // the same lineup and always complete, so fall back to it whole.
  if (remaining.length > 0) return chosen;

  return startingSlots.map((slot, index) => ({ slot, entry: filled.get(index) ?? null }));
}

export function startSit({
  entries,
  startingSlots,
  setLineup,
}: StartSitInput): StartSitPlan {
  const rostered = new Map(entries.map((entry) => [entry.player.id, entry]));

  // The one substantive difference from `summarizeRoster`: this pool is what
  // can play *this week*, not this season.
  const playable = entries.filter((entry) => canPlayThisWeek(entry.player));
  const lineup = arrangeLike(
    bestLineup(playable, startingSlots),
    startingSlots,
    setLineup,
  );

  const recommendedIds = new Set(
    lineup
      .map((assignment) => assignment.entry?.player.id)
      .filter((id): id is string => id !== undefined),
  );
  const setIds = new Set(setLineup.filter((id): id is string => id !== null));

  const recommendedValue = lineup.reduce(
    (sum, assignment) => sum + (assignment.entry?.winNowValue ?? 0),
    0,
  );

  /**
   * What the set lineup is worth *this week*.
   *
   * A starter who cannot play is counted as nothing rather than skipped. That
   * is the honest reading — an empty slot and a slot holding a man on injured
   * reserve both score zero on Sunday — and it is what makes the headline gain
   * reflect the real cost of leaving the lineup alone.
   */
  const setValue = setLineup.reduce((sum, id) => {
    const entry = id ? rostered.get(id) : undefined;
    if (!entry || !canPlayThisWeek(entry.player)) return sum;
    return sum + entry.winNowValue;
  }, 0);

  const unset = setLineup.length !== startingSlots.length || setIds.size === 0;

  const changes: LineupChange[] = [];
  if (!unset) {
    for (const [index, slot] of startingSlots.entries()) {
      const setId = setLineup[index] ?? null;
      const start = lineup[index]?.entry ?? null;
      if (setId === (start?.player.id ?? null)) continue;

      const sit = setId ? (rostered.get(setId) ?? null) : null;
      const sitStays = setId !== null && recommendedIds.has(setId);
      const startIsNew = start !== null && !setIds.has(start.player.id);
      const status = sit?.player.injury?.status;

      // Only players joining or leaving the lineup as a *set* move the number.
      // A man shuffled from one slot to another is worth exactly what he was.
      const leaving = sit !== null && !sitStays && canPlayThisWeek(sit.player);
      const gain =
        (startIsNew ? (start?.winNowValue ?? 0) : 0) - (leaving ? sit.winNowValue : 0);

      changes.push({
        slot,
        index,
        start,
        sit,
        sitStays,
        startIsNew,
        cause: cause({ setId, sit, sitStays, startIsNew }),
        ...(status ? { status } : {}),
        gain,
      });
    }
  }

  changes.sort((a, b) => b.gain - a.gain || a.index - b.index);

  const watch = lineup
    .map((assignment) => assignment.entry)
    .filter(
      (entry): entry is ValuedPlayer =>
        entry !== null && availability(entry.player) === 'week_to_week',
    );

  return {
    lineup,
    changes,
    gain: recommendedValue - setValue,
    setValue,
    recommendedValue,
    unset,
    watch,
  };
}

function cause({
  setId,
  sit,
  sitStays,
  startIsNew,
}: {
  setId: string | null;
  sit: ValuedPlayer | null;
  sitStays: boolean;
  startIsNew: boolean;
}): ChangeCause {
  if (setId === null) return 'empty';
  if (!sit) return 'dropped';
  // Nobody leaves and nobody joins: the same players, differently arranged.
  // Worth nothing, and worth saying so rather than dressing it as an upgrade.
  if (sitStays && !startIsNew) return 'move';
  if (sitStays) return 'upgrade';
  return canPlayThisWeek(sit.player) ? 'upgrade' : 'sidelined';
}
