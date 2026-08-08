import { useState, type FormEvent } from 'react';
import { parseLeagueId } from '../platforms/sleeper/client';

interface Props {
  onSubmit: (leagueId: string) => void;
  busy?: boolean;
}

export function LeagueImport({ onSubmit, busy }: Props) {
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const id = parseLeagueId(input);
    if (!id) {
      setError("That doesn't look like a Sleeper league ID or URL.");
      return;
    }
    setError(null);
    onSubmit(id);
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <label htmlFor="league-input" className="block text-sm font-medium text-muted">
        Sleeper league ID or URL
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id="league-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="1235622229488717824"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'league-input-error' : 'league-input-hint'}
          className="min-w-0 flex-1 rounded-lg border border-control px-4 py-2.5 text-ink shadow-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent"
        />
        <button
          type="submit"
          disabled={busy}
          className="btn-primary shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Loading…' : 'Load league'}
        </button>
      </div>

      {error ? (
        <p id="league-input-error" role="alert" className="mt-2 text-sm text-fantasy-red">
          {error}
        </p>
      ) : (
        <p id="league-input-hint" className="mt-2 text-sm text-subtle">
          Open your league on Sleeper and paste the URL, or just the numeric ID.
        </p>
      )}
    </form>
  );
}
