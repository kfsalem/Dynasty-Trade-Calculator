import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AllLeagues } from './AllLeagues';
import { makeLeague, makePlayer, makeRoster, makeSettings, makeValue } from '../engine/testFixtures';
import { summarizeRoster } from '../engine/rosterValue';
import type { LeagueChoice } from '../platforms/types';
import type { League, LeagueSettings, Player, PlayerValue, Position, Roster, SeasonPhase } from '../types';

/**
 * Each league's data comes from `useLeagueSummaries`, stubbed per league id.
 *
 * The state objects are built once per test and returned as they are on every
 * render, as the real hook's memos are. A stub that built a fresh object each
 * time would make every league report a new answer on every render, which is
 * a loop the real hook does not have.
 */
const mocks = vi.hoisted(() => ({ states: {} as Record<string, unknown> }));

vi.mock('../hooks/useLeagueData', () => ({
  useLeagueSummaries: (leagueId: string) => mocks.states[leagueId] ?? { isLoading: true, summaries: [] },
}));

const ME = 'me';

interface Man {
  id: string;
  position?: Position;
  value: number;
}

/**
 * A league where the manager owns roster 1, with these players, and has set
 * `setLineup` as his starters. Roster 2 belongs to somebody else.
 */
function leagueState(
  id: string,
  men: Man[],
  setLineup: string[],
  {
    owner = ME,
    coOwners = [],
    phase = 'regular',
    settings: overrides = {},
    byes = [],
  }: {
    owner?: string;
    /** User ids managing the team beside its owner. */
    coOwners?: string[];
    phase?: SeasonPhase;
    settings?: Partial<LeagueSettings>;
    /** NFL teams on bye. Every player here is on KC. */
    byes?: string[];
  } = {},
) {
  const settings = makeSettings(['QB'], overrides);
  const mine: Roster = {
    ...makeRoster(1, men.map((m) => m.id)),
    ownerId: owner,
    coOwners: coOwners.map((id) => ({ id, name: id })),
    setLineup,
  };
  const theirs = makeRoster(2, []);
  const league: League = { ...makeLeague([mine, theirs], settings), id, name: `League ${id}` };
  const players = new Map<string, Player>(
    men.map((m) => [m.id, { ...makePlayer(m.id, m.position ?? 'QB'), team: 'KC' }]),
  );
  const values = new Map<string, PlayerValue>(
    men.map((m) => [m.id, makeValue(m.id, m.value, m.position ?? 'QB')]),
  );
  const summaries = [mine, theirs].map((r) => summarizeRoster(r, players, values, settings));

  return {
    league,
    values,
    summaries,
    wireBoard: undefined,
    byeTeams: new Set(byes),
    projected: undefined,
    lockedTeams: undefined,
    seasonPhase: phase,
    currentWeek: 11,
    activityCurrent: true,
    isLoading: false,
    weekPending: false,
    error: null,
  };
}

const choice = (id: string): LeagueChoice => ({
  leagueId: id,
  name: `League ${id}`,
  teams: 2,
  format: 'dynasty',
});

beforeEach(() => {
  mocks.states = {};
});

describe('AllLeagues (#161)', () => {
  it("adds up every league's calls and lists them under the league they belong to", async () => {
    // A: the manager is starting his worse quarterback. B: his lineup is right.
    mocks.states.a = leagueState(
      'a',
      [
        { id: 'star', value: 3000 },
        { id: 'backup', value: 1000 },
      ],
      ['backup'],
    );
    mocks.states.b = leagueState(
      'b',
      [
        { id: 'star', value: 2000 },
        { id: 'other', value: 6000 },
      ],
      ['other'],
    );
    const onOpen = vi.fn();
    render(<AllLeagues userId={ME} leagues={[choice('a'), choice('b')]} onOpen={onOpen} />);

    expect(
      await screen.findByRole('heading', { level: 2, name: '1 change to make' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 lineup move, in 1 of your 2 leagues.')).toBeInTheDocument();

    const week = screen.getByRole('region', { name: 'This week, league by league' });
    const a = within(week).getByRole('heading', { level: 4, name: 'League a' }).closest('li')!;
    expect(a).toHaveTextContent('Start');
    expect(a).toHaveTextContent('Player star');
    // B has nothing to do, so it is named once rather than given a section.
    expect(within(week).queryByRole('heading', { level: 4, name: 'League b' })).toBeNull();
    expect(week).toHaveTextContent('Nothing to change in League b.');

    await userEvent.setup().click(within(a).getByRole('button', { name: 'Open League a' }));
    expect(onOpen).toHaveBeenCalledWith('a');
  });

  it('shows each shared player as a share of every roster he is on', async () => {
    mocks.states.a = leagueState(
      'a',
      [
        { id: 'star', value: 3000 },
        { id: 'backup', value: 1000 },
      ],
      ['star'],
    );
    mocks.states.b = leagueState(
      'b',
      [
        { id: 'star', value: 2000 },
        { id: 'other', value: 6000 },
      ],
      ['other'],
    );
    render(<AllLeagues userId={ME} leagues={[choice('a'), choice('b')]} onOpen={vi.fn()} />);

    const card = await screen.findByRole('region', { name: 'On more than one roster' });
    const rows = within(card).getAllByRole('listitem').filter((li) => li.textContent?.includes('leagues'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('Player star');
    expect(rows[0]).toHaveTextContent('In 2 of 2 leagues');
    // 3000 of 4000 in League a, 2000 of 8000 in League b.
    expect(rows[0]).toHaveTextContent('League a75%');
    expect(rows[0]).toHaveTextContent('League b25%');
  });

  it('names the five heaviest leagues on a shared player and sums up the rest', async () => {
    // The same man in seven leagues, a smaller share of each one down the list.
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    ids.forEach((id, i) => {
      mocks.states[id] = leagueState(
        id,
        [
          { id: 'star', value: 1000 },
          { id: `rest-${id}`, value: 1000 + 500 * i },
        ],
        ['star'],
      );
    });
    render(<AllLeagues userId={ME} leagues={ids.map(choice)} onOpen={vi.fn()} />);

    const card = await screen.findByRole('region', { name: 'On more than one roster' });
    const row = within(card).getByText('Player star').closest('li')!;
    expect(row).toHaveTextContent('In 7 of 7 leagues');
    expect(row).toHaveTextContent('League e');
    expect(row).not.toHaveTextContent('League f');
    // 1000 of 4500 and 1000 of 5000.
    expect(row).toHaveTextContent('2 more leagues20%–22% each');
  });

  it('waits for every league before giving a verdict', async () => {
    mocks.states.a = leagueState('a', [{ id: 'star', value: 3000 }], ['star']);
    // League b is still loading: the stub's default.
    render(<AllLeagues userId={ME} leagues={[choice('a'), choice('b')]} onOpen={vi.fn()} />);

    expect(await screen.findByText('1 of 2 loaded')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Checking your leagues' })).toBeInTheDocument();
    expect(screen.queryByText(/Every lineup is set/)).toBeNull();
  });

  it('owns up to a league where his team was not found, with a way to go and look', async () => {
    mocks.states.a = leagueState('a', [{ id: 'star', value: 3000 }], ['star']);
    mocks.states.b = leagueState('b', [{ id: 'other', value: 3000 }], ['other'], {
      owner: 'somebody-else',
    });
    const onOpen = vi.fn();
    render(<AllLeagues userId={ME} leagues={[choice('a'), choice('b')]} onOpen={onOpen} />);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Every lineup is set' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/One league couldn't be checked/)).toBeInTheDocument();
    expect(screen.getByText(/Your team in League b wasn't found/)).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Open League b' }));
    expect(onOpen).toHaveBeenCalledWith('b');
  });

  it('checks a league where he is a co-owner of the team, not its owner', async () => {
    mocks.states.a = leagueState('a', [{ id: 'star', value: 3000 }], ['star']);
    mocks.states.b = leagueState(
      'b',
      [
        { id: 'star', value: 3000 },
        { id: 'backup', value: 1000 },
      ],
      ['backup'],
      { owner: 'somebody-else', coOwners: [ME] },
    );
    render(<AllLeagues userId={ME} leagues={[choice('a'), choice('b')]} onOpen={vi.fn()} />);

    expect(
      await screen.findByRole('heading', { level: 2, name: '1 change to make' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/wasn't found/)).toBeNull();
  });

  it('says a best-ball league has no lineup to set rather than checking one', async () => {
    mocks.states.a = leagueState(
      'a',
      [
        { id: 'star', value: 3000 },
        { id: 'backup', value: 1000 },
      ],
      ['backup'],
      { settings: { bestBall: true } },
    );
    mocks.states.b = leagueState('b', [{ id: 'other', value: 3000 }], ['other']);
    render(<AllLeagues userId={ME} leagues={[choice('a'), choice('b')]} onOpen={vi.fn()} />);

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Every lineup is set' }),
    ).toBeInTheDocument();
    expect(screen.getByText('League a is best ball, so there is no lineup to set.')).toBeInTheDocument();
  });

  it('makes no calls for an empty roster, which is what a chopped guillotine team has', async () => {
    mocks.states.a = leagueState('a', [], []);
    mocks.states.b = leagueState('b', [{ id: 'other', value: 3000 }], ['other']);
    render(<AllLeagues userId={ME} leagues={[choice('a'), choice('b')]} onOpen={vi.fn()} />);

    // Without the rule, the empty QB slot was a change to make.
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Every lineup is set' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Your roster in League a is empty, so there is no lineup to set/)).toBeInTheDocument();
  });

  it('does not call a lineup set when a slot is empty and nothing can fill it', async () => {
    // His only quarterback is on bye, and the wire is empty.
    mocks.states.a = leagueState('a', [{ id: 'star', value: 3000 }], ['star'], { byes: ['KC'] });
    mocks.states.b = leagueState('b', [{ id: 'other', value: 3000 }], ['other']);
    render(<AllLeagues userId={ME} leagues={[choice('a'), choice('b')]} onOpen={vi.fn()} />);

    expect(
      await screen.findByRole('heading', { level: 2, name: '1 slot nobody can fill' }),
    ).toBeInTheDocument();
    const week = screen.getByRole('region', { name: 'This week, league by league' });
    expect(within(week).getByRole('heading', { level: 4, name: 'League a' })).toBeInTheDocument();
    expect(week).toHaveTextContent('Nobody on your roster can fill this slot');
    expect(screen.getByText('Lineup moves').nextElementSibling).toHaveTextContent('0');
  });

  it('out of season, answers with what the rosters share and offers no week', async () => {
    mocks.states.a = leagueState(
      'a',
      [
        { id: 'star', value: 3000 },
        { id: 'backup', value: 1000 },
      ],
      ['backup'],
      { phase: 'off' },
    );
    mocks.states.b = leagueState('b', [{ id: 'star', value: 2000 }], ['star'], { phase: 'off' });
    render(<AllLeagues userId={ME} leagues={[choice('a'), choice('b')]} onOpen={vi.fn()} />);

    expect(
      await screen.findByRole('heading', { level: 2, name: '1 player on more than one roster' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'This week, league by league' })).toBeNull();
    expect(screen.queryByText('Lineup moves')).toBeNull();
  });
});
