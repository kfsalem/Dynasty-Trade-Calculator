import { useState } from 'react';
import { fetchTrackRecord } from '../data/load';
import { summarize, THIN, type Bucket, type TrackRecordSummary } from '../engine/trackRecord';

/** A share as a whole percentage. Unlike `formatChance` this is a count, so 100% is allowed. */
const pct = (share: number) => `${Math.round(share * 100)}%`;

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
/** A small count in words, as prose writes it. */
const count = (n: number) => WORDS[n] ?? n.toLocaleString();

type State =
  | { status: 'idle' | 'loading' | 'failed' }
  | { status: 'ready'; summary: TrackRecordSummary };

/**
 * How often calls like the ones above have come true (#164).
 *
 * Folded away under the calls, beside "too close to call", and fetched only
 * when opened: it is the receipt for the percentages, not something every
 * reader needs every week. The answer comes first — stated against actual —
 * and the table under it says which ranges are too thin to read rather than
 * printing a rate for four calls.
 */
export function TrackRecord() {
  const [state, setState] = useState<State>({ status: 'idle' });

  const load = () => {
    if (state.status !== 'idle' && state.status !== 'failed') return;
    setState({ status: 'loading' });
    fetchTrackRecord().then((file) =>
      setState(
        file && file.rows.length
          ? { status: 'ready', summary: summarize(file) }
          : { status: 'failed' },
      ),
    );
  };

  return (
    <details
      className="mt-4 border-t border-line pt-3"
      onToggle={(event) => {
        if (event.currentTarget.open) load();
      }}
    >
      <summary className="cursor-pointer text-sm font-medium text-accent">
        How often these calls come true
      </summary>
      {state.status === 'loading' && (
        <div aria-hidden="true">
          <div className="skeleton mt-3 h-4 w-3/4" />
          <div className="skeleton mt-3 h-24 w-full" />
        </div>
      )}
      {state.status === 'failed' && (
        <p className="mt-2 text-xs text-muted">The record could not be loaded. Try again later.</p>
      )}
      {state.status === 'ready' && <Record summary={state.summary} />}
    </details>
  );
}

function Record({ summary }: { summary: TrackRecordSummary }) {
  const { opinions, decisive, facts, buckets, seasons } = summary;
  const since = seasons[0];

  return (
    <div className="rise-in">
      <p className="mt-2 text-sm font-medium text-ink">
        Of {opinions.calls.toLocaleString()} start-or-sit calls since {since}, this panel put them at{' '}
        {pct(opinions.stated)} on average, and {pct(opinions.rate)} came true.
      </p>
      <p className="mt-1 text-xs text-muted">
        Replayed over every finished week of {count(summary.leagues)} real dynasty leagues: the lineup
        each manager set, against the one this panel would have recommended, graded on the points
        Sleeper paid. Updated each Tuesday. The range beside each rate is where the true rate
        probably sits, given how many calls there were.
      </p>

      <table className="mt-3 w-full text-sm">
        <caption className="sr-only">
          Calls grouped by the chance this panel stated, with how many came true
        </caption>
        <thead>
          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-subtle">
            <th scope="col" className="py-2 pr-3">
              Stated
            </th>
            <th scope="col" className="px-2 py-2 text-right">
              Calls
            </th>
            <th scope="col" className="py-2 pl-2 text-right">
              Came true
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {buckets.map((bucket) => (
            <BucketRow key={bucket.from} bucket={bucket} />
          ))}
        </tbody>
      </table>

      {decisive.calls > 0 && (
        <p className="mt-3 text-xs text-muted">
          <span className="font-semibold text-ink">Calls stated as a change to make:</span>{' '}
          {pct(decisive.rate)} came true against {pct(decisive.stated)} stated, over{' '}
          {decisive.calls.toLocaleString()} calls.
        </p>
      )}
      {facts.calls > 0 && (
        <p className="mt-1 text-xs text-muted">
          <span className="font-semibold text-ink">Benching a man who is out or on bye:</span>{' '}
          {facts.hits} of {facts.calls} came true. The chance printed beside those undersells
          them; they are close to certain.
        </p>
      )}
    </div>
  );
}

function BucketRow({ bucket }: { bucket: Bucket }) {
  const thin = bucket.calls < THIN;
  return (
    <tr>
      <th scope="row" className="py-2 pr-3 text-left font-medium tabular">
        {pct(bucket.from)}–{pct(bucket.to)}
      </th>
      <td className="px-2 py-2 text-right tabular">{bucket.calls.toLocaleString()}</td>
      <td className="py-2 pl-2 text-right tabular">
        {thin ? (
          <span className="text-subtle">too few to read</span>
        ) : (
          <>
            <span className="font-semibold">{pct(bucket.rate)}</span>{' '}
            <span className="text-xs text-subtle">
              ({pct(bucket.low)}–{pct(bucket.high)})
            </span>
          </>
        )}
      </td>
    </tr>
  );
}
