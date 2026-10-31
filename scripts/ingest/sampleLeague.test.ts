import { describe, expect, it } from 'vitest';
import { anonymise, leaks } from './sampleLeague';

const league = (id: string, previous: string | null, season: string) => ({
  league_id: id,
  previous_league_id: previous,
  name: 'The Real Name League',
  season,
  status: 'in_season',
  avatar: 'real-avatar-hash',
  total_rosters: 2,
  roster_positions: ['QB', 'BN'],
  settings: { num_teams: 2, type: 2 },
  draft_id: '999000111222333444',
});

const users = [
  {
    user_id: '700000000000000001',
    display_name: 'alice_real',
    avatar: 'alice-avatar',
    metadata: { team_name: "Alice's Aces", mention_pn: 'on' },
  },
  { user_id: '700000000000000002', display_name: 'bob_real', avatar: null, metadata: {} },
];

const rosters = [
  { roster_id: 2, owner_id: '700000000000000001', players: ['4046'], co_owners: ['700000000000000002'] },
  { roster_id: 1, owner_id: '700000000000000002', players: ['6794'] },
];

function recording() {
  return new Map<string, unknown>([
    ['/league/111111111111111111', league('111111111111111111', '222222222222222222', '2026')],
    ['/league/111111111111111111/users', users],
    ['/league/111111111111111111/rosters', rosters],
    [
      '/league/111111111111111111/drafts',
      [{ draft_id: '555555555555555555', season: '2026', status: 'complete', type: 'linear' }],
    ],
    [
      '/draft/555555555555555555',
      { draft_id: '555555555555555555', season: '2026', status: 'complete', type: 'linear' },
    ],
    [
      '/league/111111111111111111/transactions/1',
      [
        {
          transaction_id: '888888888888888888',
          type: 'trade',
          status: 'complete',
          creator: '700000000000000001',
          roster_ids: [1, 2],
          metadata: { notes: 'alice_real sent this' },
        },
      ],
    ],
    ['/league/111111111111111111/matchups/1', [{ roster_id: 1, matchup_id: 1, points: 100 }]],
    ['/league/222222222222222222', league('222222222222222222', '0', '2025')],
    ['/league/222222222222222222/users', users],
    ['/league/222222222222222222/rosters', rosters],
    // Not in the chain: must not ride along.
    ['/league/333333333333333333', league('333333333333333333', null, '2026')],
  ]);
}

describe('anonymise', () => {
  const { file, secrets } = anonymise('111111111111111111', recording(), '2026-10-31T00:00:00Z');
  type Row = Record<string, unknown>;
  const r = file.responses as Record<string, Row & Row[]>;

  it('renames the season chain sample, sample-1, … and links it', () => {
    expect(r['/league/sample'].league_id).toBe('sample');
    expect(r['/league/sample'].previous_league_id).toBe('sample-1');
    expect(r['/league/sample-1'].previous_league_id).toBeNull();
    expect(r['/league/sample'].name).toBe('Sample League');
    expect(file.season).toBe('2026');
  });

  it('drops a league outside the chain', () => {
    expect(Object.keys(r).some((path) => path.includes('333333'))).toBe(false);
    expect(Object.keys(r)).toHaveLength(recording().size - 1);
  });

  it('numbers managers by current roster, the same in every season', () => {
    const byRoster = (path: string) =>
      Object.fromEntries(r[path].map((x) => [x.roster_id, x.owner_id]));
    expect(byRoster('/league/sample/rosters')).toEqual({ 1: 'sample-user-1', 2: 'sample-user-2' });
    expect(byRoster('/league/sample-1/rosters')).toEqual(byRoster('/league/sample/rosters'));
    const bob = r['/league/sample/users'].find((u) => u.user_id === 'sample-user-1');
    expect(bob).toEqual({
      user_id: 'sample-user-1',
      display_name: 'Manager 1',
      avatar: null,
      metadata: { team_name: 'Harbor Lights' },
    });
  });

  it('rewrites draft and transaction ids and the trade creator', () => {
    expect(r['/league/sample/drafts'][0].draft_id).toBe('sample-draft-1');
    expect(r['/draft/sample-draft-1'].draft_id).toBe('sample-draft-1');
    const trade = r['/league/sample/transactions/1'][0];
    expect(trade.transaction_id).toBe('sample-tx-1');
    expect(trade.creator).toBe('sample-user-2');
  });

  it('keeps nothing that names a real manager or league', () => {
    expect(leaks(file, secrets)).toEqual([]);
    const text = JSON.stringify(file);
    for (const real of ['alice', 'bob_real', 'Real Name', 'avatar-hash', 'co_owners', 'notes', '999000']) {
      expect(text).not.toContain(real);
    }
  });
});

describe('leaks', () => {
  it('finds an original value that survived, whatever its case', () => {
    const file = { generatedAt: '', season: '2026', responses: { '/x': { name: 'Alice_Real' } } };
    expect(leaks(file, ['alice_real', 'bob_real'])).toEqual(['alice_real']);
  });

  it('ignores names too short to mean anything', () => {
    const file = { generatedAt: '', season: '2026', responses: { '/x': ['QB'] } };
    expect(leaks(file, ['qb'])).toEqual([]);
  });
});
