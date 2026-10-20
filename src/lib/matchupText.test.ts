import { describe, expect, it } from 'vitest';
import type { MatchupOdds, MatchupSide } from '../engine/matchup';
import { matchupText } from './matchupText';

const side = (expected: number, scored = 0): MatchupSide =>
  ({ rosterId: 1, expected, scored, projectedBefore: expected, projectedLeft: expected }) as MatchupSide;

const odds = (over: Partial<MatchupOdds> = {}): MatchupOdds => ({
  me: side(130.4),
  them: side(121.25),
  chance: 0.59,
  asSet: null,
  themUnset: false,
  underway: false,
  final: false,
  ...over,
});

describe('matchupText', () => {
  it('leads with who is favoured, then the chance and both totals', () => {
    const text = matchupText(odds(), 'Gridiron Gang');
    expect(text.headline).toBe("You're favoured against Gridiron Gang");
    expect(text.figure).toBe('59%');
    expect(text.totals).toBe('Projected 130.4 to 121.3.');
    expect(text.note).toBeNull();
  });

  it('calls a near-even matchup a coin flip, and names an opponent who is favoured', () => {
    expect(matchupText(odds({ chance: 0.52 }), 'GG').headline).toBe('A coin flip against GG');
    expect(matchupText(odds({ chance: 0.3 }), 'GG').headline).toBe('GG is favoured');
  });

  it('says what is already final once games are underway', () => {
    const text = matchupText(odds({ underway: true, me: side(130, 44.5), them: side(120, 61) }), 'GG');
    expect(text.totals).toBe('Expected 130.0 to 120.0, with 44.5 and 61.0 already final.');
  });

  it('tells the reader when the opponent has set a worse lineup than his best', () => {
    const text = matchupText(odds({ asSet: { expected: 112.25, chance: 0.68 } }), 'GG');
    expect(text.note).toBe(
      "GG's lineup as set projects 112.3, 9.0 short of their best. If they leave it, you win 68% of the time.",
    );
    // In best ball the platform plays his best lineup anyway.
    expect(matchupText(odds({ asSet: { expected: 112, chance: 0.68 } }), 'GG', { bestBall: true }).note).toBeNull();
  });

  it('says an unset opponent is assumed to set his best', () => {
    expect(matchupText(odds({ themUnset: true }), 'GG').note).toMatch(/has not set a lineup yet/);
  });

  it('reports the result, not a chance, once the week is over', () => {
    const text = matchupText(odds({ final: true, underway: true, me: side(98.2), them: side(104) }), 'GG');
    expect(text.headline).toBe('GG beat you');
    expect(text.figure).toBe('Final');
    expect(text.totals).toBe('98.2 to 104.0.');
  });
});
