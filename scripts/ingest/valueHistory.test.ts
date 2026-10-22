import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appendValueHistory } from './valueHistory';

const RUN = '2026-10-27T11:00:00.000Z';
let dir: string;

const snapshot = (generatedAt: string, value: number) => ({
  generatedAt,
  source: 'test',
  columns: [],
  rawMax: value,
  rows: [['9221', 'RB', value, value - 500, 1, 1, 0, 1]],
});

async function writeSnapshots(generatedAt: string) {
  await mkdir(join(dir, 'values'), { recursive: true });
  for (const q of [1, 2]) {
    await writeFile(
      join(dir, `values/dynasty-${q}qb-10t-ppr1.json`),
      JSON.stringify(snapshot(generatedAt, 11000 + q)),
    );
  }
}

const read = async (q: number) =>
  JSON.parse(await readFile(join(dir, `values/history-${q}qb.json`), 'utf8'));

beforeEach(async () => {
  dir = `${await mkdtemp(join(tmpdir(), 'history-'))}/`;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

describe('appendValueHistory', () => {
  it('adds a point for each QB setting on the weekly refresh', async () => {
    vi.stubEnv('VALUE_HISTORY', 'append');
    await writeSnapshots(RUN);
    await appendValueHistory(dir, RUN);

    expect((await read(1)).dates).toEqual(['2026-10-27']);
    expect((await read(1)).players['9221']).toEqual(['RB', [11001], [10501]]);
    expect((await read(2)).players['9221']).toEqual(['RB', [11002], [10502]]);
  });

  it('leaves the histories alone on any other run, such as a deploy', async () => {
    vi.stubEnv('VALUE_HISTORY', '');
    await writeSnapshots(RUN);
    await appendValueHistory(dir, RUN);

    await expect(read(1)).rejects.toThrow();
  });

  it('adds nothing from a snapshot this run did not refresh, rather than redating last week', async () => {
    vi.stubEnv('VALUE_HISTORY', 'append');
    await writeSnapshots('2026-10-20T11:00:00.000Z');
    await appendValueHistory(dir, RUN);

    await expect(read(1)).rejects.toThrow();
  });

  it('extends a committed history', async () => {
    vi.stubEnv('VALUE_HISTORY', 'append');
    await writeSnapshots(RUN);
    await writeFile(
      join(dir, 'values/history-1qb.json'),
      JSON.stringify({
        generatedAt: 'old',
        numQbs: 1,
        source: 'seeded',
        dates: ['2026-10-20'],
        players: { '9221': ['RB', [10800], [10300]] },
      }),
    );
    await appendValueHistory(dir, RUN);
    const history = await read(1);

    expect(history.dates).toEqual(['2026-10-20', '2026-10-27']);
    expect(history.players['9221']).toEqual(['RB', [10800, 11001], [10300, 10501]]);
    expect(history.source).toBe('seeded');
  });
});
