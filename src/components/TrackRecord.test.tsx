import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TrackRecord } from './TrackRecord';
import {
  TRACK_RECORD_COLUMNS,
  type TrackRecordFile,
  type TrackRecordRow,
} from '../engine/trackRecord';

const call = (chance: number, hit: 0 | 1, decisive: 0 | 1 = 0, fact: 0 | 1 = 0): TrackRecordRow => [
  2024,
  3,
  0,
  'WR',
  chance,
  hit,
  decisive,
  fact,
];

/** Forty calls at 52%, half true; four at 65%, all true and decisive; two facts. */
const FILE: TrackRecordFile = {
  generatedAt: '2026-10-22T00:00:00.000Z',
  columns: TRACK_RECORD_COLUMNS,
  leagues: 2,
  graded: ['0:2024:3', '1:2025:4'],
  rows: [
    ...Array.from({ length: 40 }, (_, i) => call(520, i % 2 === 0 ? 1 : 0)),
    ...Array.from({ length: 4 }, () => call(650, 1, 1)),
    call(850, 1, 0, 1),
    call(850, 1, 0, 1),
  ],
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

const open = () => userEvent.click(screen.getByText('How often these calls come true'));

describe('TrackRecord', () => {
  it('fetches nothing until it is opened', () => {
    const fetchMock = respond(FILE);
    vi.stubGlobal('fetch', fetchMock);
    render(<TrackRecord />);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers first: what was stated against what came true, over opinions only', async () => {
    vi.stubGlobal('fetch', respond(FILE));
    render(<TrackRecord />);
    await open();
    // 44 opinions: 40 at 52% and 4 at 65%, stated 53% on average; 24 came true, 55%.
    expect(
      await screen.findByText(/Of 44 start-or-sit calls since 2024, this panel put them at 53% on average, and 55% came true/),
    ).toBeInTheDocument();
  });

  it('prints a rate only where there are enough calls to read one', async () => {
    vi.stubGlobal('fetch', respond(FILE));
    render(<TrackRecord />);
    await open();
    const rows = within(await screen.findByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('50%–55%');
    expect(rows[0]).toHaveTextContent('50%');
    expect(rows[1]).toHaveTextContent('too few to read');
  });

  it('reports benching a man who was not playing apart from the opinions', async () => {
    vi.stubGlobal('fetch', respond(FILE));
    render(<TrackRecord />);
    await open();
    expect(await screen.findByText(/2 of 2 came true/)).toBeInTheDocument();
  });

  it('says so when the record cannot be loaded, rather than showing an empty table', async () => {
    vi.stubGlobal('fetch', respond(null, false));
    render(<TrackRecord />);
    await open();
    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('ignores a file whose columns this build does not read', async () => {
    vi.stubGlobal('fetch', respond({ ...FILE, columns: ['season', 'week'] }));
    render(<TrackRecord />);
    await open();
    expect(await screen.findByText(/could not be loaded/)).toBeInTheDocument();
  });
});
