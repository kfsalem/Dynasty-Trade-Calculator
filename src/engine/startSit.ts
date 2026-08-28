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
import { onBye } from './byes';

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
 * weekly projections: no opponent and no game script. So it answers "who are my
 * best eligible players" and not "who scores most this Sunday", and the UI says
 * so rather than letting a confident-looking list imply otherwise.
 *
 * Byes are the one exception, and they are not a projection. A team that is off
 * scores nothing with certainty, which puts a bye in the same class as an empty
 * slot rather than in the class of matchup nuance this file declines to model.
 * They arrive as `byeTeams` because whether the question is even askable —
 * which season, which week, is the file current — belongs to the caller; see
 * `engine/byes`.
 */

/**
 * Why a slot changes. One cause per slot, the most decisive one.
 *
 * Ordered by how much the manager needs to hear it: an empty slot is a
 * guaranteed zero, a dropped player is a lineup that no longer exists, a bye is
 * the other guaranteed zero, an injury is a fact he may not have seen, and only
 * then does the app get to offer an opinion about who is better.
 *
 * `bye` outranks `sidelined` because it is the more certain of the two — a
 * questionable starter usually plays and a team on bye never does — and because
 * it is the one a manager is least likely to have noticed himself.
 */
export type ChangeCause = 'empty' | 'dropped' | 'bye' | 'sidelined' | 'upgrade' | 'move';

/**
 * How much better the recommended man has to be before the app calls it a
 * correction rather than a coin flip.
 *
 * Measured against the real ten-team league on 2026-08-27, over the ten change
 * rows the panel actually produced: two of the eight `upgrade` rows were 1.6%
 * and 4.0%, and the next was 32.7%. Nothing at all fell between 4% and 33%, so
 * anywhere in that gap separates the same rows; 10% is the round number in the
 * middle of it rather than a value fitted to eight observations.
 *
 * The reason the gap is so wide is worth keeping. A manager's lineup and the
 * app's disagree precisely where the call is close, so change rows are
 * *selected* for closeness — measured across every starting slot in the league
 * instead, only 3% of starters sit within 10% of the best man on their bench,
 * against 25% of the rows this panel prints. Calibrating on all slots would
 * have set the bar in the wrong place.
 *
 * Below this the app is claiming a precision it does not have: these are
 * season-long win-now values with no matchup in them, and a 4% edge is inside
 * the noise of a single Sunday.
 */
export const CLEAR_MARGIN = 0.1;

/**
 * How much better one man is than another, as a share of the larger.
 *
 * Relative rather than absolute because the same gap means different things in
 * different slots: 40 points between two quarterbacks priced near 900 is a
 * rounding error, and 40 points between two tight ends priced near 130 is a
 * third of the position. An absolute threshold would fold away real upgrades at
 * the shallow end of the roster and print noise at the deep end.
 */
export function relativeMargin(better: number, worse: number): number {
  const larger = Math.max(better, worse);
  if (larger <= 0) return 0;
  return (better - worse) / larger;
}

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
   * How much better the recommended man is, as a share of the larger value.
   *
   * Zero where the comparison is meaningless — an empty slot has nobody to be
   * better than. Read alongside `decisive`, never instead of it.
   */
  margin: number;
  /**
   * Which chain of dependent rows this belongs to.
   *
   * Rows are not independent, and treating them as though they were is a way to
   * give broken advice. On the real league one roster had a receiver moving from
   * FLEX to WR with a bench player filling the FLEX behind him: two rows, and
   * following only the first empties a slot the second was going to fill. Rows
   * that shuffle a man between slots are one decision wearing several hats, so
   * they are shown and hidden together.
   */
  chain: number;
  /**
   * Whether this is a correction the app is willing to stand behind.
   *
   * Decided for the whole chain, never for the row — see `chain`. Within that:
   * `empty`, `dropped`, `bye` and `sidelined` are *facts* about the roster and
   * always qualify, however small the value involved, because a slot scoring
   * zero is worth saying whoever is in it. An `upgrade` is an *opinion*, and its
   * chain has to clear `CLEAR_MARGIN` to be stated as one. A chain that moves
   * nobody in or out of the lineup never qualifies: it is the same eleven men
   * differently arranged, and the engine's own accounting puts it at zero.
   */
  decisive: boolean;
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
  /**
   * Slots where the two disagree, most valuable first.
   *
   * Every disagreement, including the ones not worth acting on. Nothing is
   * dropped here — `decisive` says which are worth presenting as corrections,
   * and a caller that wants the whole picture can still have it.
   */
  changes: LineupChange[];
  /** Changes the app will stand behind. What the headline counts. */
  decisive: LineupChange[];
  /** The rest: coin flips and pure rearrangement. Real, and not worth a row. */
  marginal: LineupChange[];
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
  /**
   * Sleeper team codes with no game this week.
   *
   * Null means "no claim" and an empty set means "nobody is off" — a real
   * answer for the third of the season that has no byes in it. Both behave
   * identically here; the difference matters to the UI, which has to decide
   * whether to promise the reader that byes were checked. See `engine/byes`.
   */
  byeTeams?: ReadonlySet<string> | null;
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
  byeTeams,
}: StartSitInput): StartSitPlan {
  const off = byeTeams ?? new Set<string>();
  const rostered = new Map(entries.map((entry) => [entry.player.id, entry]));

  /**
   * Can this man score points on Sunday?
   *
   * The one substantive difference from `summarizeRoster`: this pool is what
   * can play *this week*, not this season. A bye removes a player from it
   * rather than flagging him inside it, which is the whole point — annotating a
   * bye would leave him in the recommended lineup, and a panel that recommends
   * a player it has labelled as not playing is worse than one that never
   * mentioned byes at all.
   */
  const playing = (entry: ValuedPlayer): boolean =>
    canPlayThisWeek(entry.player) && !onBye(entry.player.team, off);

  const playable = entries.filter(playing);
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
   * is the honest reading — an empty slot, a slot holding a man on injured
   * reserve, and a slot holding a man whose team is off all score zero on
   * Sunday — and it is what makes the headline gain reflect the real cost of
   * leaving the lineup alone.
   */
  const setValue = setLineup.reduce((sum, id) => {
    const entry = id ? rostered.get(id) : undefined;
    if (!entry || !playing(entry)) return sum;
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
      // A man who is out or on bye is worth nothing this week, so benching him
      // costs nothing and the row shows the full value of whoever replaces him.
      const leaving = sit !== null && !sitStays && playing(sit);
      const gain =
        (startIsNew ? (start?.winNowValue ?? 0) : 0) - (leaving ? sit.winNowValue : 0);

      const why = cause({ setId, sit, sitStays, startIsNew, off });

      /*
        Measured between the two men in this slot, not from `gain`.

        `gain` is an accounting figure: it counts only players entering or
        leaving the lineup as a set, so that the rows sum to `plan.gain`
        exactly. That makes it the wrong number for confidence — a row where the
        displaced starter merely slides to another slot carries the newcomer's
        entire value, and would read as overwhelming when the actual question,
        "is this man better than the one in the slot", may be a coin flip.
      */
      const margin =
        start && sit ? relativeMargin(start.winNowValue, sit.winNowValue) : 0;

      changes.push({
        slot,
        index,
        start,
        sit,
        sitStays,
        startIsNew,
        cause: why,
        ...(status ? { status } : {}),
        margin,
        // Both filled in once every row exists — a chain cannot be identified
        // from inside one of its members.
        chain: -1,
        decisive: false,
        gain,
      });
    }
  }

  linkChains(changes, playing);
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
    decisive: changes.filter((change) => change.decisive),
    marginal: changes.filter((change) => !change.decisive),
    gain: recommendedValue - setValue,
    setValue,
    recommendedValue,
    unset,
    watch,
  };
}

/**
 * Group rows into independent decisions, and decide each group on its merits.
 *
 * A row is not an action. Moving a receiver from FLEX to WR and filling the
 * FLEX from the bench is *one* decision printed as two rows, and the two are
 * linked by the man who appears as `sit` in the first and `start` in the second.
 * Presenting them separately invites a manager to do half of it and leave a slot
 * empty, and hiding one as marginal does the same thing without asking.
 *
 * So rows are joined wherever they share a player who is merely moving, and the
 * whole group stands or falls together. What the group is *worth* is then the
 * only honest question: the men who actually join the lineup against the men who
 * actually leave it. In the example above that is "bench Watson, start
 * Henderson" — and the receiver shuffling slots, whose value appears on both
 * sides, correctly cancels.
 */
function linkChains(
  changes: LineupChange[],
  playing: (entry: ValuedPlayer) => boolean,
): void {
  /** Row indices keyed by a player who is only changing slots. */
  const movers = new Map<string, number[]>();
  const note = (id: string, row: number) => {
    const rows = movers.get(id) ?? [];
    rows.push(row);
    movers.set(id, rows);
  };

  for (const [row, change] of changes.entries()) {
    if (change.sitStays && change.sit) note(change.sit.player.id, row);
    if (!change.startIsNew && change.start) note(change.start.player.id, row);
  }

  const chainOf = changes.map(() => -1);
  let next = 0;

  for (const [row] of changes.entries()) {
    if (chainOf[row] !== -1) continue;
    const id = next++;

    // Breadth-first across shared movers. Chains are two or three rows in
    // practice, so nothing cleverer than a queue is warranted.
    const queue = [row];
    chainOf[row] = id;
    while (queue.length > 0) {
      const current = queue.pop() as number;
      const change = changes[current];
      const ids = [
        ...(change.sitStays && change.sit ? [change.sit.player.id] : []),
        ...(!change.startIsNew && change.start ? [change.start.player.id] : []),
      ];
      for (const playerId of ids) {
        for (const neighbour of movers.get(playerId) ?? []) {
          if (chainOf[neighbour] !== -1) continue;
          chainOf[neighbour] = id;
          queue.push(neighbour);
        }
      }
    }
  }

  const FACTS: ChangeCause[] = ['empty', 'dropped', 'bye', 'sidelined'];

  for (let id = 0; id < next; id++) {
    const rows = changes.filter((_, row) => chainOf[row] === id);

    // Only players crossing the lineup's edge count. Anyone shuffling between
    // slots appears on both sides and cancels, which is the whole point.
    const joining = rows
      .filter((change) => change.startIsNew && change.start)
      .reduce((sum, change) => sum + (change.start?.winNowValue ?? 0), 0);
    const leaving = rows
      .filter((change) => !change.sitStays && change.sit && playing(change.sit))
      .reduce((sum, change) => sum + (change.sit?.winNowValue ?? 0), 0);

    const inert = rows.every((change) => !change.startIsNew && change.sitStays);
    const fact = rows.some((change) => FACTS.includes(change.cause));
    const decisive = fact || (!inert && relativeMargin(joining, leaving) >= CLEAR_MARGIN);

    for (const change of rows) {
      change.chain = id;
      change.decisive = decisive;
    }
  }
}

function cause({
  setId,
  sit,
  sitStays,
  startIsNew,
  off,
}: {
  setId: string | null;
  sit: ValuedPlayer | null;
  sitStays: boolean;
  startIsNew: boolean;
  off: ReadonlySet<string>;
}): ChangeCause {
  if (setId === null) return 'empty';
  if (!sit) return 'dropped';
  // Nobody leaves and nobody joins: the same players, differently arranged.
  // Worth nothing, and worth saying so rather than dressing it as an upgrade.
  if (sitStays && !startIsNew) return 'move';
  if (sitStays) return 'upgrade';
  // Before the injury check, because a player can be both — a questionable
  // receiver whose team is off is not questionable, he is unavailable, and
  // "check again before kickoff" is the wrong thing to tell his manager.
  if (onBye(sit.player.team, off)) return 'bye';
  return canPlayThisWeek(sit.player) ? 'upgrade' : 'sidelined';
}
