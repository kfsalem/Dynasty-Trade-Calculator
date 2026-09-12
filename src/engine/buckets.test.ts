import { describe, expect, it } from 'vitest';
import { futureLineup, leagueDemand } from './analysis';
import { bucketOf, bucketRoster, type BucketInputs } from './buckets';
import type { PlayerRole } from './role';
import { summarizeRoster, type RosterSummary } from './rosterValue';
import type { DraftPick, LineupSlot, Player, PlayerValue, Position, Roster } from '../types';
import { makePlayer, makeRoster, makeSettings, makeValue } from './testFixtures';

const SLOTS: LineupSlot[] = ['QB', 'RB', 'WR'];
const settings = makeSettings(SLOTS, { teamCount: 2 });

type Spec = {
  id: string;
  position: Position;
  value: number;
  age?: number;
  yearsExp?: number;
};

/**
 * One roster under test, plus a rival to give `wouldStartOn` something to
 * measure against.
 *
 * The rival's starters set the bar a player has to clear to be worth anything
 * to anybody — without a second team in the league, every player would read as
 * dead weight and the decomposition would say nothing.
 */
function inputs(mine: Spec[], rival: Spec[], extra: Partial<BucketInputs> = {}): BucketInputs {
  const players = new Map<string, Player>();
  const values = new Map<string, PlayerValue>();
  const rosters: Roster[] = [];

  [mine, rival].forEach((squad, t) => {
    const ids = squad.map((spec) => {
      players.set(spec.id, {
        ...makePlayer(spec.id, spec.position, spec.age ?? 25),
        yearsExp: spec.yearsExp ?? 5,
      });
      values.set(spec.id, makeValue(spec.id, spec.value));
      return spec.id;
    });
    rosters.push(makeRoster(t + 1, ids));
  });

  const summaries: RosterSummary[] = rosters.map((r) =>
    summarizeRoster(r, players, values, settings),
  );

  return {
    summary: summaries[0],
    futureStarterIds: new Set(
      futureLineup(summaries[0], settings)
        .map((slot) => slot.entry?.player.id)
        .filter((id): id is string => Boolean(id)),
    ),
    demand: leagueDemand(summaries),
    picks: [],
    ...extra,
  };
}

const bucketFor = (id: string, ctx: BucketInputs) =>
  bucketOf(
    ctx.summary.players.find((e) => e.player.id === id)!,
    ctx,
  );

describe('bucketOf, and the precedence it rests on', () => {
  it('calls a young starter core rather than a lottery ticket', () => {
    // A rookie already starting has established a role. The fact that he did it
    // in year one is the opposite of a reason to call him speculative.
    const ctx = inputs(
      [{ id: 'rookie_qb', position: 'QB', value: 3000, age: 22, yearsExp: 0 }],
      [{ id: 'r_qb', position: 'QB', value: 1000 }],
    );

    expect(bucketFor('rookie_qb', ctx)).toBe('core');
  });

  it('calls a benched prospect a lottery ticket, not dead weight', () => {
    // The ordering that matters most: nobody would start him, and that is the
    // entire point of holding him. Calling him dead weight inverts the advice.
    const ctx = inputs(
      [
        { id: 'qb', position: 'QB', value: 3000 },
        { id: 'prospect', position: 'QB', value: 400, age: 22, yearsExp: 1 },
      ],
      [{ id: 'r_qb', position: 'QB', value: 2000 }],
    );

    expect(bucketFor('prospect', ctx)).toBe('lottery');
  });

  it('calls a veteran nobody would start dead weight', () => {
    const ctx = inputs(
      [
        { id: 'qb', position: 'QB', value: 3000 },
        { id: 'washed', position: 'QB', value: 400, age: 30, yearsExp: 9 },
      ],
      [{ id: 'r_qb', position: 'QB', value: 2000 }],
    );

    expect(bucketFor('washed', ctx)).toBe('dead');
  });

  it('calls an aging starter depreciating, though he is also still core', () => {
    // He satisfies both tests. Depreciating wins, because "he starts for you and
    // his price is falling" is the sentence worth acting on.
    const ctx = inputs(
      [{ id: 'old_rb', position: 'RB', value: 3000, age: 30, yearsExp: 9 }],
      [{ id: 'r_rb', position: 'RB', value: 1000 }],
    );

    expect(bucketFor('old_rb', ctx)).toBe('depreciating');
  });

  it('names the remainder rather than forcing it into one of the four', () => {
    // Would start for the rival, not old, not a prospect, not in the best
    // eleven here. None of the issue's four tests describe him.
    const ctx = inputs(
      [
        { id: 'wr1', position: 'WR', value: 3000 },
        { id: 'wr2', position: 'WR', value: 2500, age: 26, yearsExp: 5 },
      ],
      [{ id: 'r_wr', position: 'WR', value: 900 }],
    );

    expect(bucketFor('wr2', ctx)).toBe('depth');
  });

  it('trusts a measured role over the bench when one is available', () => {
    const roles = new Map<string, PlayerRole>([
      ['young', { role: 'starter', share: 0.8, chart: null, disagreement: null }],
    ]);
    const squad: Spec[] = [
      { id: 'wr1', position: 'WR', value: 3000 },
      { id: 'young', position: 'WR', value: 2000, age: 22, yearsExp: 1 },
    ];
    const rival: Spec[] = [{ id: 'r_wr', position: 'WR', value: 900 }];

    // Benched here, but playing 80% of snaps — he has established what he is.
    expect(bucketFor('young', inputs(squad, rival, { roles }))).toBe('depth');
    // Without the role data, the bench is all there is to go on.
    expect(bucketFor('young', inputs(squad, rival))).toBe('lottery');
  });
});

describe('bucketRoster', () => {
  it('counts picks as lottery and leaves kickers out altogether', () => {
    const pick: DraftPick = {
      id: '2027-1-1',
      season: '2027',
      round: 1,
      originalRosterId: 1,
      ownerRosterId: 1,
      value: 800,
      marketValue: 800,
      slot: null,
      slotKnown: false,
      label: '2027 1st',
    };

    const ctx = inputs(
      [
        { id: 'qb', position: 'QB', value: 3000 },
        { id: 'k', position: 'K', value: 50 },
      ],
      [{ id: 'r_qb', position: 'QB', value: 1000 }],
      { picks: [pick] },
    );

    const out = bucketRoster(ctx);

    expect(out.assets.map((a) => a.id).sort()).toEqual(['2027-1-1', 'qb']);
    expect(out.count.lottery).toBe(1);
    expect(out.value.lottery).toBe(800);
    // The kicker is absent, not bucketed — he would otherwise be dead weight in
    // every league that starts one, and say nothing about the roster.
    expect(out.assets.some((a) => a.id === 'k')).toBe(false);
  });

  it('puts every counted asset in exactly one bucket', () => {
    const ctx = inputs(
      [
        { id: 'qb', position: 'QB', value: 3000 },
        { id: 'rb_old', position: 'RB', value: 2000, age: 30 },
        { id: 'wr_young', position: 'WR', value: 900, age: 22, yearsExp: 1 },
        { id: 'wr_spare', position: 'WR', value: 100, age: 29, yearsExp: 8 },
      ],
      [
        { id: 'r_qb', position: 'QB', value: 1000 },
        { id: 'r_rb', position: 'RB', value: 1000 },
        { id: 'r_wr', position: 'WR', value: 1000 },
      ],
    );

    const out = bucketRoster(ctx);

    expect(out.assets).toHaveLength(4);
    expect(Object.values(out.count).reduce((a, b) => a + b, 0)).toBe(4);
    expect(out.total).toBe(3000 + 2000 + 900 + 100);
  });
});
