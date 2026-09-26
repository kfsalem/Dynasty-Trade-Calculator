import type { ScoringFidelity } from '../engine/scoringCheck';
import type { ScoringPremium } from '../engine/scoringPremium';
import { scoringBadge } from '../lib/scoringText';
import { HeaderPopover } from './HeaderPopover';
import { ScoringNote } from './ScoringNote';

interface Props {
  fidelity: ScoringFidelity | undefined;
  premium?: ScoringPremium;
}

/**
 * The scoring check as a header badge that opens onto the full note (#120).
 *
 * The note was a paragraph at the top of every tab, listing touchdown bonuses
 * before anything a reader came for. The verdict stays visible here — and a
 * failed check stays loud, in the caution colour, because that is the one case
 * where a reader must not miss it: the app is telling them it fell back to
 * market prices. The evidence is one tap away, unchanged.
 */
export function ScoringBadge({ fidelity, premium }: Props) {
  const badge = scoringBadge(fidelity, premium);
  if (!badge) return null;

  return (
    <HeaderPopover
      label={`${badge.label}. Scoring details`}
      caution={badge.caution}
      summary={
        <>
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className={`h-4 w-4 shrink-0 ${badge.caution ? 'text-caution' : 'text-positive'}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {badge.caution ? (
              <>
                <path d="M12 3l9 16H3z" />
                <path d="M12 10v4M12 17v.5" />
              </>
            ) : (
              <>
                <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
                <path d="M9 12l2 2 4-4" />
              </>
            )}
          </svg>
          {/* Icon only on a phone: the header has room for the league and this
              badge, not for both of their sentences. The name is on the pill. */}
          <span className="hidden truncate lg:inline">{badge.label}</span>
        </>
      }
    >
      {/* The note brings its own callout box for when it stood on the page;
          inside the popover that is a box in a box, so it is flattened here.
          Its text colour stays, so a failed check still reads as a warning. */}
      <div className="[&>p]:mt-0 [&>p]:border-0 [&>p]:bg-transparent [&>p]:p-0">
        <ScoringNote fidelity={fidelity} premium={premium} />
      </div>
    </HeaderPopover>
  );
}
