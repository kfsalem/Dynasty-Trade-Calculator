import type {
  DraftPick,
  FairnessRating,
  League,
  Player,
  PlayerValue,
  TradeAnalysis,
  TradeSideResult,
} from '../types';
import { AGE_CLIFF } from './analysis';
import { availability, INJURY_LABEL } from './availability';
import { bestLineup, valuePlayers } from './rosterValue';

export interface TradeSideInput {
  rosterId: number;
  /** Players this side sends away. */
  playerIds: string[];
  /** Picks this side sends away. */
  pickIds: string[];
}

export interface TradeContext {
  league: League;
  players: Map<string, Player>;
  values: Map<string, PlayerValue>;
  picks: DraftPick[];
}

/** Best-lineup strength for a hypothetical roster, in win-now units. */
function starterValue(
  playerIds: string[],
  ctx: TradeContext,
): { total: number; emptySlots: number } {
  const entries = valuePlayers(playerIds, ctx.players, ctx.values);
  const lineup = bestLineup(entries, ctx.league.settings.startingSlots);
  return {
    total: lineup.reduce((sum, slot) => sum + (slot.entry?.winNowValue ?? 0), 0),
    emptySlots: lineup.filter((slot) => slot.entry === null).length,
  };
}

function rateFairness(pct: number): FairnessRating {
  if (pct < 0.03) return 'very_fair';
  if (pct < 0.08) return 'fair';
  if (pct < 0.15) return 'slightly_unfair';
  if (pct < 0.25) return 'unfair';
  return 'very_unfair';
}

export const FAIRNESS_LABEL: Record<FairnessRating, string> = {
  very_fair: 'Very fair',
  fair: 'Fair',
  slightly_unfair: 'Slightly uneven',
  unfair: 'Uneven',
  very_unfair: 'Very lopsided',
};

function buildSide(
  input: TradeSideInput,
  received: TradeSideInput,
  ctx: TradeContext,
): TradeSideResult {
  const roster = ctx.league.rosters.find((r) => r.rosterId === input.rosterId);
  if (!roster) throw new Error(`Unknown roster ${input.rosterId}`);

  const pickById = new Map(ctx.picks.map((p) => [p.id, p]));
  const resolve = (ids: string[]) =>
    ids.map((id) => ctx.players.get(id)).filter((p): p is Player => Boolean(p));
  const resolvePicks = (ids: string[]) =>
    ids.map((id) => pickById.get(id)).filter((p): p is DraftPick => Boolean(p));

  const outgoingPlayers = resolve(input.playerIds);
  const incomingPlayers = resolve(received.playerIds);
  const outgoingPicks = resolvePicks(input.pickIds);
  const incomingPicks = resolvePicks(received.pickIds);

  // Fairness is argued in dynasty market terms, because that is the number the
  // other manager will look up before accepting. Whether the trade actually
  // helps is decided by the lineup maths below, which runs on win-now values.
  // Three scales in one function, and they never touch.
  const playerValue = (p: Player) => ctx.values.get(p.id)?.marketValue ?? 0;
  const sum = (n: number[]) => n.reduce((a, b) => a + b, 0);

  const outgoingValue =
    sum(outgoingPlayers.map(playerValue)) + sum(outgoingPicks.map((p) => p.marketValue));
  const incomingValue =
    sum(incomingPlayers.map(playerValue)) + sum(incomingPicks.map((p) => p.marketValue));

  // Picks never appear in a starting lineup, so VORS moves only on players.
  // That asymmetry is the point: it is what shows a contender that trading
  // picks for a starter helps them even when raw value says they lost.
  const outgoingIds = new Set(input.playerIds);
  const after = [
    ...roster.playerIds.filter((id) => !outgoingIds.has(id)),
    ...received.playerIds,
  ];

  const before = starterValue(roster.playerIds, ctx);
  const afterLineup = starterValue(after, ctx);

  const warnings: string[] = [];

  if (afterLineup.emptySlots > before.emptySlots) {
    const added = afterLineup.emptySlots - before.emptySlots;
    warnings.push(
      `Leaves ${added} starting ${added === 1 ? 'slot' : 'slots'} unfilled.`,
    );
  }

  // Injuries are stated on the incoming side and nowhere else, deliberately.
  // The lineup maths above has already priced them — an injured man arrives
  // contributing nothing, so `vorsDelta` shows the shortfall — but it shows it
  // as a number that could equally mean the player is bad. The reason matters,
  // because these are the two facts a manager most wants before accepting: what
  // he is getting is hurt, and how badly.
  const describe = (p: Player) =>
    `${p.name} (${p.position}, ${INJURY_LABEL[p.injury?.status ?? 'healthy'].toLowerCase()})`;

  const sidelined = incomingPlayers.filter((p) => availability(p) === 'out_for_season');
  if (sidelined.length > 0) {
    warnings.push(
      `${sidelined.length === 1 ? 'Taking on a player who' : `Taking on ${sidelined.length} players who`} cannot fill a starting slot this season: ${sidelined
        .map(describe)
        .join(', ')}. Counted at full value as an asset, and at nothing in the lineup.`,
    );
  }

  const dayToDay = incomingPlayers.filter((p) => availability(p) === 'week_to_week');
  if (dayToDay.length > 0) {
    warnings.push(
      `Week to week: ${dayToDay.map(describe).join(', ')}. Nothing here is discounted for it.`,
    );
  }

  const aging = incomingPlayers.filter(
    (p) => p.age !== null && p.age >= (AGE_CLIFF[p.position] ?? 99),
  );
  if (aging.length > 0) {
    warnings.push(
      `Taking on ${aging.length} player${aging.length === 1 ? '' : 's'} past the age cliff: ${aging
        .map((p) => `${p.name} (${p.position}, ${p.age})`)
        .join(', ')}.`,
    );
  }

  const ownedPickValue = sum(
    ctx.picks.filter((p) => p.ownerRosterId === input.rosterId).map((p) => p.value),
  );
  if (ownedPickValue > 0 && outgoingPicks.length > 0) {
    const share = sum(outgoingPicks.map((p) => p.value)) / ownedPickValue;
    if (share >= 0.5) {
      warnings.push(`Ships ${Math.round(share * 100)}% of this team's pick capital.`);
    }
  }

  // roster_positions covers starters and bench only — taxi and IR are separate
  // allowances on top. Counting just roster_positions makes every roster in a
  // taxi-squad league look permanently over the limit.
  const { allSlots, taxiSlots, reserveSlots } = ctx.league.settings;
  const rosterCap = allSlots.length + taxiSlots + reserveSlots;
  // Only a trade that actually adds bodies can push a roster over.
  if (after.length > rosterCap && after.length > roster.playerIds.length) {
    warnings.push(
      `Roster would hold ${after.length} players, over the ${rosterCap}-spot limit.`,
    );
  }

  if (incomingValue > 0 && afterLineup.total < before.total) {
    warnings.push('Starting lineup gets weaker despite the incoming value.');
  }

  return {
    rosterId: input.rosterId,
    teamName: roster.teamName,
    outgoingPlayers,
    outgoingPicks,
    incomingPlayers,
    incomingPicks,
    outgoingValue,
    incomingValue,
    netValue: incomingValue - outgoingValue,
    starterValueBefore: before.total,
    starterValueAfter: afterLineup.total,
    vorsDelta: afterLineup.total - before.total,
    warnings,
  };
}

export function evaluateTrade(
  a: TradeSideInput,
  b: TradeSideInput,
  ctx: TradeContext,
): TradeAnalysis {
  const sideA = buildSide(a, b, ctx);
  const sideB = buildSide(b, a, ctx);

  const valueDifference = Math.abs(sideA.outgoingValue - sideB.outgoingValue);
  const larger = Math.max(sideA.outgoingValue, sideB.outgoingValue);
  const valueDifferencePct = larger > 0 ? valueDifference / larger : 0;

  const favors =
    valueDifferencePct < 0.03
      ? null
      : sideA.netValue > sideB.netValue
        ? sideA.rosterId
        : sideB.rosterId;

  const fairnessRating = rateFairness(valueDifferencePct);

  // Both sides gaining lineup strength is the signal that a trade will actually
  // be accepted, and it is possible: two teams with complementary surpluses can
  // each improve their starters while raw value stays even.
  const bothImprove = sideA.vorsDelta > 0 && sideB.vorsDelta > 0;

  let summary: string;
  if (bothImprove) {
    summary =
      'Both teams improve their starting lineup. This is the kind of trade that actually gets accepted.';
  } else if (favors === null) {
    summary = 'Even on raw value.';
  } else {
    const winner = favors === sideA.rosterId ? sideA : sideB;
    const loser = favors === sideA.rosterId ? sideB : sideA;
    summary = `Raw value favors ${winner.teamName} by ${Math.round(valueDifferencePct * 100)}%.`;
    if (loser.vorsDelta > 0) {
      summary += ` But ${loser.teamName} still upgrades their starting lineup, which may be worth the overpay.`;
    }
  }

  return {
    sides: [sideA, sideB],
    valueDifference,
    valueDifferencePct,
    fairnessRating,
    favors,
    summary,
  };
}
