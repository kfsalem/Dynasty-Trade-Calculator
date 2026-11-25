import type { ReactNode } from 'react';
import type { TrendWindow, TrendWindowKey } from '../values/valueTrend';
import { windowLabel } from '../lib/trendText';

/**
 * Pick the span a value trend covers (#158): a week, four weeks, or since the
 * history began — whichever of those the history can fill.
 *
 * Plain buttons with `aria-pressed` in a labelled group, for the reason the
 * Trade builder's side switch gives: `role="radio"` promises arrow keys, and
 * a control that declares a role keeps its keyboard contract or does not
 * declare it. Tab and Space work on these with no help.
 */
export function TrendWindowPicker({
  windows,
  value,
  onChange,
  label = 'Window',
}: {
  windows: TrendWindow[];
  value: TrendWindowKey;
  onChange: (next: TrendWindowKey) => void;
  label?: string;
}) {
  if (windows.length < 2) return null;
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-surface p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {windows.map((option) => (
        <PillButton
          key={option.key}
          pressed={value === option.key}
          onClick={() => onChange(option.key)}
        >
          {windowLabel(option)}
        </PillButton>
      ))}
    </div>
  );
}

/** One pill of a segmented control: the pressed one raised, the rest quiet. */
export function PillButton({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`min-h-11 shrink-0 rounded-full px-3.5 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:[outline-offset:-2px] fine:min-h-8 ${
        pressed ? 'bg-raised text-ink elevation-raised' : 'text-subtle hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
