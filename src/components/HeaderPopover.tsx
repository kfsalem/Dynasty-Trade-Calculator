import { useEffect, useRef, type ReactNode } from 'react';

interface Props {
  /** What the pill shows. Phrasing content only: it sits inside `<summary>`. */
  summary: ReactNode;
  /** The accessible name when `summary` is shortened or icon-only. */
  label?: string;
  /** Paints the pill as a warning — for a verdict someone should read. */
  caution?: boolean;
  children: ReactNode;
}

/**
 * A pill in the header that opens onto detail (#120).
 *
 * `<details>` rather than a hand-built menu: it is a real disclosure to every
 * screen reader, opens from the keyboard with no script, and keeps its content
 * in the DOM. What it lacks is the two ways people expect a popover to close,
 * so those are added — a press anywhere outside it, and Escape, which also puts
 * focus back on the pill so a keyboard user is not dropped at the top of the
 * page.
 */
export function HeaderPopover({ summary, label, caution = false, children }: Props) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const close = (event: Event) => {
      const details = ref.current;
      if (!details?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return;
        details.open = false;
        details.querySelector('summary')?.focus();
        return;
      }
      if (!details.contains(event.target as Node)) details.open = false;
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, []);

  return (
    <details ref={ref} className="group relative min-w-0">
      <summary
        aria-label={label}
        className={`flex h-11 min-w-0 cursor-pointer list-none items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors fine:h-9 [&::-webkit-details-marker]:hidden ${
          caution
            ? 'border-caution bg-caution-soft text-caution'
            : 'border-line bg-surface text-ink hover:bg-raised'
        }`}
      >
        {summary}
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0 text-subtle transition-transform group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      {/* Anchored under the pill from `sm` up. Below it the pill can sit
          anywhere in a 375px row, and a panel hung from its right edge runs off
          the left of the screen, so on a phone it spans the viewport instead. */}
      <div className="rise-in fixed inset-x-4 top-20 z-30 rounded-card border border-line bg-surface p-4 elevation-overlay sm:absolute sm:inset-x-auto sm:top-auto sm:right-0 sm:mt-2 sm:w-96">
        {children}
      </div>
    </details>
  );
}
