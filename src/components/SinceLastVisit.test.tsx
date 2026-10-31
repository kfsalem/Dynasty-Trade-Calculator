import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SinceLastVisit } from './SinceLastVisit';
import { useSinceLastVisit } from '../hooks/useSinceLastVisit';
import {
  readVisit,
  visitKey,
  writeVisit,
  type VisitChange,
  type VisitSnapshot,
} from '../engine/sinceLastVisit';
import {
  makeLeague,
  makePlayer,
  makeRoster,
  makeSettings,
  makeValue,
} from '../engine/testFixtures';
import { summarizeRoster } from '../engine/rosterValue';
import type { Player, PlayerValue } from '../types';

afterEach(() => localStorage.clear());

const change = (over: Partial<VisitChange> = {}): VisitChange => ({
  kind: 'value',
  key: 'value:a',
  playerId: 'a',
  text: "Player a's value rose 20%, 4,000 to 4,800.",
  direction: 'up',
  ...over,
});

describe('SinceLastVisit', () => {
  it('leads with what moved, dated, each line signed as well as coloured', () => {
    render(
      <SinceLastVisit
        changes={[change(), change({ key: 'grade:now', text: 'Your win-now rank went from 5th to 8th of 12.', direction: 'down' })]}
        since="2026-10-24T12:00:00.000Z"
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByRole('heading', { name: /Since your last visit, Oct 24/ })).toBeInTheDocument();
    expect(screen.getByText(/rose 20%/)).toBeInTheDocument();
    expect(screen.getByText('▲')).toBeInTheDocument();
    expect(screen.getByText('▼')).toBeInTheDocument();
  });

  it('is not there at all when nothing changed', () => {
    const { container } = render(<SinceLastVisit changes={[]} since={null} onDismiss={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('can be dismissed', async () => {
    const onDismiss = vi.fn();
    render(<SinceLastVisit changes={[change()]} since={null} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe('the stored snapshot', () => {
  const snap: VisitSnapshot = {
    version: 1,
    at: '2026-10-24T12:00:00.000Z',
    rosterId: 1,
    players: { a: { market: 4000, role: 'starter' } },
    nowRank: 1,
    laterRank: 1,
    teamCount: 2,
  };

  it('round-trips per league', () => {
    writeVisit('L1', snap);
    expect(readVisit('L1')).toEqual(snap);
    expect(readVisit('L2')).toBeNull();
  });

  it('ignores a snapshot it cannot read', () => {
    localStorage.setItem(visitKey('L1'), '{not json');
    expect(readVisit('L1')).toBeNull();
    localStorage.setItem(visitKey('L1'), JSON.stringify({ version: 2 }));
    expect(readVisit('L1')).toBeNull();
  });
});

describe('useSinceLastVisit', () => {
  const settings = makeSettings(['QB', 'RB'], { teamCount: 2 });
  const league = makeLeague([makeRoster(1, ['a', 'b']), makeRoster(2, ['c', 'd'])], settings);
  const players = new Map<string, Player>(
    (['a', 'b', 'c', 'd'] as const).map((id, i) => [id, makePlayer(id, i % 2 ? 'RB' : 'QB')]),
  );
  const valued = (a: number) =>
    new Map<string, PlayerValue>([
      ['a', makeValue('a', a, 'QB')],
      ['b', makeValue('b', 1500, 'RB')],
      ['c', makeValue('c', 3000, 'QB')],
      ['d', makeValue('d', 1500, 'RB')],
    ]);
  const input = (leagueId: string, a: number, active = true) => {
    const values = valued(a);
    return {
      leagueId,
      myRosterId: 1,
      active,
      league,
      players,
      values,
      summaries: league.rosters.map((r) => summarizeRoster(r, players, values, settings)),
      roles: undefined,
      season: undefined,
    };
  };

  it('shows nothing on a first visit, but remembers it for the next', () => {
    const { result } = renderHook(() => useSinceLastVisit(input('L1', 4000)));
    expect(result.current.changes).toEqual([]);
    expect(readVisit('L1')?.players.a.market).toBe(4000);
  });

  it('shows what moved since, once, and then remembers the new values', () => {
    renderHook(() => useSinceLastVisit(input('L1', 4000))).unmount();
    const first = readVisit('L1')?.at;

    const { result } = renderHook(() => useSinceLastVisit(input('L1', 5000)));
    expect(result.current.changes.map((c) => c.key)).toEqual(['value:a']);
    // Dated by the visit it compares against, not this one.
    expect(result.current.since).toBe(first);
    expect(readVisit('L1')?.players.a.market).toBe(5000);

    // A reload straight after has nothing new to say.
    const again = renderHook(() => useSinceLastVisit(input('L1', 5000)));
    expect(again.result.current.changes).toEqual([]);
  });

  it('takes nothing while My team is not on screen', () => {
    renderHook(() => useSinceLastVisit(input('L1', 4000, false)));
    expect(readVisit('L1')).toBeNull();
  });

  it('never remembers the sample league', () => {
    renderHook(() => useSinceLastVisit(input('sample', 4000)));
    expect(readVisit('sample')).toBeNull();
  });
});
