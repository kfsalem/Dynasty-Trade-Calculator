import { describe, expect, it } from 'vitest';
import type { WeeklyPost } from '../engine/weeklyPost';
import { moveText, postLines, postText, recordText } from './postText';

const POST: WeeklyPost = {
  season: '2026',
  week: 8,
  rankings: [
    { rosterId: 2, rank: 1, name: 'bea', wins: 6, losses: 2, ties: 0, index: 1 },
    { rosterId: 1, rank: 2, name: 'al', wins: 5, losses: 2, ties: 1, index: 0.874 },
  ],
  highScore: { rosterId: 1, name: 'al', points: 168.4 },
  upset: {
    winner: { rosterId: 3, name: 'cy', points: 121.3, wins: 2, losses: 5, ties: 0 },
    loser: { rosterId: 2, name: 'bea', points: 118.06, wins: 6, losses: 1, ties: 0 },
  },
  records: [],
  move: { kind: 'claim', name: 'dee', player: 'Ann Runner', bid: 31 },
};

describe('postText', () => {
  it('writes the post as plain text with the link back', () => {
    expect(postText(postLines(POST, 'The League'), 'https://x.test/?l=9')).toBe(
      [
        'The League · Week 8 · 2026',
        '',
        'Power rankings: starting lineups as valued today, leader = 100',
        '1. bea 6–2 · 100',
        '2. al 5–2–1 · 87',
        '',
        'High score: al, 168.40.',
        'Upset: cy (2–5 going in) beat bea (6–1), 121.30–118.06.',
        'Biggest claim: dee paid $31 for Ann Runner.',
        '',
        'Equalace: https://x.test/?l=9',
      ].join('\n'),
    );
  });

  it('measures the two margin records in margin, now and before', () => {
    expect(
      recordText({
        key: 'biggestBlowout',
        name: 'al',
        points: 180,
        opponent: { name: 'bea', points: 70 },
        previous: { name: 'cy', points: 160, opponentPoints: 60, season: '2024', week: 3 },
      }),
    ).toBe('Biggest win ever: al beat bea by 110.00. The old record was 100.00, cy in 2024 week 3.');
    expect(
      recordText({
        key: 'highestWeek',
        name: 'al',
        points: 180,
        opponent: { name: 'bea', points: 70 },
        previous: { name: 'cy', points: 160, opponentPoints: 60, season: '2024', week: 3 },
      }),
    ).toBe('Highest score ever: al, 180.00. The old record was 160.00, cy in 2024 week 3.');
  });

  it('names the busiest on the wire, and says each when they tie', () => {
    expect(moveText({ kind: 'busiest', names: ['al'], adds: 7 })).toEqual({
      label: 'Busiest on the wire',
      text: 'al, 7 pickups.',
    });
    expect(moveText({ kind: 'busiest', names: ['al', 'bea'], adds: 4 }).text).toBe(
      'al and bea, 4 pickups each.',
    );
  });

  it('lists what each side of a trade got', () => {
    expect(
      moveText({
        kind: 'trade',
        sides: [
          { name: 'al', gets: ['Ann Runner', 'a 2027 1st', '$10 of FAAB'] },
          { name: 'bea', gets: ['Bo Catcher'] },
        ],
        more: 2,
      }),
    ).toEqual({
      label: 'Trade',
      text: 'al gets Ann Runner, a 2027 1st and $10 of FAAB; bea gets Bo Catcher. 2 more trades this week.',
    });
  });
});
