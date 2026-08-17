import { useState, type FormEvent } from 'react';
import type { League } from '../types';
import { getAccountByUsername } from '../platforms/sleeper/client';

interface Props {
  league: League;
  onClaim: (rosterId: number) => void;
}

export function ClaimTeam({ league, onClaim }: Props) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const name = username.trim();
    if (!name) return;

    setBusy(true);
    setError(null);
    try {
      const account = await getAccountByUsername(name);
      const roster = league.rosters.find((r) => r.ownerId === account.user_id);
      if (!roster) {
        setError(`"${account.display_name ?? name}" isn't in this league.`);
        return;
      }
      onClaim(roster.rosterId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3 className="font-semibold">Which team is yours?</h3>
      <p className="mt-1 text-sm text-subtle">
        Claiming your team personalizes the analysis and defaults the trade
        calculator to you. Stored in this browser only.
      </p>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-2 sm:flex-row">
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Your Sleeper username"
          autoComplete="username"
          spellCheck={false}
          aria-label="Sleeper username"
          className="min-w-0 flex-1 rounded-lg border border-control px-4 py-2.5 outline-none focus:border-accent focus:ring-2 focus:ring-accent"
        />
        <button
          type="submit"
          disabled={busy || !username.trim()}
          className="btn-primary shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Finding…' : 'Find my team'}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-2 text-sm text-negative">
          {error}
        </p>
      )}

      {/* Orphan teams and co-owned rosters can't be resolved from a username. */}
      <div className="mt-4 border-t border-line pt-4">
        <label htmlFor="claim-select" className="text-sm text-subtle">
          Or pick it from the list
        </label>
        <select
          id="claim-select"
          defaultValue=""
          onChange={(e) => e.target.value && onClaim(Number(e.target.value))}
          className="mt-2 w-full rounded-lg border border-control bg-surface px-3 py-2.5 outline-none focus:border-accent focus:ring-2 focus:ring-accent fine:py-2"
        >
          <option value="" disabled>
            Select a team…
          </option>
          {league.rosters.map((r) => (
            <option key={r.rosterId} value={r.rosterId}>
              {r.teamName}
              {r.teamName !== r.ownerName ? ` — ${r.ownerName}` : ''}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
