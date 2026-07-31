import { describe, expect, it } from 'vitest';
import type { ActivityAdjustment } from '../engine/activityFactor';
import { describeAdjustment } from './activityText';

const adjustment = (
  factor: number,
  reasons: ActivityAdjustment['reasons'],
): ActivityAdjustment => ({ factor, signal: 0, reasons });

describe('describeAdjustment', () => {
  it('leads with where the player is now and follows with where he was', () => {
    // A bare "70% snaps" is a number; "70% snaps, up from 35%" is a reason,
    // and the reason is the whole point of showing it.
    const text = describeAdjustment(
      adjustment(1.08, [{ label: 'snaps', from: 0.35, to: 0.7 }]),
    );

    expect(text).toContain('70% snaps, up from 35%');
    expect(text).toContain('lifts this value 8%');
  });

  it('says cuts, and drops the sign, when the role is shrinking', () => {
    // The direction is carried by the word rather than by a minus buried in a
    // sentence, which is easy to miss and impossible to hear read aloud.
    const text = describeAdjustment(
      adjustment(0.88, [{ label: 'carry share', from: 0.6, to: 0.3 }]),
    );

    expect(text).toContain('cuts this value 12%');
    expect(text).toContain('30% carry share, down from 60%');
    expect(text).not.toContain('-12%');
  });

  it('lists every metric behind the move, in the order given', () => {
    // `reasons` arrives sorted by size of move, so the explanation leads with
    // whatever actually changed rather than with whichever metric sorts first.
    const text = describeAdjustment(
      adjustment(1.1, [
        { label: 'snaps', from: 0.35, to: 0.7 },
        { label: 'target share', from: 0.2, to: 0.24 },
      ]),
    );

    expect(text.indexOf('70% snaps')).toBeLessThan(text.indexOf('24% target share'));
    expect(text).toContain('24% target share, up from 20%');
  });

  it('does not claim a move it rounds away', () => {
    // Both ends round to 35%, so "up from 35%" would read as a contradiction
    // of the very number next to it.
    const text = describeAdjustment(
      adjustment(1.02, [{ label: 'snaps', from: 0.351, to: 0.354 }]),
    );

    expect(text).toContain('35% snaps, flat');
    expect(text).not.toContain('up from');
  });
});
