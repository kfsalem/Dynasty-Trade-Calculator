import type { TradeSideInput } from '../engine/trade';
import { FAIRNESS_LABEL } from '../engine/trade';
import type { FixResult, TradeFix } from '../engine/tradeFix';
import { formatValue } from '../lib/format';

/**
 * The smallest changes that make an uneven trade fair (#168), under the
 * verdict that called it uneven. Each one is a single tap away from being the
 * trade on screen, so the reader checks it in the builder rather than taking
 * the card's word for it.
 */
export function TradeFixes({
  result,
  nameOf,
  onApply,
}: {
  result: FixResult;
  nameOf: (rosterId: number) => string;
  onApply: (sides: [TradeSideInput, TradeSideInput]) => void;
}) {
  return (
    <section aria-label="Make it fair" className="card rise-in mt-4">
      <h3 className="font-display text-xl font-bold tracking-tight">Make it fair</h3>

      {result.fixes.length > 0 ? (
        <>
          <p className="mt-1 text-sm text-muted">
            The smallest single changes that bring this within 8%.
          </p>
          <ul className="mt-4 space-y-2">
            {result.fixes.map((fix) => (
              <li
                key={`${fix.kind}:${fix.removes?.id ?? ''}:${fix.adds?.id ?? ''}`}
                className="flex flex-col gap-3 rounded-xl border border-line bg-raised px-4 py-3 sm:flex-row sm:items-center sm:justify-between fine:py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink">{describe(fix, nameOf)}</p>
                  <p className="tabular mt-0.5 text-xs text-subtle">{outcome(fix, nameOf)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onApply(fix.sides)}
                  className="btn-secondary shrink-0 text-sm"
                >
                  Apply
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted">{noFix(result)}</p>
      )}
    </section>
  );
}

function describe(fix: TradeFix, nameOf: (rosterId: number) => string): string {
  const team = nameOf(fix.rosterId);
  switch (fix.kind) {
    case 'add':
      return `${team} adds ${fix.adds?.label}`;
    case 'remove':
      return `${team} keeps ${fix.removes?.label}`;
    case 'swap':
      return `${team} sends ${fix.adds?.label} instead of ${fix.removes?.label}`;
  }
}

function outcome(fix: TradeFix, nameOf: (rosterId: number) => string): string {
  const { analysis } = fix;
  const parts = [
    `${FAIRNESS_LABEL[analysis.fairnessRating]} · ${Math.round(analysis.valueDifferencePct * 100)}% apart`,
  ];
  if (fix.lineupCost >= 1) {
    parts.push(
      `costs ${nameOf(fix.rosterId)} ${formatValue(fix.lineupCost)} in its starting lineup`,
    );
  }
  return parts.join(' · ');
}

function noFix(result: FixResult): string {
  if (result.rosterBlocked) {
    return 'The changes that would even this out all leave a roster over its limit.';
  }
  if (!result.closest) {
    return 'No single change is possible: neither side has anything left to add, take back or swap.';
  }
  return (
    `No single addition, removal or swap brings this within 8%. The closest gets to ` +
    `${Math.round(result.closest.pct * 100)}% apart, so it needs more than one asset to move.`
  );
}
