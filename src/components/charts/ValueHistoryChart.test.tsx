import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ValueHistoryChart } from './ValueHistoryChart';
import { withClient } from '../../test/harness';
import type { ValueHistoryFile } from '../../values/valueHistory';

const HISTORY: ValueHistoryFile = {
  generatedAt: '2026-10-22T00:00:00.000Z',
  numQbs: 1,
  source: 'test',
  dates: ['2026-09-29', '2026-10-13', '2026-10-20'],
  players: {
    gibbs: ['RB', [10000, null, 11000], [9500, null, 10000]],
    once: ['WR', [null, null, 5000], [null, null, 4800]],
  },
};

const respond = (body: unknown, ok = true) =>
  vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 404, json: async () => body });

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const draw = (playerId: string, numQbs: 1 | 2 = 1) =>
  render(<ValueHistoryChart playerId={playerId} position="RB" numQbs={numQbs} />, {
    wrapper: withClient(),
  });

describe('ValueHistoryChart (#158)', () => {
  it('says how far his dynasty value has moved, and since when', async () => {
    vi.stubGlobal('fetch', respond(HISTORY));
    draw('gibbs');

    expect(await screen.findByText('up 10%')).toBeInTheDocument();
    expect(screen.getByText(/since Sep 29/)).toBeInTheDocument();
  });

  it('carries every point it draws in its table, skipping days he was not listed', async () => {
    vi.stubGlobal('fetch', respond(HISTORY));
    draw('gibbs');
    await userEvent.click(await screen.findByText('Show the numbers'));
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);

    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Sep 29'),
      expect.stringContaining('Oct 20'),
    ]);
  });

  it('names both lines, so neither is identified by colour alone', async () => {
    vi.stubGlobal('fetch', respond(HISTORY));
    draw('gibbs');

    expect(await screen.findAllByText('Dynasty')).not.toHaveLength(0);
    expect(screen.getAllByText('Win-now')).not.toHaveLength(0);
  });

  it('draws nothing from one point, which is a price rather than a history', async () => {
    const fetchMock = respond(HISTORY);
    vi.stubGlobal('fetch', fetchMock);
    const { container } = draw('once');

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await vi.waitFor(() => expect(container.querySelector('.skeleton')).toBeNull());
    expect(container).toBeEmptyDOMElement();
  });

  it('reads the history for the league’s QB setting', async () => {
    const fetchMock = respond(HISTORY);
    vi.stubGlobal('fetch', fetchMock);
    draw('gibbs', 2);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toMatch(/values\/history-2qb\.json$/);
  });

  it('draws nothing when the file cannot be loaded', async () => {
    vi.stubGlobal('fetch', respond(null, false));
    const { container } = draw('gibbs');

    await vi.waitFor(() => expect(container.querySelector('.skeleton')).toBeNull());
    expect(container).toBeEmptyDOMElement();
  });
});
