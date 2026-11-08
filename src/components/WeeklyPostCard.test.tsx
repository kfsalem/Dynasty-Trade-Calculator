import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WeeklyPostCard } from './WeeklyPostCard';
import type { WeeklyPost } from '../engine/weeklyPost';

const POST: WeeklyPost = {
  season: '2026',
  week: 8,
  rankings: [
    { rosterId: 2, rank: 1, name: 'bea', wins: 6, losses: 2, ties: 0, index: 1 },
    { rosterId: 1, rank: 2, name: 'al', wins: 5, losses: 3, ties: 0, index: 0.874 },
  ],
  highScore: { rosterId: 1, name: 'al', points: 168.4 },
  upset: null,
  records: [],
  move: null,
};

afterEach(() => vi.restoreAllMocks());

describe('WeeklyPostCard', () => {
  it('previews the post that will be copied', () => {
    render(<WeeklyPostCard post={POST} leagueName="The League" leagueId="123" />);
    expect(screen.getByRole('heading', { name: 'Week 8, for the league chat' })).toBeInTheDocument();
    const rows = within(screen.getByRole('list', { name: 'Power rankings' })).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual(['1bea6–2100', '2al5–387']);
    expect(screen.getByText('al, 168.40.')).toBeInTheDocument();
  });

  it('copies the text, with a link that opens the league', async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(<WeeklyPostCard post={POST} leagueName="The League" leagueId="123" />);
    await user.click(screen.getByRole('button', { name: 'Copy text' }));
    const text = writeText.mock.calls[0][0];
    expect(text.startsWith('The League · Week 8 · 2026\n')).toBe(true);
    expect(text.endsWith('?l=123')).toBe(true);
    expect(screen.getByRole('button', { name: 'Text copied' })).toBeInTheDocument();
  });

  it('shows the text to copy by hand when the clipboard refuses', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    render(<WeeklyPostCard post={POST} leagueName="The League" leagueId="123" />);
    await user.click(screen.getByRole('button', { name: 'Copy text' }));
    const box = screen.getByRole('textbox', { name: "The post's text, to copy by hand" });
    expect((box as HTMLTextAreaElement).value).toContain('1. bea 6–2 · 100');
  });
});
