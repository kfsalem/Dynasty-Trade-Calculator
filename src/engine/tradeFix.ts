import type { DraftPick, Player, TradeAnalysis } from '../types';
import { evaluateTrade, rosterCap, type TradeContext, type TradeSideInput } from './trade';
import { picksForRoster } from './picks';

/**
 * The smallest change that makes a lopsided trade fair (#168).
 *
 * When the calculator calls a trade uneven, the next thing a manager does is
 * tick assets by hand until the verdict turns. This does that search for him,
 * over the three single edits a negotiation actually makes:
 *
 * - **add** — the side sending less adds one asset of its own;
 * - **remove** — the side sending more takes one asset back;
 * - **swap** — the side sending more replaces one asset with a cheaper one of
 *   its own.
 *
 * A fix has to bring the trade to Fair or Very fair, in the calculator's own
 * terms (`evaluateTrade`), so the verdict a fix promises is the verdict the
 * builder shows once it is applied. It may not leave either roster over its
 * limit when the trade as built did not, and it may not empty a side: a trade
 * with nothing coming back is a gift.
 *
 * Fairness here is market value, as it is everywhere in the calculator: the
 * number the other manager will check. What a fix costs a lineup is stated
 * beside it rather than used to rule it out — a concession that weakens the
 * conceding side's starters is often exactly the concession being asked for,
 * and the reader is better placed than the engine to say whether it is worth
 * making.
 */

export type FixKind = 'add' | 'remove' | 'swap';

export interface FixAsset {
  kind: 'player' | 'pick';
  id: string;
  label: string;
  marketValue: number;
}

export interface TradeFix {
  kind: FixKind;
  /** The roster making the change. */
  rosterId: number;
  /** What it adds to what it sends: the addition, or the swap's replacement. */
  adds: FixAsset | null;
  /** What it takes back: the removal, or the swap's original. */
  removes: FixAsset | null;
  /** The trade after the change, ready to load into the builder. */
  sides: [TradeSideInput, TradeSideInput];
  analysis: TradeAnalysis;
  /**
   * How much weaker the changing side's starting lineup ends than under the
   * trade as built, in win-now units. Zero when the change costs it nothing.
   */
  lineupCost: number;
}

export interface FixResult {
  fixes: TradeFix[];
  /**
   * When nothing worked: the smallest gap any single change reached, as a
   * share, and the change that reached it. Null when no change was possible
   * at all (nothing to add, take back or swap).
   */
  closest: { pct: number; kind: FixKind } | null;
  /** Some change would have made it fair, but only by overfilling a roster. */
  rosterBlocked: boolean;
}

const FAIR = new Set<TradeAnalysis['fairnessRating']>(['very_fair', 'fair']);

export function isFair(analysis: TradeAnalysis): boolean {
  return FAIR.has(analysis.fairnessRating);
}

/** Single edits weigh one, a swap two: fewer assets moved is the smaller change. */
const SIZE: Record<FixKind, number> = { add: 1, remove: 1, swap: 2 };

/**
 * How many candidates of each kind are fully evaluated. The value screen is
 * arithmetic; `evaluateTrade` rebuilds four lineups, so only the closest few
 * pay for it.
 */
const EVALUATED_PER_KIND = 8;

interface Candidate {
  kind: FixKind;
  rosterId: number;
  adds: FixAsset | null;
  removes: FixAsset | null;
  /** Value gap after the change, as a share of the larger side. */
  pct: number;
}

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

function gapShare(a: number, b: number): number {
  const larger = Math.max(a, b);
  return larger > 0 ? Math.abs(a - b) / larger : 0;
}

export function fixTrade(
  a: TradeSideInput,
  b: TradeSideInput,
  ctx: TradeContext,
  max = 3,
): FixResult {
  const pickById = new Map(ctx.picks.map((p) => [p.id, p]));
  const playerAsset = (p: Player): FixAsset => ({
    kind: 'player',
    id: p.id,
    label: p.name,
    marketValue: ctx.values.get(p.id)?.marketValue ?? 0,
  });
  const pickAsset = (p: DraftPick): FixAsset => ({
    kind: 'pick',
    id: p.id,
    label: p.label,
    marketValue: p.marketValue,
  });

  const assetsOf = (side: TradeSideInput): FixAsset[] => [
    ...side.playerIds.flatMap((id) => {
      const p = ctx.players.get(id);
      return p ? [playerAsset(p)] : [];
    }),
    ...side.pickIds.flatMap((id) => {
      const p = pickById.get(id);
      return p ? [pickAsset(p)] : [];
    }),
  ];

  /** Everything a roster could still put in: unsent players and, where legal, picks. */
  const available = (side: TradeSideInput): FixAsset[] => {
    const roster = ctx.league.rosters.find((r) => r.rosterId === side.rosterId);
    if (!roster) return [];
    const sent = new Set([...side.playerIds, ...side.pickIds]);
    const players = roster.playerIds.flatMap((id) => {
      const p = ctx.players.get(id);
      return p && !sent.has(id) ? [playerAsset(p)] : [];
    });
    const picks = ctx.league.settings.pickTrading
      ? picksForRoster(ctx.picks, side.rosterId)
          .filter((p) => !sent.has(p.id))
          .map(pickAsset)
      : [];
    return [...players, ...picks].filter((asset) => asset.marketValue > 0);
  };

  const outA = sum(assetsOf(a).map((x) => x.marketValue));
  const outB = sum(assetsOf(b).map((x) => x.marketValue));
  // Even already, or nothing on the table: nothing to fix.
  if (outA === outB) return { fixes: [], closest: null, rosterBlocked: false };

  const [light, heavy] = outA < outB ? [a, b] : [b, a];
  const lightOut = Math.min(outA, outB);
  const heavyOut = Math.max(outA, outB);
  const heavyAssets = assetsOf(heavy);

  const candidates: Candidate[] = [];

  for (const asset of available(light)) {
    candidates.push({
      kind: 'add',
      rosterId: light.rosterId,
      adds: asset,
      removes: null,
      pct: gapShare(lightOut + asset.marketValue, heavyOut),
    });
  }

  // Taking back the only asset would leave that side sending nothing.
  if (heavyAssets.length > 1) {
    for (const asset of heavyAssets) {
      candidates.push({
        kind: 'remove',
        rosterId: heavy.rosterId,
        adds: null,
        removes: asset,
        pct: gapShare(lightOut, heavyOut - asset.marketValue),
      });
    }
  }

  const heavySpare = available(heavy);
  for (const original of heavyAssets) {
    for (const replacement of heavySpare) {
      if (replacement.marketValue >= original.marketValue) continue;
      candidates.push({
        kind: 'swap',
        rosterId: heavy.rosterId,
        adds: replacement,
        removes: original,
        pct: gapShare(lightOut, heavyOut - original.marketValue + replacement.marketValue),
      });
    }
  }

  if (candidates.length === 0) return { fixes: [], closest: null, rosterBlocked: false };

  const original = evaluateTrade(a, b, ctx);
  const cap = rosterCap(ctx.league.settings);
  /** The calculator's own rule: over the limit, and only by a trade that adds bodies. */
  const overCap = (side: TradeSideInput, other: TradeSideInput) => {
    const held = ctx.league.rosters.find((r) => r.rosterId === side.rosterId)?.playerIds.length ?? 0;
    const after = held - side.playerIds.length + other.playerIds.length;
    return after > cap && after > held;
  };
  const wasOver = [overCap(a, b), overCap(b, a)];
  let rosterBlocked = false;

  const apply = (c: Candidate): [TradeSideInput, TradeSideInput] => {
    const change = (side: TradeSideInput): TradeSideInput => {
      if (side.rosterId !== c.rosterId) return side;
      const without = (ids: string[], asset: FixAsset | null, kind: 'player' | 'pick') =>
        asset && asset.kind === kind ? ids.filter((id) => id !== asset.id) : ids;
      const plus = (ids: string[], asset: FixAsset | null, kind: 'player' | 'pick') =>
        asset && asset.kind === kind ? [...ids, asset.id] : ids;
      return {
        rosterId: side.rosterId,
        playerIds: plus(without(side.playerIds, c.removes, 'player'), c.adds, 'player'),
        pickIds: plus(without(side.pickIds, c.removes, 'pick'), c.adds, 'pick'),
      };
    };
    return [change(a), change(b)];
  };

  const fixes: TradeFix[] = [];
  for (const kind of ['add', 'remove', 'swap'] as const) {
    const closestOfKind = candidates
      .filter((c) => c.kind === kind)
      .sort((x, y) => x.pct - y.pct)
      .slice(0, EVALUATED_PER_KIND);

    for (const c of closestOfKind) {
      const sides = apply(c);
      const analysis = evaluateTrade(sides[0], sides[1], ctx);
      if (!isFair(analysis)) continue;
      // A trade already over the limit stays a warning; a fix may not create one.
      const isOver = [overCap(sides[0], sides[1]), overCap(sides[1], sides[0])];
      if (isOver.some((over, i) => over && !wasOver[i])) {
        rosterBlocked = true;
        continue;
      }

      const index = c.rosterId === a.rosterId ? 0 : 1;
      const lineupCost = Math.max(
        0,
        original.sides[index].starterValueAfter - analysis.sides[index].starterValueAfter,
      );
      fixes.push({ ...c, sides, analysis, lineupCost });
    }
  }

  // Smallest first: fewest assets moved, then the closest to even, then the
  // cheaper in lineup terms.
  const order = (x: TradeFix, y: TradeFix) =>
    SIZE[x.kind] - SIZE[y.kind] ||
    x.analysis.valueDifferencePct - y.analysis.valueDifferencePct ||
    x.lineupCost - y.lineupCost;
  fixes.sort(order);

  // One of each kind before a second of any, so three cards offer three
  // different moves rather than three picks of nearly the same value.
  const chosen: TradeFix[] = [];
  for (const kind of ['add', 'remove', 'swap'] as const) {
    const best = fixes.find((fix) => fix.kind === kind);
    if (best) chosen.push(best);
  }
  for (const fix of fixes) {
    if (chosen.length >= max) break;
    if (!chosen.includes(fix)) chosen.push(fix);
  }
  chosen.sort(order);

  if (chosen.length > 0) {
    return { fixes: chosen.slice(0, max), closest: null, rosterBlocked: false };
  }

  const nearest = [...candidates].sort((x, y) => x.pct - y.pct)[0];
  return { fixes: [], closest: { pct: nearest.pct, kind: nearest.kind }, rosterBlocked };
}
