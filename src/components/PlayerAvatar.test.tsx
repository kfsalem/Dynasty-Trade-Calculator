import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { PlayerAvatar } from './PlayerAvatar';
import { makePlayer } from '../engine/testFixtures';

const harrison = { ...makePlayer('11628', 'WR'), name: 'Marvin Harrison' };

describe('PlayerAvatar', () => {
  it('loads the headshot for a player with a Sleeper id', () => {
    const { container } = render(<PlayerAvatar player={harrison} />);
    const img = container.querySelector('img');

    expect(img?.getAttribute('src')).toBe(
      'https://sleepercdn.com/content/nfl/players/thumb/11628.jpg',
    );
    // Decorative: the name always sits beside it.
    expect(img?.getAttribute('alt')).toBe('');
  });

  it('falls back to initials when the image fails, so a blocked CDN costs photos, not layout', () => {
    const { container } = render(<PlayerAvatar player={harrison} />);
    fireEvent.error(container.querySelector('img')!);

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('MH');
  });

  it('uses initials for a team defence, which has no headshot', () => {
    const defence = { ...makePlayer('SEA', 'DEF'), name: 'Seattle Seahawks' };
    const { container } = render(<PlayerAvatar player={defence} />);

    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toBe('SS');
  });
});
