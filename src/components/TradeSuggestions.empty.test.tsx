import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TradeSuggestions } from './TradeSuggestions';
import { makeLeague, makeRoster, makeSettings } from '../engine/testFixtures';

/*
  A search that ran and found nothing, stated flat. The engine only produces
  this against a real league's rosters, so the result is fixed here and the
  subject is what the tab says about it (#133).
*/
vi.mock('../engine/suggest', () => ({
  suggestTrades: () => ({
    trades: [],
    considered: 218,
    rejections: { unbalanced: 114, overRoster: 13, someoneWorse: 86, tooSmall: 5 },
    note: 'Searched 218 packages and found none worth proposing.',
  }),
}));

describe('TradeSuggestions, when a search finds nothing', () => {
  it('says why, counted, biggest reason first', () => {
    const settings = makeSettings(['QB'], { teamCount: 2 });
    const league = makeLeague([makeRoster(1, []), makeRoster(2, [])], settings);
    render(
      <TradeSuggestions
        league={league}
        players={new Map()}
        values={new Map()}
        picks={[]}
        summaries={[]}
        myRosterId={1}
        onOpenInCalculator={() => {}}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'No offer works for both sides right now' }),
    ).toBeInTheDocument();

    const reasons = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(reasons).toEqual([
      "114couldn't be made even, even with a draft pick added",
      '86would leave you or them worse off',
      '13would put a roster over its limit',
      '5help both sides, but by too little to be worth a negotiation',
    ]);
  });
});
