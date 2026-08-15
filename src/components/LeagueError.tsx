/**
 * The league failed to load.
 *
 * Three things a bare error message did not do, and this does:
 *
 * 1. **Offers the retry.** Most failures here are a timed-out fetch or a
 *    Sleeper hiccup, and the fix is to ask again. Without a button the only
 *    retry available is a page reload, which on a shared link is also the most
 *    frightening thing to press — see the effect in `App` that keeps the trade
 *    in the address bar precisely so a reload is survivable.
 * 2. **Says which failures are the user's to fix.** A league id typo and an
 *    outage produce the same red box otherwise, and the user cannot tell
 *    whether to check what they pasted or come back later.
 * 3. **Keeps the raw message.** It is often the only clue, so it is shown
 *    rather than replaced with something reassuring and useless.
 */
interface Props {
  error: Error;
  onRetry: () => void;
  /** True while the retry is in flight, so the button cannot be double-fired. */
  retrying: boolean;
}

export function LeagueError({ error, onRetry, retrying }: Props) {
  return (
    <div
      role="alert"
      className="mt-4 rounded-xl border border-negative bg-negative-soft p-5 text-sm"
    >
      <p className="font-semibold text-negative">Couldn't load that league.</p>
      <p className="mt-1 text-negative">{error.message}</p>

      {/*
        `text-muted` rather than the negative token: the guidance is not itself
        an error, and colouring the whole panel red makes the one line that
        matters — the message above — stop standing out.
      */}
      <ul className="mt-3 space-y-1 text-muted">
        <li>Check the league id is the one in your Sleeper URL, not the draft id.</li>
        <li>A league that hasn't finished its startup draft may not be readable yet.</li>
        <li>Otherwise this is usually Sleeper being briefly unavailable.</li>
      </ul>

      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="btn-secondary mt-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        {retrying ? 'Retrying…' : 'Try again'}
      </button>
    </div>
  );
}
