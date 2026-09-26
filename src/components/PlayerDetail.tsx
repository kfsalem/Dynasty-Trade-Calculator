import { useEffect, useRef, type ReactNode } from 'react';
import type { Position } from '../types';
import type { PlayerDetail as Detail } from '../engine/playerDetail';
import { injuryNote } from '../engine/availability';
import { POSITION_STYLES, formatAge, formatInjury, formatValue } from '../lib/format';
import { describeRole } from '../lib/roleText';
import { describeAdjustment, describeMetric, describeSnaps } from '../lib/activityText';
import { UnvaluedCell } from './UnvaluedCell';

interface Props {
  /** The player to show, or null when the panel is closed. */
  detail: Detail | null;
  chartSeason: number | null;
  priced?: Set<Position>;
  onClose: () => void;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-subtle">{title}</h3>
      <div className="mt-2 space-y-1.5 text-sm text-muted">{children}</div>
    </section>
  );
}

function Figure({ label, caption, value }: { label: string; caption: string; value: number }) {
  return (
    <div className="rounded-xl border border-line bg-raised p-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">{label}</dt>
      <dd className="mt-1 font-display text-3xl font-bold tracking-tight tabular">
        {formatValue(value)}
      </dd>
      <dd className="mt-1 text-xs text-muted">{caption}</dd>
    </div>
  );
}

const teams = (n: number) => `${n} ${n === 1 ? 'team' : 'teams'}`;

/**
 * One player, everything the app knows about him, in one place (#68).
 *
 * Every row in every tab has been trying to be this — nine cells and a hover
 * on the roster tab alone — because there was nowhere else for the detail to
 * live. Each figure here is the one a row already shows, with room for the
 * sentence that explains it instead of a tooltip.
 *
 * A native modal `<dialog>`: the browser makes the rest of the page inert,
 * which is the focus trap, and Escape closes it. Focus goes back to whatever
 * opened it — the name in the row — so a keyboard reader carries on down the
 * list from where they were. A sheet from the bottom on a phone, where this is
 * the main reading surface; a panel from the right from `sm` up, so the table
 * that opened it stays in view.
 */
export function PlayerDetail({ detail, chartSeason, priced, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const open = detail !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnTo.current = document.activeElement as HTMLElement | null;
      // jsdom has no showModal; the attribute is the same state without the
      // inert backdrop, which is all a test needs.
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    } else if (!open && dialog.open) {
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    }
  }, [open]);

  // `close` fires for Escape, the close button and a backdrop press alike.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handle = () => {
      onClose();
      returnTo.current?.focus();
    };
    dialog.addEventListener('close', handle);
    return () => dialog.removeEventListener('close', handle);
  }, [onClose]);

  const close = () => {
    const dialog = ref.current;
    if (dialog && typeof dialog.close === 'function') dialog.close();
    else {
      onClose();
      returnTo.current?.focus();
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby="player-detail-name"
      // A press on the backdrop lands on the dialog element itself.
      onClick={(event) => {
        if (event.target === ref.current) close();
      }}
      className="fixed inset-x-0 top-auto bottom-0 m-0 max-h-[88vh] w-full max-w-none overflow-y-auto rounded-t-card border border-line bg-surface p-0 text-ink elevation-overlay backdrop:bg-black/60 sm:inset-y-0 sm:right-0 sm:left-auto sm:h-full sm:max-h-none sm:w-[28rem] sm:rounded-none sm:rounded-l-card"
    >
      {detail && (
        <div className="rise-in space-y-4 p-5 pb-8">
          <header className="flex items-start gap-3">
            <span
              className={`mt-1 inline-flex w-11 shrink-0 justify-center rounded px-1.5 py-0.5 text-xs font-semibold ${
                POSITION_STYLES[detail.player.position].chip
              }`}
            >
              {POSITION_STYLES[detail.player.position].label}
            </span>
            <div className="min-w-0 flex-1">
              <h2
                id="player-detail-name"
                className="font-display text-2xl font-bold tracking-tight"
              >
                {detail.player.name}
              </h2>
              <p className="mt-0.5 text-sm text-subtle">
                {detail.player.team ?? 'No NFL team'}
                {detail.player.age !== null && ` · ${formatAge(detail.player.age)}`}
                {' · '}
                {detail.owner
                  ? detail.owner.mine
                    ? 'your roster'
                    : detail.owner.teamName
                  : 'free agent'}
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line text-muted hover:bg-raised hover:text-ink fine:h-9 fine:w-9"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </header>

          {detail.player.injury && (
            <p
              className={`rounded-xl border p-3 text-sm ${
                detail.unavailable
                  ? 'border-negative bg-negative-soft text-negative'
                  : 'border-caution bg-caution-soft text-caution'
              }`}
            >
              <span className="font-semibold">{formatInjury(detail.player.injury)}.</span>{' '}
              {injuryNote(detail.player.injury)}
            </p>
          )}

          {detail.value ? (
            <>
              <dl className="grid grid-cols-2 gap-3">
                <Figure
                  label="Dynasty"
                  caption="What he is worth to hold."
                  value={detail.value.dynasty}
                />
                <Figure
                  label="Win-now"
                  caption="What he does for a lineup this season."
                  value={detail.value.winNow}
                />
              </dl>
              <p className="text-sm text-muted">
                The market quotes him at{' '}
                <span className="font-semibold text-ink tabular">
                  {formatValue(detail.value.market)}
                </span>
                . Both figures above are that price measured against this league: what
                he adds over the best player at his position nobody here is starting.
              </p>
            </>
          ) : (
            <p className="rounded-xl border border-line bg-raised p-3 text-sm text-muted">
              No market price.{' '}
              <UnvaluedCell
                position={detail.player.position}
                priced={priced}
                className="text-subtle"
              />
            </p>
          )}

          <Section title="In this league">
            <p>
              {detail.owner === null
                ? 'On the waiver wire.'
                : detail.unavailable
                  ? `On ${detail.owner.mine ? 'your' : `${detail.owner.teamName}'s`} roster, out of every lineup this season.`
                  : detail.starting
                    ? `In ${detail.owner.mine ? 'your' : `${detail.owner.teamName}'s`} best lineup.`
                    : `On ${detail.owner.mine ? 'your' : `${detail.owner.teamName}'s`} bench.`}
            </p>
            {detail.wouldStartOn !== null && (
              <p>
                {detail.wouldStartOn === 0
                  ? detail.owner
                    ? 'No other team would start him.'
                    : 'No team here would start him.'
                  : detail.owner
                    ? `Would start on ${teams(detail.wouldStartOn)} other than his own.`
                    : `Would start on ${teams(detail.wouldStartOn)} in this league.`}
              </p>
            )}
          </Section>

          <Section title="Role">
            <p>
              {detail.role
                ? describeRole(detail.role, chartSeason)
                : 'No role on record — no snaps and no published depth chart for him.'}
            </p>
            {detail.snaps && <p>{describeSnaps(detail.snaps)}</p>}
          </Section>

          {detail.usage && (
            <Section title="Opportunity">
              <ul className="space-y-1.5">
                {detail.usage.metrics.map((metric) => (
                  <li key={metric.label}>{describeMetric(metric)}.</li>
                ))}
              </ul>
            </Section>
          )}

          {detail.adjustment && (
            <Section title="What his role did to his value">
              <p>{describeAdjustment(detail.adjustment)}</p>
            </Section>
          )}

          {detail.trend && (
            <Section title={detail.trend.side === 'buy-low' ? 'Buy low' : 'Sell high'}>
              <p>
                {detail.trend.side === 'buy-low'
                  ? 'His role has outgrown his price.'
                  : 'His price has outlived his role.'}{' '}
                The role change is worth {detail.trend.trend.gap > 0 ? '+' : '−'}
                {formatValue(Math.abs(detail.trend.trend.gap))} value points, and his market
                price does not reflect it yet.
                {detail.trend.trend.thin && ' Few games sit behind it, so discount it.'}
              </p>
            </Section>
          )}
        </div>
      )}
    </dialog>
  );
}
