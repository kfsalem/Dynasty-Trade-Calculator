import { describe, expect, it } from 'vitest';
import { deadlineNotice, tradeWindow } from './tradeWindow';
import { makeSettings } from './testFixtures';
import type { SeasonOdds } from './analysis';

const settings = (tradeDeadline: number | null) =>
  makeSettings(['QB', 'RB', 'WR'], { tradeDeadline });

/** `weeksPlayed` is the only field the window reads; the odds are irrelevant. */
const season = (weeksPlayed: number): SeasonOdds => ({
  odds: new Map([[1, 0.5]]),
  weeksPlayed,
  weeksTotal: 14,
});

describe('tradeWindow', () => {
  it('is open all season in a league with no deadline', () => {
    const window = tradeWindow(settings(null), season(13));

    expect(window.open).toBe(true);
    expect(window.deadline).toBeNull();
    expect(window.weeksLeft).toBeNull();
  });

  /**
   * The direction to be wrong in. A window wrongly reported closed hides the
   * app's main feature behind a claim the reader knows to be false.
   */
  it('stays open when there is no season to measure the deadline against', () => {
    const window = tradeWindow(settings(11), undefined);

    expect(window.open).toBe(true);
    expect(window.week).toBeNull();
    // The deadline is still reported: it exists, it just cannot have passed in
    // an offseason.
    expect(window.deadline).toBe(11);
  });

  it('counts the week being played as one you can still act in', () => {
    // Ten weeks have a result behind them, so week 11 is the one in progress —
    // and a week-11 deadline has not passed.
    const window = tradeWindow(settings(11), season(10));

    expect(window.open).toBe(true);
    expect(window.week).toBe(11);
    expect(window.weeksLeft).toBe(1);
  });

  it('closes once the deadline week has been played', () => {
    const window = tradeWindow(settings(11), season(11));

    expect(window.open).toBe(false);
    expect(window.week).toBe(12);
    expect(window.weeksLeft).toBeNull();
  });

  it('reports the weeks left, this one included', () => {
    expect(tradeWindow(settings(11), season(7)).weeksLeft).toBe(4);
  });
});

describe('deadlineNotice', () => {
  it('says nothing when the league has no deadline', () => {
    expect(deadlineNotice(tradeWindow(settings(null), season(13)))).toBeNull();
  });

  /**
   * A banner that shows all season is furniture, and furniture is what people
   * stop reading — which would cost the sentence its force in the weeks it
   * actually matters.
   */
  it('stays quiet while the deadline is far off', () => {
    expect(deadlineNotice(tradeWindow(settings(11), season(2)))).toBeNull();
  });

  it('speaks once the deadline is close', () => {
    const notice = deadlineNotice(tradeWindow(settings(11), season(8)));

    expect(notice).toContain('week 11');
    expect(notice).toContain('3 weeks left');
  });

  it('names the last week as the last week', () => {
    expect(deadlineNotice(tradeWindow(settings(11), season(10)))).toContain(
      'last week to make one',
    );
  });

  it('reports a passed deadline in the past tense', () => {
    expect(deadlineNotice(tradeWindow(settings(11), season(12)))).toContain('passed');
  });
});
