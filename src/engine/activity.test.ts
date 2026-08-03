import { describe, expect, it } from 'vitest';
import {
  summarize,
  FINAL_REGULAR_WEEK,
  RECENT_WEEKS,
  MATERIAL_DELTA,
  type Sample,
} from './activity';

/**
 * `summarize` is the shared core of every weekly signal — snap share, target
 * share, carry share, WOPR. Its own docstring records two bugs that reached
 * production through it, and until now it was only ever exercised through its
 * callers.
 */

/** Weeks 1..n at a constant value, for building a baseline to perturb. */
const flat = (weeks: number, value: number): Sample[] =>
  Array.from({ length: weeks }, (_, i) => ({ week: i + 1, value }));

const at = (samples: Sample[], week: number, value: number | null): Sample[] =>
  samples.map((s) => (s.week === week ? { week, value } : s));

describe('summarize — windows', () => {
  it('returns null for a player with no recorded week', () => {
    expect(summarize([], 10)).toBeNull();
    expect(summarize([{ week: 1, value: null }], 10)).toBeNull();
  });

  it('splits the season into two windows that share no game', () => {
    // Weeks 1-10 at 40%, weeks 11-14 at 80%, asked at week 14.
    const samples = [...flat(10, 0.4), ...[11, 12, 13, 14].map((week) => ({ week, value: 0.8 }))];
    const w = summarize(samples, 14)!;

    expect(w.recentGames).toBe(RECENT_WEEKS);
    expect(w.priorGames).toBe(10);
    expect(w.recent).toBeCloseTo(0.8);
    expect(w.prior).toBeCloseTo(0.4);
    // The whole point: prior excludes the recent window, so the move is full size.
    expect(w.delta).toBeCloseTo(0.4);
  });

  /**
   * The bug that made every delta 28% too small.
   *
   * `delta` used to measure against the season mean, which *contains* the recent
   * window — comparing a period against a set it belongs to. It also made the
   * "up from X%" the UI prints a blend the player never had.
   */
  it('measures delta against prior, never against the season mean', () => {
    const samples = [...flat(13, 0.636), ...[14, 15, 16, 17].map((week) => ({ week, value: 0.76 }))];
    const w = summarize(samples, 17)!;

    expect(w.prior).toBeCloseTo(0.636, 3);
    expect(w.delta).toBeCloseTo(0.76 - 0.636, 3);

    // The season mean sits between the two windows, so measuring against it
    // would report a materially smaller move.
    expect(w.season).toBeGreaterThan(w.prior!);
    expect(w.season).toBeLessThan(w.recent!);
    expect(w.delta!).toBeGreaterThan(w.recent! - w.season);
  });

  it('reports season across every week that has a value', () => {
    const w = summarize(flat(8, 0.5), 8)!;
    expect(w.season).toBeCloseTo(0.5);
    expect(w.games).toBe(8);
  });

  it('leaves missing weeks out of the average rather than counting them as zero', () => {
    // A bye or an inactive week is no data, not a 0% role. Averaging it in
    // would punish every player who missed time.
    const w = summarize(at(flat(6, 0.6), 3, null), 6)!;
    expect(w.season).toBeCloseTo(0.6);
    expect(w.games).toBe(5);
  });

  it('gives no delta before there is anything behind the window', () => {
    // You cannot measure a change in role in week 3.
    const w = summarize(flat(3, 0.5), 3)!;
    expect(w.prior).toBeNull();
    expect(w.delta).toBeNull();
    expect(w.recent).toBeCloseTo(0.5);
  });

  it('gives no recent figure for a player who has not played since before it', () => {
    // A starter last seen in week 9, asked at week 16, has no recent role —
    // which is true, rather than borrowing his October form.
    const w = summarize(flat(9, 0.7), 16)!;
    expect(w.recent).toBeNull();
    expect(w.delta).toBeNull();
    expect(w.prior).toBeCloseTo(0.7);
  });
});

describe('summarize — week 18', () => {
  /**
   * Week 18 measures playoff seeding, not a role: teams with a locked seed rest
   * starters and teams still alive do not. Left in the recent window it made
   * the sharpest "declines" in the league a list of rested quarterbacks.
   */
  it('keeps week 18 out of both sides of the comparison', () => {
    const played = flat(17, 0.9);
    // Rested in the finale, the way a locked-in starter is.
    const samples = [...played, { week: 18, value: 0.1 }];

    const w = summarize(samples, FINAL_REGULAR_WEEK)!;

    expect(w.recent).toBeCloseTo(0.9);
    expect(w.prior).toBeCloseTo(0.9);
    expect(w.delta).toBeCloseTo(0);
    // Nothing about that week reaches the flag the UI draws.
    expect(Math.abs(w.delta!)).toBeLessThan(MATERIAL_DELTA);
  });

  it('still counts week 18 in the season average, where one game cannot do damage', () => {
    const w = summarize([...flat(17, 0.9), { week: 18, value: 0.1 }], FINAL_REGULAR_WEEK)!;
    expect(w.games).toBe(18);
    expect(w.season).toBeLessThan(0.9);
    expect(w.season).toBeGreaterThan(0.85);
  });

  it('does not let a rested finale flip a steady starter positive', () => {
    // The second version of the bug: week 18 excluded from `recent` but left
    // inside the baseline dropped it, turning rested starters into risers.
    const w = summarize([...flat(17, 0.92), { week: 18, value: 0.75 }], FINAL_REGULAR_WEEK)!;
    expect(w.delta).toBeCloseTo(0);
    expect(w.prior).toBeCloseTo(0.92);
  });

  it('behaves identically mid-season, where the window never reaches week 18', () => {
    const early = summarize(flat(9, 0.5), 9)!;
    expect(early.recentGames).toBe(RECENT_WEEKS);
    expect(early.priorGames).toBe(5);
  });
});
