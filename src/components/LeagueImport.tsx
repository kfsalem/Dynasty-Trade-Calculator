import { useState, type FormEvent } from 'react';
import { parseLeagueId } from '../platforms/sleeper/client';
import { sleeperProvider } from '../platforms/sleeper';
import type { LeagueChoice, LeagueSearch } from '../platforms/types';

interface Props {
  /**
   * Load this league. `claimUserId` is set when the league was picked from a
   * username's list: the app then knows whose team is whose and can claim it.
   */
  onSubmit: (leagueId: string, claimUserId?: string) => void;
  busy?: boolean;
}

/** The last username looked up, so the list is one tap away next time (#160). */
const USERNAME_KEY = 'dynasty:sleeperUsername';

function readUsername(): string | null {
  try {
    return localStorage.getItem(USERNAME_KEY);
  } catch {
    return null;
  }
}

function writeUsername(name: string | null) {
  try {
    if (name === null) localStorage.removeItem(USERNAME_KEY);
    else localStorage.setItem(USERNAME_KEY, name);
  } catch {
    // Storage disabled — the name just won't be remembered.
  }
}

/**
 * A username, as opposed to a mistyped id or URL. Sleeper usernames are a
 * single word; anything with a space or a slash in it was meant as something
 * else, and is better answered with the format error than with a lookup.
 */
const looksLikeUsername = (input: string) => /^[^\s/]{2,40}$/.test(input);

const FORMAT_LABEL: Record<NonNullable<LeagueChoice['format']>, string> = {
  dynasty: 'Dynasty',
  keeper: 'Keeper',
  redraft: 'Redraft',
};

function describe(choice: LeagueChoice): string {
  return [
    choice.teams ? `${choice.teams} teams` : null,
    choice.format ? FORMAT_LABEL[choice.format] : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function LeagueImport({ onSubmit, busy }: Props) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<LeagueSearch | null>(null);
  const [remembered, setRemembered] = useState<string | null>(readUsername);

  async function search(username: string) {
    if (!sleeperProvider.findLeagues) return;
    setSearching(true);
    setError(null);
    setFound(null);
    try {
      const result = await sleeperProvider.findLeagues(username);
      writeUsername(username);
      setRemembered(username);
      if (result.leagues.length === 0) {
        setError(`${result.displayName} has no NFL leagues on Sleeper for ${result.season}.`);
        return;
      }
      setFound(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That lookup failed. Try again.');
    } finally {
      setSearching(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = input.trim();
    const id = parseLeagueId(text);
    if (id) {
      setError(null);
      onSubmit(id);
      return;
    }
    if (looksLikeUsername(text)) {
      void search(text);
      return;
    }
    setError("That doesn't look like a Sleeper username, league ID or URL.");
  }

  function forget() {
    writeUsername(null);
    setRemembered(null);
    setFound(null);
  }

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit}>
        <label htmlFor="league-input" className="block text-sm font-medium text-muted">
          Sleeper username, or a league ID or URL
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            id="league-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Your Sleeper username"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'league-input-error' : 'league-input-hint'}
            className="min-w-0 flex-1 rounded-lg border border-control px-4 py-2.5 text-ink shadow-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent"
          />
          <button
            type="submit"
            disabled={busy || searching}
            className="btn-primary shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Loading…' : searching ? 'Finding…' : 'Find my league'}
          </button>
        </div>

        {error ? (
          <p id="league-input-error" role="alert" className="mt-2 text-sm text-negative">
            {error}
          </p>
        ) : (
          <p id="league-input-hint" className="mt-2 text-sm text-subtle">
            A username lists your leagues. A league URL from Sleeper, or its numeric ID,
            opens that league directly.
          </p>
        )}
      </form>

      {!found && remembered && !searching && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 text-sm">
          <button
            type="button"
            onClick={() => void search(remembered)}
            className="inline-flex min-h-11 items-center font-medium text-accent fine:min-h-8"
          >
            Show leagues for {remembered}
          </button>
          <button
            type="button"
            onClick={forget}
            className="inline-flex min-h-11 items-center text-subtle fine:min-h-8"
          >
            Forget
          </button>
        </div>
      )}

      {found && (
        <section aria-label={`Leagues for ${found.displayName}`} className="mt-4 rise-in">
          <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
            {found.displayName}'s leagues · {found.season}
          </p>
          <ul className="mt-2 space-y-2">
            {found.leagues.map((choice) => (
              <li key={choice.leagueId}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onSubmit(choice.leagueId, found.userId)}
                  className="flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-line bg-raised px-4 py-3 text-left hover:border-accent disabled:cursor-not-allowed disabled:opacity-50 fine:py-2"
                >
                  <span className="min-w-0 truncate font-medium text-ink">{choice.name}</span>
                  <span className="shrink-0 text-sm text-subtle">{describe(choice)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
