import type { DraftPick, Player, TradeAnalysis, TradeSideResult } from '../types';
import {
  AGE_CLIFF,
  HORIZON_YEARS,
  analyzeTeam,
  retention,
  type ContentionProfile,
  type Quadrant,
  type TeamAnalysis,
} from './analysis';
import { picksForRoster } from './picks';
import { bestLineup, byValue, valuePlayers, type RosterSummary } from './rosterValue';
import { evaluateTrade, type TradeContext } from './trade';
import type { RoleTrend, RoleTrends } from './roleTrend';

/**
 * Trade suggestions: search the league for offers that help both sides.
 *
 * The hard part is not finding trades that help *you* — that is one line of
 * arithmetic. It is finding ones the other manager would actually accept. An
 * offer nobody takes is worth nothing, so every candidate here must clear a
 * two-sided bar, and every suggestion ships with the reason the other side says
 * yes, stated in their terms.
 */

/**
 * `value` is league-adjusted — what the asset is worth to the team holding it.
 * `marketValue` is what the other manager will quote. Packages are balanced on
 * the market figure, so an offer looks fair in the terms it will be judged in,
 * while whether it helps is decided on the league-adjusted one.
 */
export type TradeAsset =
  | {
      kind: 'player';
      id: string;
      label: string;
      value: number;
      marketValue: number;
      player: Player;
    }
  | {
      kind: 'pick';
      id: string;
      label: string;
      value: number;
      marketValue: number;
      pick: DraftPick;
    };

export interface SideBenefit {
  /** Change in the best lineup this team could field today, in win-now units. */
  now: number;
  /**
   * Change in the age-decayed lineup three years out, plus pick value moved.
   * Dynasty units — picks and prospects have no win-now value to move.
   */
  future: number;
  /**
   * `now` and `future` weighted by this team's contention window.
   *
   * A weighted blend of two scales, and honestly so: the weights are a
   * statement about how much a manager cares about each question, not a claim
   * that the units are the same. It exists to be compared against other
   * packages for the same team, which is the only comparison it is used for.
   */
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
  /**
   * Role trends, when activity data is available.
   *
   * Optional because the engine has to keep working without it — the static
   * activity files are allowed to fail to load, and a league that cannot value
   * a role change must still be able to suggest a trade.
   */
  trends?: RoleTrends;
}

export interface SuggestOptions {
  maxResults?: number;
  /** Cap per partner so the list spans the league instead of one team's variations. */
  perPartner?: number;
  /** Largest raw-value gap, as a share of the bigger side, that still reads as fair. */
  tolerance?: number;
  /** Movable assets considered per team. Bounds the search at teams × k². */
  candidatesPerTeam?: number;
  /**
   * Smallest benefit worth proposing, as a share of that side's starting value.
   *
   * Without a floor the engine happily suggests a swap worth +172 to a roster
   * with 36,704 of starting value — arithmetically positive, but nobody opens
   * a trade negotiation over 0.5%. Both sides must clear it.
   */
  minBenefitShare?: number;
}

/**
 * How much each contention window cares about now versus later.
 *
 * This is what makes two-sided trades possible at all. Requiring both teams to
 * gain *starting-lineup strength* would rule out the single most common dynasty
 * trade — a rebuilder sending a veteran to a contender for picks — because
 * picks never start. A rebuilder is not trying to win now, so measuring their
 * gain in win-now units answers a question they did not ask.
 *
 * No weight drops below 0.35 on the present, deliberately. A model that scores
 * a bottom team purely on the future will happily recommend stripping it to the
 * studs, and a league where two teams have given up on the season is less fun
 * for the other eight — which is the actual product being built here. Rebuilds
 * are supposed to trade away the pieces that will not be there for the next
 * good team, not every piece that can be sold.
 */
export const WINDOW_WEIGHTS: Record<Quadrant, { now: number; future: number }> = {
  juggernaut: { now: 0.65, future: 0.35 },
  win_now: { now: 0.9, future: 0.1 },
  rebuilding: { now: 0.4, future: 0.6 },
  danger: { now: 0.35, future: 0.65 },
};

/**
 * The same four weights, read continuously instead of as a switch.
 *
 * The quadrant is a median split on each axis, so the table above jumps from
 * 0.9 to 0.35 between two teams that may be a percent apart in strength. On the
 * real ten-team league the sixth-placed roster sits four percent under the
 * median and was scored on every trade as though it had given up on the season,
 * while fifth was scored as a contender. Nothing about those two teams justifies
 * a two-and-a-half-fold difference in how much winning this year is worth to
 * them.
 *
 * Bilinear interpolation across the four corners fixes it without inventing a
 * new model: the corner values are exactly the table above, so an unambiguous
 * juggernaut and an unambiguous danger-zone team are scored precisely as before,
 * and a team in the middle of the league lands in the middle of the weights —
 * 0.575 now, which is the balance a mid-table dynasty roster actually wants.
 */
export function windowWeights(contention: ContentionProfile): {
  now: number;
  future: number;
} {
  const strong = contention.nowShare;
  const young = contention.youthShare;

  const now =
    (1 - strong) * (1 - young) * WINDOW_WEIGHTS.danger.now +
    (1 - strong) * young * WINDOW_WEIGHTS.rebuilding.now +
    strong * (1 - young) * WINDOW_WEIGHTS.win_now.now +
    strong * young * WINDOW_WEIGHTS.juggernaut.now;

  return { now, future: 1 - now };
}

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

const playerAsset = (player: Player, value: number, marketValue: number): TradeAsset => ({
  kind: 'player',
  id: player.id,
  label: player.name,
  value,
  marketValue,
  player,
});

const pickAsset = (pick: DraftPick): TradeAsset => ({
  kind: 'pick',
  id: pick.id,
  label: pick.label,
  value: pick.value,
  marketValue: pick.marketValue,
  pick,
});

/**
 * The lineup a roster could field in three years, after age decay.
 *
 * Same model as `analysis.futureScore`, but taking a raw id list so it can be
 * run against a hypothetical post-trade roster.
 */
function futureLineupValue(playerIds: string[], ctx: SuggestContext): number {
  // All three figures decay together; see the matching note in
  // `analysis.futureScore`, including why this stays on the dynasty scale when
  // the rest of the lineup maths moved to win-now.
  const entries = valuePlayers(playerIds, ctx.players, ctx.values).map((entry) => {
    const factor = retention(entry.player.position, entry.player.age, HORIZON_YEARS);
    return {
      ...entry,
      value: entry.value * factor,
      marketValue: entry.marketValue * factor,
      winNowValue: entry.winNowValue * factor,
    };
  });
  return bestLineup(entries, ctx.league.settings.startingSlots, {
    compare: byValue,
    includeUnavailable: true,
  }).reduce((total, slot) => total + (slot.entry?.value ?? 0), 0);
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
 * - **Sell-high** — anyone whose price is outliving his role. The reason to
 *   move him is the whole definition of the category.
 * - **Buy-low on the bench** — a player whose role has outgrown his price but
 *   who is still benched here. His owner is sitting him, so he is genuinely
 *   available; that he is *underpriced* is the acquiring side's edge, not a
 *   reason his owner holds him. Restricted to the bench on purpose: a riser
 *   already in the lineup is not something his manager sells.
 * - **Contenders** additionally spend **picks**, which are the currency of a
 *   team trying to win before its window shuts.
 * - **Rebuilders** additionally sell **aging starters**, whose value is highest
 *   today and falls every year they are held.
 *
 * Drawing from anywhere else produces offers that get declined on sight.
 *
 * The trend categories matter because the surplus test is a *value* test — it
 * asks who would out-rank a weakest starter elsewhere. A player whose role has
 * changed but whose price has not is exactly the player that test misses, and
 * exactly the one worth trading for.
 */
export function movableAssets(
  analysis: TeamAnalysis,
  summary: RosterSummary,
  ctx: SuggestContext,
  limit: number,
): TradeAsset[] {
  const assets = new Map<string, TradeAsset>();
  const market = (id: string, fallback: number) =>
    ctx.values.get(id)?.marketValue ?? fallback;

  for (const surplus of analysis.surpluses) {
    assets.set(
      surplus.player.id,
      playerAsset(surplus.player, surplus.value, market(surplus.player.id, surplus.value)),
    );
  }

  for (const trend of rosterTrends(ctx.trends, summary.rosterId)) {
    if (trend.gap > 0 && summary.starterIds.has(trend.player.id)) continue;
    const entry = summary.players.find((p) => p.player.id === trend.player.id);
    if (!entry || entry.value <= 0) continue;
    assets.set(
      trend.player.id,
      playerAsset(trend.player, entry.value, market(trend.player.id, entry.value)),
    );
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
      assets.set(
        entry.player.id,
        playerAsset(entry.player, entry.value, market(entry.player.id, entry.value)),
      );
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
  // Balanced on market value: an offer has to look fair in the terms the other
  // manager will check it in, not in our own adjusted units.
  const gapOf = (a: TradeAsset[], b: TradeAsset[]) =>
    sum(b.map((x) => x.marketValue)) - sum(a.map((x) => x.marketValue));
  const largerOf = (a: TradeAsset[], b: TradeAsset[]) =>
    Math.max(sum(a.map((x) => x.marketValue)), sum(b.map((x) => x.marketValue)));

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
    if (pick.marketValue <= 0 || used.has(pick.id)) continue;
    const residual = Math.abs(target - pick.marketValue);
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
  contention: ContentionProfile,
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

  const weights = windowWeights(contention);

  return {
    benefit: {
      now,
      future,
      total: weights.now * now + weights.future * future,
      quadrant: contention.quadrant,
    },
    afterIds,
    afterStarters: lineupIds(afterIds, ctx),
  };
}

const round = (n: number): string => Math.round(n).toLocaleString('en-US');

const pct = (share: number): string => `${Math.round(share * 100)}%`;

/** Every trend on one roster, both directions, in one list. */
function rosterTrends(trends: RoleTrends | undefined, rosterId: number): RoleTrend[] {
  if (!trends) return [];
  return [...trends.buyLow, ...trends.sellHigh].filter((t) => t.rosterId === rosterId);
}

function findTrend(trends: RoleTrends | undefined, playerId: string): RoleTrend | undefined {
  if (!trends) return undefined;
  return [...trends.buyLow, ...trends.sellHigh].find((t) => t.player.id === playerId);
}

/**
 * The evidence behind a trend, in the sentence a manager would say it in.
 *
 * The games count is not decoration. It is the difference between a role change
 * and a game script, and a claim about someone's usage that does not say how
 * much of it was measured is not a claim anyone should act on.
 */
function trendEvidence(trend: RoleTrend): string {
  const lead = trend.reasons[0];
  if (!lead) return `${trend.games} games of usage data`;

  const direction = lead.to > lead.from ? 'up from' : 'down from';
  const window = `over ${trend.games} ${trend.games === 1 ? 'game' : 'games'}`;
  const caveat = trend.thin ? ', a short window' : '';

  return `${pct(lead.to)} ${lead.label}, ${direction} ${pct(lead.from)} ${window}${caveat}`;
}

/** Bullets explaining a trade from one team's point of view. */
function explain(
  side: TradeSideResult,
  benefit: SideBenefit,
  afterStarters: Set<string>,
  analysis: TeamAnalysis,
  summary: RosterSummary,
  perspective: 'mine' | 'theirs',
  trends?: RoleTrends,
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
    // Stated before the lineup and positional reasons, because a role the
    // market has not caught up with is the whole argument for the trade where
    // it applies — the rest is why the fit works once you have him.
    const rising = findTrend(trends, player.id);
    if (rising && rising.gap > 0) {
      // Only claim the gap is money when the model actually banked it. Through
      // the offseason `applied` is false — the role change happened, but the
      // market has had months to price it, so no value on the page includes it
      // and neither does `benefit`. Asserting it here regardless put the card in
      // direct contradiction with the Role trends panel three feet above it,
      // which says in as many words that none of it is applied.
      lines.push(
        trends?.applied
          ? `${player.name} is playing more than his price says: ${trendEvidence(rising)}. That's worth about ${round(rising.gap)} the market hasn't charged for yet.`
          : `${player.name} finished last season playing more than his price says: ${trendEvidence(rising)}. Not counted in any number here — the market has had all offseason to price it — but it is the shape of a player worth asking about.`,
      );
    }

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
    const falling = findTrend(trends, player.id);
    if (falling && falling.gap < 0) {
      lines.push(
        trends?.applied
          ? `${player.name} is selling at a price his current role no longer supports: ${trendEvidence(falling)}. Moving him now is ${round(Math.abs(falling.gap))} of name value ${they === 'You' ? 'you' : 'they'} would otherwise watch the market take back.`
          : `${player.name} finished last season at a price his role no longer supported: ${trendEvidence(falling)}. Not counted in any number here, but it is why he is on the block.`,
      );
      continue;
    }

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
  minBenefitShare: number,
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
  const my = sideBenefit(mySide, mine.analysis.contention, ctx);
  const their = sideBenefit(theirSide, partner.analysis.contention, ctx);

  // The guard against the obvious failure mode. An engine that optimizes only
  // your side generates offers nobody accepts, which is the same as generating
  // nothing at all. The floor rules out the other failure mode: offers that are
  // mutually positive but far too small to be worth anyone's time.
  const floor = (side: TradeSideResult) =>
    Math.max(1, side.starterValueBefore * minBenefitShare);
  if (my.benefit.total < floor(mySide) || their.benefit.total < floor(theirSide)) {
    return null;
  }

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
      ctx.trends,
    ),
    whyTheySayYes: explain(
      theirSide,
      their.benefit,
      their.afterStarters,
      partner.analysis,
      partner.summary,
      'theirs',
      ctx.trends,
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
    minBenefitShare = 0.005,
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

    // Keyed on the players alone. The same swap balanced with a 1st, a 2nd, or
    // a pair of picks is one idea presented three ways, and filling a partner's
    // slots with those variants crowds out genuinely different offers.
    const byPlayers = new Map<string, SuggestedTrade>();

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
          minBenefitShare,
        );
        if (!trade) continue;

        const players = (assets: TradeAsset[]) =>
          assets
            .filter((a) => a.kind === 'player')
            .map((a) => a.id)
            .sort()
            .join(',');
        const key = `${players(trade.give)}>${players(trade.get)}`;

        const seen = byPlayers.get(key);
        if (!seen || trade.score > seen.score) byPlayers.set(key, trade);
      }
    }

    const forPartner = [...byPlayers.values()].sort((a, b) => b.score - a.score);
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
        ? `Searched ${considered} packages and found none worth proposing. Draft-pick values didn't load, which removes the usual way to balance an uneven offer — try again in a moment.`
        : `Searched ${considered} packages and found none worth proposing. Either they leave the other team worse off, or the gain is too small on both sides to be worth opening a negotiation over.`;

  return { trades: ranked, considered, note };
}
