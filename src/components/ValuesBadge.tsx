import type { ValueOrigin } from '../values/source';
import { valuesBadge } from '../lib/valuesText';
import { HeaderPopover } from './HeaderPopover';

interface Props {
  origin: ValueOrigin | undefined;
}

/**
 * Says when the player values are a saved copy rather than live (#43).
 *
 * Only then: with live values there is no badge, and the league popover carries
 * the source in one line. When FantasyCalc cannot be reached the app now loads
 * anyway, on older prices — and that has to be as hard to miss as a failed
 * scoring check, so it takes the same caution pill beside it.
 */
export function ValuesBadge({ origin }: Props) {
  const badge = valuesBadge(origin);
  if (!badge) return null;

  return (
    // Never the pill that gives way: its label is a date, and a header that
    // clips it to "Values from Oc…" has hidden the one fact it carries.
    <div className="shrink-0">
      <HeaderPopover
        label={`${badge.label}. Player value details`}
        caution
        summary={
          <>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-4 w-4 shrink-0 text-caution"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            {/* Icon only on a phone, as the scoring badge is: the name is on the pill. */}
            <span className="hidden whitespace-nowrap lg:inline">{badge.label}</span>
          </>
        }
      >
        <p className="text-sm text-caution">{badge.detail}</p>
      </HeaderPopover>
    </div>
  );
}
