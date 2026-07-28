import type { DraftPick, Player, TradeAnalysis, TradeSideResult } from '../types';
import {
  AGE_CLIFF,
  HORIZON_YEARS,
  analyzeTeam,
  retention,
  type Quadrant,
  type TeamAnalysis,
} from './analysis';
import { picksForRoster } from './picks';
import { bestLineup, valuePlayers, type RosterSummary } from './rosterValue';
import { evaluateTrade, type TradeContext } from './trade';

/**
 * Trade suggestions: search the league for offers that help both sides.
 *
 * The hard part is not finding trades that help *you* — that is one line of
 * arithmetic. It is finding ones the other manager would actually accept. An
 * offer nobody takes is worth nothing, so every candidate here must clear a
 * two-sided bar, and every suggestion ships with the reason the other side says
 * yes, stated in their terms.
 */

export type TradeAsset =
  | { kind: 'player'; id: string; label: string; value: number; player: Player }
  | { kind: 'pick'; id: string; label: string; value: number; pick: DraftPick };

export interface SideBenefit {
  /** Change in the best lineup this team could field today. */
  now: number;
  /** Change in the age-decayed lineup three years out, plus pick value moved. */
  future: number;
  /** `now` and `future` weighted by this team's contention window. */
  total: number;
  quadrant: Quadrant;
}

export interface SuggestedTrade {
  /** Stable key from the asset ids on both sides — also used to dedupe. */
  id: string;
  partnerRosterId: number;
  partnerName: string;
  /** Assets leaving your roster. */
  give: TradeAsset[];
  /** Assets coming back. */
  get: TradeAsset[];
  analysis: TradeAnalysis;
  myBenefit: SideBenefit;
  theirBenefit: SideBenefit;
  score: number;
  /** Why this is worth doing for you. */
  rationale: string[];
  /** Why the other manager accepts. The half no major calculator shows. */
  whyTheySayYes: string[];
}

export interface SuggestionResult {
  trades: SuggestedTrade[];
  /** How many packages were built and evaluated, for an honest "searched N". */
  considered: number;
  /** Set when nothing cleared the bar, explaining what blocked it. */
  note: string | null;
}

export interface SuggestContext extends TradeContext {
  summaries: RosterSummary[];
}

export interface SuggestOptions {
  maxResults?: number;
  /** Cap per partner so the list spans the league instead of one team's variations. */
  perPartner?: number;
  /** Largest raw-value gap, as a share of the bigger side, that still reads as fair. */
  tolerance?: number;
  /** Movable assets considered per team. Bounds the search at teams × k². */
  candidatesPerTeam?: number;
}

/**
 * How much each contention window cares about now versus later.
 *
 * This is what makes two-sided trades possible at all. Requiring both teams to
 * gain *starting-lineup strength* would rule out the single most common dynasty
 * trade — a rebuilder sending a veteran to a contender for picks — because
 * picks never start. A rebuilder is not trying to win now, so measuring their
 * gain in win-now units answers a question they did not ask.
 */
export const WINDOW_WEIGHTS: Record<Quadrant, { now: number; future: number }> = {
  juggernaut: { now: 0.65, future: 0.35 },
  win_now: { now: 0.9, future: 0.1 },
  rebuilding: { now: 0.25, future: 0.75 },
  danger: { now: 0.1, future: 0.9 },
};

const CONTENDING: Quadrant[] = ['juggernaut', 'win_now'];

/**
 * The quadrant as it reads mid-sentence. `ContentionProfile.label` is a heading
 * ("Danger zone"), which turns into "Team 6 is danger zone" if reused here.
 */
const WINDOW_PHRASE: Record<Quadrant, string> = {
  juggernaut: 'a juggernaut',
  win_now: 'in a closing window',
  rebuilding: 'rebuilding on schedule',
  danger: 'in the danger zone',
};

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

const playerAsset = (player: Player, value: number): TradeAsset => ({
  kind: 'player',
  id: player.id,
  label: player.name,
  value,
  player,
});

const pickAsset = (pick: DraftPick): TradeAsset => ({
  kind: 'pick',
  id: pick.id,
  label: pick.label,
  value: pick.value,
  pick,
});

/**
 * The lineup a roster could field in three years, after age decay.
 *
 * Same model as `analysis.futureScore`, but taking a raw id list so it can be
 * run against a hypothetical post-trade roster.
 */
function futureLineupValue(playerIds: string[], ctx: SuggestContext): number {
  const entries = valuePlayers(playerIds, ctx.players, ctx.values).map((entry) => ({
    ...entry,
    value: entry.value * retention(entry.player.position, entry.player.age, HORIZON_YEARS),
  }));
  return bestLineup(entries, ctx.league.settings.startingSlots).reduce(
    (total, slot) => total + (slot.entry?.value ?? 0),
    0,
  );
}

/** Ids a roster would start today, given the players it would hold after a trade. */
function lineupIds(playerIds: string[], ctx: SuggestContext): Set<string> {
  const entries = valuePlayers(playerIds, ctx.players, ctx.values);
  return new Set(
    bestLineup(entries, ctx.league.settings.startingSlots)
      .map((slot) => slot.entry?.player.id)
      .filter((id): id is string => Boolean(id)),
  );
}

/**
 * What a team is plausibly willing to move.
 *
 * Nobody trades their best players for fair value, so the candidate pool is
 * limited to assets a manager has an actual reason to sell:
 *
 * - **Surplus** — bench players who would start elsewhere. Always movable.
 * - **Contenders** additionally spend **picks**, which are the currency of a
 *   team trying to win before its window shuts.
 * - **Rebuilders** additionally sell **aging starters**, whose value is highest
 *   today and falls every year they are held.
 *
 * Drawing from anywhere else produces offers that get declined on sight.
 */
export function movableAssets(
  analysis: TeamAnalysis,
  summary: RosterSummary,
  ctx: SuggestContext,
  limit: number,
): TradeAsset[] {
  const assets = new Map<string, TradeAsset>();

  for (const surplus of analysis.surpluses) {
    assets.set(surplus.player.id, playerAsset(surplus.player, surplus.value));
  }

  if (CONTENDING.includes(analysis.contention.quadrant)) {
    for (const pick of picksForRoster(ctx.picks, summary.rosterId)) {
      if (pick.value > 0) assets.set(pick.id, pickAsset(pick));
    }
  } else {
    for (const slot of summary.lineup) {
      const entry = slot.entry;
      if (!entry || entry.value <= 0) continue;
      const { age, position } = entry.player;
      if (age === null || age < (AGE_CLIFF[position] ?? 99)) continue;
      assets.set(entry.player.id, playerAsset(entry.player, entry.value));
    }
  }

  return [...assets.values()].sort((a, b) => b.value - a.value).slice(0, limit);
}

/**
 * Close a raw-value gap with a draft pick from the lighter side.
 *
 * Only ever adds a pick that moves the package *closer* to even — a sweetener
 * that overshoots is worse than none. Returns null when the gap cannot be
 * brought inside tolerance, which is the honest answer: those two assets do not
 * make a trade.
 */
function balancePackage(
  give: TradeAsset[],
  get: TradeAsset[],
  myRosterId: number,
  partnerRosterId: number,
  ctx: SuggestContext,
  tolerance: number,
): { give: TradeAsset[]; get: TradeAsset[] } | null {
  const gapOf = (a: TradeAsset[], b: TradeAsset[]) => sum(b.map((x) => x.value)) - sum(a.map((x) => x.value));
  const largerOf = (a: TradeAsset[], b: TradeAsset[]) =>
    Math.max(sum(a.map((x) => x.value)), sum(b.map((x) => x.value)));

  const larger = largerOf(give, get);
  if (larger <= 0) return null;

  const gap = gapOf(give, get);
  if (Math.abs(gap) / larger <= tolerance) return { give, get };

  // Positive gap means we are receiving more, so our side is the light one.
  const shortRosterId = gap > 0 ? myRosterId : partnerRosterId;
  const used = new Set([...give, ...get].map((asset) => asset.id));
  const target = Math.abs(gap);

  let best: DraftPick | null = null;
  let bestResidual = target;
  for (const pick of picksForRoster(ctx.picks, shortRosterId)) {
    if (pick.value <= 0 || used.has(pick.id)) continue;
    const residual = Math.abs(target - pick.value);
    if (residual < bestResidual) {
      best = pick;
      bestResidual = residual;
    }
  }
  if (!best) return null;

  const balancedGive = gap > 0 ? [...give, pickAsset(best)] : give;
  const balancedGet = gap > 0 ? get : [...get, pickAsset(best)];

  const finalLarger = largerOf(balancedGive, balancedGet);
  if (finalLarger <= 0) return null;
  if (Math.abs(gapOf(balancedGive, balancedGet)) / finalLarger > tolerance) return null;

  return { give: balancedGive, get: balancedGet };
}

/**
 * Score one side of a trade in the currency that side actually cares about.
 *
 * `future` counts pick value at face, because three years out a rookie pick has
 * become a player — the pick's market value already prices that expectation in.
 */
function sideBenefit(
  side: TradeSideResult,
  quadrant: Quadrant,
  ctx: SuggestContext,
): { benefit: SideBenefit; afterIds: string[]; afterStarters: Set<string> } {
  const roster = ctx.league.rosters.find((r) => r.rosterId === side.rosterId);
  if (!roster) throw new Error(`Unknown roster ${side.rosterId}`);

  const outgoing = new Set(side.outgoingPlayers.map((p) => p.id));
  const afterIds = [
    ...roster.playerIds.filter((id) => !outgoing.has(id)),
    ...side.incomingPlayers.map((p) => p.id),
  ];

  const pickDelta =
    sum(side.incomingPicks.map((p) => p.value)) - sum(side.outgoingPicks.map((p) => p.value));

  const now = side.vorsDelta;
  const future =
    futureLineupValue(afterIds, ctx) - futureLineupValue(roster.playerIds, ctx) + pickDelta;

  const weights = WINDOW_WEIGHTS[quadrant];

  return {
    benefit: { now, future, total: weights.now * now + weights.future * future, quadrant },
    afterIds,
    afterStarters: lineupIds(afterIds, ctx),
  };
}

const round = (n: number): string => Math.round(n).toLocaleString('en-US');

/** Bullets explaining a trade from one team's point of view. */
function explain(
  side: TradeSideResult,
  benefit: SideBenefit,
  afterStarters: Set<string>,
  analysis: TeamAnalysis,
  summary: RosterSummary,
  perspective: 'mine' | 'theirs',
): string[] {
  const they = perspective === 'mine' ? 'You' : side.teamName;
  const their = perspective === 'mine' ? 'your' : 'their';
  const is = perspective === 'mine' ? 'are' : 'is';
  const lines: string[] = [];

  const incomingPickValue = sum(side.incomingPicks.map((p) => p.value));
  const contending = CONTENDING.includes(benefit.quadrant);
  const window = WINDOW_PHRASE[benefit.quadrant];

  const meanAge = (players: Player[]): number | null => {
    const ages = players.map((p) => p.age).filter((a): a is number => a !== null);
    return ages.length > 0 ? sum(ages) / ages.length : null;
  };
  const incomingAge = meanAge(side.incomingPlayers);
  const outgoingAge = meanAge(side.outgoingPlayers);

  if (incomingPickValue > 0 && !contending) {
    lines.push(
      `${they} ${is} ${window} at #${analysis.contention.nowRank} of ${analysis.contention.teamCount} — picks are exactly what ${their} team should be collecting instead of wins it can't use.`,
    );
  } else if (contending && side.incomingPlayers.length > 0) {
    lines.push(
      `${they} ${is} ${window} — this buys starting-lineup strength while ${their} window is open.`,
    );
  } else if (
    !contending &&
    incomingAge !== null &&
    outgoingAge !== null &&
    incomingAge < outgoingAge - 0.5
  ) {
    // A rebuilder can also be paid in youth rather than picks, and that case
    // deserves the same framing — otherwise the offer arrives unexplained.
    lines.push(
      `${they} ${is} ${window}, and this gets ${their} core ${(outgoingAge - incomingAge).toFixed(0)} ${outgoingAge - incomingAge < 1.5 ? 'year' : 'years'} younger at the same value.`,
    );
  }

  for (const player of side.incomingPlayers) {
    const position = analysis.positions.find((p) => p.position === player.position);
    if (position?.verdict === 'weakness') {
      lines.push(
        `${player.name} lands on ${their} weakest position: ${their} ${player.position} starters are worth ${round(position.starterValue)} against a league median of ${round(position.leagueMedian)}.`,
      );
    } else if (afterStarters.has(player.id)) {
      lines.push(`${player.name} walks straight into ${their} starting lineup.`);
    }
  }

  for (const player of side.outgoingPlayers) {
    const surplus = analysis.surpluses.find((s) => s.player.id === player.id);
    if (surplus) {
      lines.push(
        `${player.name} doesn't crack ${their} best lineup today — ${their} depth at ${player.position} is going to waste on the bench.`,
      );
    } else if (
      player.age !== null &&
      player.age >= (AGE_CLIFF[player.position] ?? 99) &&
      !contending
    ) {
      lines.push(
        `${player.name} is ${player.age.toFixed(0)} and past the ${player.position} age cliff. On a team that isn't winning this year, his value only falls from here.`,
      );
    }
  }

  const parts: string[] = [];
  if (benefit.now > 0) parts.push(`+${round(benefit.now)} to ${their} starting lineup`);
  if (benefit.future > 0) parts.push(`+${round(benefit.future)} to ${their} three-year outlook`);
  if (parts.length > 0) {
    const share = summary.starterValue > 0 ? benefit.now / summary.starterValue : 0;
    const pct = benefit.now > 0 && share >= 0.01 ? ` (${(share * 100).toFixed(1)}% stronger)` : '';
    lines.push(`Net: ${parts.join(', ')}${pct}.`);
  }

  return lines;
}

function buildSuggestion(
  give: TradeAsset[],
  get: TradeAsset[],
  myRosterId: number,
  partner: { summary: RosterSummary; analysis: TeamAnalysis },
  mine: { summary: RosterSummary; analysis: TeamAnalysis },
  ctx: SuggestContext,
  tolerance: number,
): SuggestedTrade | null {
  const balanced = balancePackage(
    give,
    get,
    myRosterId,
    partner.summary.rosterId,
    ctx,
    tolerance,
  );
  if (!balanced) return null;

  const split = (assets: TradeAsset[]) => ({
    playerIds: assets.filter((a) => a.kind === 'player').map((a) => a.id),
    pickIds: assets.filter((a) => a.kind === 'pick').map((a) => a.id),
  });

  const analysis = evaluateTrade(
    { rosterId: myRosterId, ...split(balanced.give) },
    { rosterId: partner.summary.rosterId, ...split(balanced.get) },
    ctx,
  );

  const [mySide, theirSide] = analysis.sides;
  const my = sideBenefit(mySide, mine.analysis.contention.quadrant, ctx);
  const their = sideBenefit(theirSide, partner.analysis.contention.quadrant, ctx);

  // The guard against the obvious failure mode. An engine that optimizes only
  // your side generates offers nobody accepts, which is the same as generating
  // nothing at all.
  if (my.benefit.total <= 0 || their.benefit.total <= 0) return null;

  // Even trades rank above lopsided ones, and the geometric mean rewards
  // packages that are good for both rather than great for one.
  const balanceFactor = Math.max(0, 1 - analysis.valueDifferencePct);
  const score = Math.sqrt(my.benefit.total * their.benefit.total) * balanceFactor;

  return {
    id: [...balanced.give, ...balanced.get].map((a) => a.id).sort().join('|'),
    partnerRosterId: partner.summary.rosterId,
    partnerName: theirSide.teamName,
    give: balanced.give,
    get: balanced.get,
    analysis,
    myBenefit: my.benefit,
    theirBenefit: their.benefit,
    score,
    rationale: explain(
      mySide,
      my.benefit,
      my.afterStarters,
      mine.analysis,
      mine.summary,
      'mine',
    ),
    whyTheySayYes: explain(
      theirSide,
      their.benefit,
      their.afterStarters,
      partner.analysis,
      partner.summary,
      'theirs',
    ),
  };
}

export function suggestTrades(
  myRosterId: number,
  ctx: SuggestContext,
  options: SuggestOptions = {},
): SuggestionResult {
  const {
    maxResults = 6,
    perPartner = 2,
    tolerance = 0.1,
    candidatesPerTeam = 5,
  } = options;

  const analyses = new Map<number, TeamAnalysis>();
  for (const summary of ctx.summaries) {
    const analysis = analyzeTeam(summary.rosterId, ctx.summaries, ctx.league.settings);
    if (analysis) analyses.set(summary.rosterId, analysis);
  }

  const mySummary = ctx.summaries.find((s) => s.rosterId === myRosterId);
  const myAnalysis = analyses.get(myRosterId);
  if (!mySummary || !myAnalysis) {
    return { trades: [], considered: 0, note: 'That team is no longer in this league.' };
  }

  const mine = { summary: mySummary, analysis: myAnalysis };
  const myAssets = movableAssets(myAnalysis, mySummary, ctx, candidatesPerTeam);

  if (myAssets.length === 0) {
    return {
      trades: [],
      considered: 0,
      note: 'Nothing on your roster is spare. Every player good enough to start somewhere is already in your lineup, and you hold no picks to spend.',
    };
  }

  const trades: SuggestedTrade[] = [];
  let considered = 0;

  for (const summary of ctx.summaries) {
    if (summary.rosterId === myRosterId) continue;
    const analysis = analyses.get(summary.rosterId);
    if (!analysis) continue;

    const partner = { summary, analysis };
    const theirAssets = movableAssets(analysis, summary, ctx, candidatesPerTeam);

    const forPartner: SuggestedTrade[] = [];
    for (const give of myAssets) {
      for (const get of theirAssets) {
        considered++;
        const trade = buildSuggestion(
          [give],
          [get],
          myRosterId,
          partner,
          mine,
          ctx,
          tolerance,
        );
        if (trade) forPartner.push(trade);
      }
    }

    forPartner.sort((a, b) => b.score - a.score);
    trades.push(...forPartner.slice(0, perPartner));
  }

  const seen = new Set<string>();
  const ranked = trades
    .sort((a, b) => b.score - a.score)
    .filter((trade) => !seen.has(trade.id) && seen.add(trade.id))
    .slice(0, maxResults);

  const note =
    ranked.length > 0
      ? null
      : ctx.picks.length === 0
        ? `Searched ${considered} packages and found none that help both sides. Draft-pick values didn't load, which removes the usual way to balance an uneven offer — try again in a moment.`
        : `Searched ${considered} packages and found none that help both sides. Every trade that upgrades your lineup makes the other team worse off, so nothing here would be accepted.`;

  return { trades: ranked, considered, note };
}
