import { describe, expect, it } from 'vitest';
import { managersOf, ownsRoster, whoIsMe } from './owners';
import { makeRoster } from './testFixtures';
import type { Roster } from '../types';

const shared: Roster = {
  ...makeRoster(5, []),
  ownerId: 'owner',
  ownerName: 'Owner',
  coOwners: [
    { id: 'co-a', name: 'Co A' },
    { id: 'co-b', name: 'Co B' },
  ],
};
const alone: Roster = { ...makeRoster(1, []), ownerId: 'solo', ownerName: 'Solo' };
const orphan: Roster = { ...makeRoster(2, []), ownerId: null, ownerName: 'Orphan team' };

describe('ownsRoster', () => {
  it('counts a co-owner as one of the team’s managers', () => {
    expect(ownsRoster(shared, 'owner')).toBe(true);
    expect(ownsRoster(shared, 'co-b')).toBe(true);
    expect(ownsRoster(shared, 'stranger')).toBe(false);
  });
});

describe('managersOf', () => {
  it('lists the owner first, then the co-owners', () => {
    expect(managersOf(shared).map((m) => m.id)).toEqual(['owner', 'co-a', 'co-b']);
  });

  it('lists nobody for an orphan team', () => {
    expect(managersOf(orphan)).toEqual([]);
  });
});

describe('whoIsMe', () => {
  it('takes a user it was told, while he manages the team', () => {
    expect(whoIsMe(shared, 'co-a')).toBe('co-a');
  });

  it('does not take a user who no longer manages the team', () => {
    expect(whoIsMe(alone, 'co-a')).toBe('solo');
    expect(whoIsMe(shared, 'stranger')).toBeNull();
  });

  it('takes the only manager without being told', () => {
    expect(whoIsMe(alone, null)).toBe('solo');
  });

  it('will not guess between several managers', () => {
    expect(whoIsMe(shared, null)).toBeNull();
  });

  it('has nobody for an orphan team', () => {
    expect(whoIsMe(orphan, null)).toBeNull();
  });
});
