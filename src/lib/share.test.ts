import { describe, expect, it } from 'vitest';
import { decodeTrade, encodeTrade, resolveShare, type SharedTrade } from './share';
import { makeLeague, makePick, makeRoster, makeSettings } from '../engine/testFixtures';

const trade = (overrides: Partial<SharedTrade> = {}): SharedTrade => ({
  leagueId: '1336802780030988288',
  teamA: 3,
  teamB: 7,
  givesA: { playerIds: ['4034'], pickIds: [] },
  givesB: { playerIds: ['11624', 'NE'], pickIds: ['2027-1-3'] },
  ...overrides,
});

describe('encodeTrade', () => {
  it('round-trips through decode', () => {
    expect(decodeTrade(encodeTrade(trade()))).toEqual(trade());
  });

  it('leaves empty sides out of the URL entirely', () => {
    const encoded = encodeTrade(trade({ givesA: { playerIds: ['4034'], pickIds: [] } }));
    expect(encoded).not.toContain('ak=');
    expect(encoded).toContain('ap=4034');
  });

  it('is stable, so an unchanged trade never rewrites the address bar', () => {
    // The URL is replaced on every edit. An unstable ordering would make it
    // churn while the trade sat still — worst in the case this exists for,
    // where two people compare links to check they are looking at the same
    // offer.
    const one = encodeTrade(trade({ givesB: { playerIds: ['b', 'a'], pickIds: [] } }));
    const two = encodeTrade(trade({ givesB: { playerIds: ['a', 'b'], pickIds: [] } }));
    expect(one).toBe(two);
  });

  it('keeps ids readable rather than percent-encoded', () => {
    // A comma comes back as %2C and turns a shareable link into an eyesore.
    const encoded = encodeTrade(trade());
    expect(encoded).toContain('bp=11624_NE');
    expect(encoded).toContain('bk=2027-1-3');
    expect(encoded).not.toContain('%');
  });
});

describe('decodeTrade', () => {
  it('reads a link with only one side sending', () => {
    const decoded = decodeTrade('?l=99&a=1&b=2&ap=4034');
    expect(decoded).toEqual({
      leagueId: '99',
      teamA: 1,
      teamB: 2,
      givesA: { playerIds: ['4034'], pickIds: [] },
      givesB: { playerIds: [], pickIds: [] },
    });
  });

  it('tolerates a leading question mark or not', () => {
    expect(decodeTrade('l=99&a=1&b=2&ap=x')).toEqual(decodeTrade('?l=99&a=1&b=2&ap=x'));
  });

  it('returns null for anything malformed rather than throwing', () => {
    // Chat clients truncate URLs at punctuation and people edit them by hand.
    // Every one of these is the same failure and the answer to all of them is
    // to open the app normally.
    expect(decodeTrade('')).toBeNull();
    expect(decodeTrade('?')).toBeNull();
    expect(decodeTrade('?l=99&a=1')).toBeNull(); // truncated
    expect(decodeTrade('?l=99&a=one&b=2&ap=x')).toBeNull(); // not a roster id
    expect(decodeTrade('?a=1&b=2&ap=x')).toBeNull(); // no league
    expect(decodeTrade('?l=99&a=1.5&b=2&ap=x')).toBeNull(); // not an integer
  });

  it('rejects a team trading with itself instead of inventing an opponent', () => {
    expect(decodeTrade('?l=99&a=4&b=4&ap=x')).toBeNull();
  });

  it('rejects a link naming two teams and no assets', () => {
    // Landing on an empty calculator with two dropdowns set reads as the app
    // having lost the link.
    expect(decodeTrade('?l=99&a=1&b=2')).toBeNull();
    expect(decodeTrade('?l=99&a=1&b=2&ap=&bp=')).toBeNull();
  });

  it('ignores a query string that is about something else', () => {
    expect(decodeTrade('?utm_source=groupchat')).toBeNull();
  });
});

describe('resolveShare', () => {
  const settings = makeSettings(['QB', 'RB']);
  const league = makeLeague(
    [makeRoster(1, ['p1', 'p2']), makeRoster(2, ['p3'])],
    settings,
  );
  const picks = [
    makePick('2027-1-1', '2027', 1, 1, 500),
    makePick('2027-1-2', '2027', 1, 2, 400),
  ];

  it('passes through a trade both rosters can still make', () => {
    const resolved = resolveShare(
      trade({ teamA: 1, teamB: 2, givesA: { playerIds: ['p1'], pickIds: ['2027-1-1'] }, givesB: { playerIds: ['p3'], pickIds: [] } }),
      league,
      picks,
    );
    expect(resolved?.dropped).toBe(0);
    expect(resolved?.trade.givesA).toEqual({ playerIds: ['p1'], pickIds: ['2027-1-1'] });
  });

  it('returns null for a roster this league does not have', () => {
    // The one failure that must be caught rather than tolerated: `buildSide`
    // throws on an unknown roster, so a hand-edited ?a=99 would take the render
    // down rather than show a slightly wrong trade.
    expect(
      resolveShare(trade({ teamA: 99, teamB: 2 }), league, picks),
    ).toBeNull();
  });

  it('drops assets the sending roster no longer holds, and counts them', () => {
    // Rosters move. A link shared on Tuesday and opened after a waiver claim
    // describes a trade that no longer exists.
    const resolved = resolveShare(
      trade({
        teamA: 1,
        teamB: 2,
        givesA: { playerIds: ['p1', 'gone'], pickIds: [] },
        givesB: { playerIds: ['p3'], pickIds: [] },
      }),
      league,
      picks,
    );
    expect(resolved?.trade.givesA.playerIds).toEqual(['p1']);
    expect(resolved?.dropped).toBe(1);
  });

  it('drops a player who is on the other team, not merely one who is unknown', () => {
    // The asset picker only ever shows a roster its own players, so an id
    // belonging to the opponent would price into the totals while appearing
    // nowhere in the two columns above them.
    const resolved = resolveShare(
      trade({
        teamA: 1,
        teamB: 2,
        givesA: { playerIds: ['p3'], pickIds: [] },
        givesB: { playerIds: ['p3'], pickIds: [] },
      }),
      league,
      picks,
    );
    expect(resolved?.trade.givesA.playerIds).toEqual([]);
    expect(resolved?.trade.givesB.playerIds).toEqual(['p3']);
    expect(resolved?.dropped).toBe(1);
  });

  it('drops a pick whose owner has changed since the link was made', () => {
    const resolved = resolveShare(
      trade({
        teamA: 1,
        teamB: 2,
        givesA: { playerIds: [], pickIds: ['2027-1-2'] }, // roster 2 owns it
        givesB: { playerIds: ['p3'], pickIds: [] },
      }),
      league,
      picks,
    );
    expect(resolved?.trade.givesA.pickIds).toEqual([]);
    expect(resolved?.dropped).toBe(1);
  });
});
