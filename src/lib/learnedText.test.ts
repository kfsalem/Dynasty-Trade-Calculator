import { describe, expect, it } from 'vitest';
import { learn, unlearned } from '../engine/learned';
import { countPhrase, describeConfidence, evidenceNote } from './learnedText';

const TRADES = { one: 'trade', many: 'trades' };

describe('describeConfidence', () => {
  it('cuts at the thirds of the blend', () => {
    expect(describeConfidence(0)).toBe('low confidence');
    expect(describeConfidence(0.32)).toBe('low confidence');
    expect(describeConfidence(0.34)).toBe('moderate confidence');
    expect(describeConfidence(0.66)).toBe('moderate confidence');
    expect(describeConfidence(0.68)).toBe('high confidence');
    expect(describeConfidence(1)).toBe('high confidence');
  });
});

describe('countPhrase', () => {
  it('counts in words a person would use', () => {
    expect(countPhrase(47, TRADES)).toBe('47 trades');
    expect(countPhrase(1, TRADES)).toBe('1 trade');
    expect(countPhrase(0, TRADES)).toBe('no trades');
    expect(countPhrase(1200, TRADES)).toBe('1,200 trades');
  });
});

describe('evidenceNote', () => {
  it('states the sample and what it is worth', () => {
    const paid = learn(1.18, 1, 47, 40);
    expect(evidenceNote(paid, TRADES, '2023')).toBe(
      'From 47 trades since 2023 — moderate confidence.',
    );
  });

  it('works without a span', () => {
    expect(evidenceNote(learn(1.18, 1, 6, 40), TRADES)).toBe(
      'From 6 trades — low confidence.',
    );
  });

  /**
   * A number with no league in it is not a number held with low confidence. The
   * value there *is* the prior, and "low confidence" would have a reader think
   * their league had said something quiet rather than nothing at all.
   */
  it('says nothing was learned rather than reporting low confidence', () => {
    const note = evidenceNote(unlearned(1), TRADES, '2023');
    expect(note).toBe(
      'No trades since 2023 yet, so this is the starting assumption rather than your league\'s own record.',
    );
    expect(note).not.toMatch(/confidence/);
  });

  it('rises through the three words as a league accumulates a record', () => {
    const at = (n: number) => evidenceNote(learn(2, 1, n, 40), TRADES);
    expect(at(10)).toMatch(/low confidence/);
    expect(at(40)).toMatch(/moderate confidence/);
    expect(at(200)).toMatch(/high confidence/);
  });
});
