import { describe, expect, it } from 'vitest';
import { byeTeams, onBye } from './byes';
import type { ByeWeeksFile } from '../data/types';

const file = (season: number, teams: Record<string, number>): ByeWeeksFile => ({
  generatedAt: '2026-08-27T00:00:00.000Z',
  season,
  throughWeek: 18,
  source: 'test',
  teams,
});

const week11 = file(2026, { LAR: 11, GB: 11, NE: 11, KC: 5 });

describe('byeTeams', () => {
  it('names the teams off in the week asked about', () => {
    expect(byeTeams(week11, 2026, 11)).toEqual(new Set(['LAR', 'GB', 'NE']));
    expect(byeTeams(week11, 2026, 5)).toEqual(new Set(['KC']));
  });

  /*
    The distinction the whole module exists for. A third of a real season has no
    byes in it — 2026 has none in weeks 1-4, 12, or 15-18 — so "nobody is off"
    has to be sayable as data rather than as an absence of data.
  */
  it('returns an empty set, not null, for a week nobody is off', () => {
    expect(byeTeams(week11, 2026, 12)).toEqual(new Set());
    expect(byeTeams(week11, 2026, 12)).not.toBeNull();
  });

  it('makes no claim when the file describes another season', () => {
    // The schedule is published in May, so through the spring this file is next
    // year's while the app is still looking at last year's rosters. Byes move
    // every season, so applying it would bench a healthy starter.
    expect(byeTeams(week11, 2025, 11)).toBeNull();
  });

  it('makes no claim without a file, a week, or a season', () => {
    expect(byeTeams(null, 2026, 11)).toBeNull();
    expect(byeTeams(undefined, 2026, 11)).toBeNull();
    expect(byeTeams(week11, 2026, null)).toBeNull();
    expect(byeTeams(week11, null, 11)).toBeNull();
  });
});

describe('onBye', () => {
  it('is true only for a team in the set', () => {
    const off = new Set(['LAR']);
    expect(onBye('LAR', off)).toBe(true);
    expect(onBye('SF', off)).toBe(false);
  });

  /*
    A rostered free agent has no team. He is not playing, but not because of a
    bye, and this app writes sentences about causes — "on bye" would be a false
    one.
  */
  it('is false for a player with no team', () => {
    expect(onBye(null, new Set(['LAR']))).toBe(false);
  });
});
