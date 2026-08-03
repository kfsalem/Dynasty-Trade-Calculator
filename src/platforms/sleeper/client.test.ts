import { describe, expect, it } from 'vitest';
import { parseLeagueId } from './client';

/**
 * The app's only input-validation surface: everything a stranger types goes
 * through here, and §7 of the design doc commits to accepting "a raw ID, a
 * Sleeper URL, or a username".
 */
describe('parseLeagueId', () => {
  it('accepts a bare league id', () => {
    expect(parseLeagueId('1336802780030988288')).toBe('1336802780030988288');
  });

  it('tolerates the whitespace that comes with a paste', () => {
    expect(parseLeagueId('  1336802780030988288 ')).toBe('1336802780030988288');
  });

  it('pulls the id out of a league URL', () => {
    expect(parseLeagueId('https://sleeper.com/leagues/1336802780030988288')).toBe(
      '1336802780030988288',
    );
  });

  it('pulls the id out of a deep link to a tab within the league', () => {
    expect(parseLeagueId('https://sleeper.com/leagues/1336802780030988288/team')).toBe(
      '1336802780030988288',
    );
  });

  it('reads a draft URL too, since that is a link people actually have', () => {
    expect(parseLeagueId('https://sleeper.com/draft/nfl/1336802780030988288')).toBe(
      '1336802780030988288',
    );
  });

  it('rejects anything without an id in it', () => {
    expect(parseLeagueId('')).toBeNull();
    expect(parseLeagueId('   ')).toBeNull();
    expect(parseLeagueId('my dynasty league')).toBeNull();
    expect(parseLeagueId('https://sleeper.com/')).toBeNull();
  });

  it('rejects a number too short to be a league id', () => {
    // Six digits is the floor. A stray year or jersey number is not a league.
    expect(parseLeagueId('2026')).toBeNull();
    expect(parseLeagueId('12345')).toBeNull();
    expect(parseLeagueId('123456')).toBe('123456');
  });
});
