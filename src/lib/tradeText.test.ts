import { describe, expect, it } from 'vitest';
import { describeTrade } from './tradeText';
import type { SuggestedTrade } from '../engine/suggest';

const asset = (label: string, kind: 'player' | 'pick' = 'player') =>
  ({ kind, id: label, label, value: 0, marketValue: 0 }) as unknown as SuggestedTrade['give'][number];

const trade = (
  give: string[],
  get: string[],
  fairnessRating: SuggestedTrade['analysis']['fairnessRating'] = 'very_fair',
  valueDifferencePct = 0.01,
) => ({
  give: give.map((l) => asset(l)),
  get: get.map((l) => asset(l)),
  partnerName: 'DREAM TEAM 2028',
  analysis: { fairnessRating, valueDifferencePct } as SuggestedTrade['analysis'],
});

describe('describeTrade', () => {
  // #100: the summary counted one side, without plurals.
  it('says both sides, the partner and the verdict', () => {
    expect(describeTrade(trade(['Rico Dowdle', '2027 2nd'], ['Dak Prescott']))).toBe(
      'Send Rico Dowdle and 2027 2nd to DREAM TEAM 2028 for Dak Prescott. Very fair, 1% apart.',
    );
  });

  it('lists three or more assets as a sentence would', () => {
    expect(describeTrade(trade(['A', 'B', 'C'], ['D'], 'slightly_unfair', 0.12))).toBe(
      'Send A, B and C to DREAM TEAM 2028 for D. Slightly uneven, 12% apart.',
    );
  });
});
