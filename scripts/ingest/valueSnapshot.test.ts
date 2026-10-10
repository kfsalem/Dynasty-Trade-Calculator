import { describe, expect, it } from 'vitest';
import { VALUE_COLUMNS, snapshotSchema, valuesFromRows } from '../../src/values/fantasycalcRows';
import { buildSnapshot } from './valueSnapshot';

const meta = { source: 'https://api.fantasycalc.com/values/current?x', generatedAt: '2026-10-06T11:00:00.000Z' };

const entry = (i: number, over: Record<string, unknown> = {}) => ({
  player: { id: i, name: `Player ${i}`, position: 'WR', sleeperId: `s${i}` },
  value: 10000 - i * 10,
  redraftValue: 5000 - i * 5,
  overallRank: i + 1,
  positionRank: i + 1,
  trend30Day: 0,
  maybeTier: 1,
  ...over,
});

const response = (n = 150) => Array.from({ length: n }, (_, i) => entry(i));

/**
 * The snapshot is only worth having if it can never be overwritten by something
 * worse than itself (#43). Every refusal here leaves the committed copy alone.
 */
describe('buildSnapshot', () => {
  it('writes rows the app reads back to the same values the live source gives', () => {
    const file = buildSnapshot(JSON.stringify(response()), meta);

    expect(file.columns).toEqual(VALUE_COLUMNS);
    expect(file.generatedAt).toBe(meta.generatedAt);
    expect(snapshotSchema.safeParse(JSON.parse(JSON.stringify(file))).success).toBe(true);

    const values = valuesFromRows(file);
    expect(values.get('s0')).toMatchObject({ value: 10000, redraftValue: 5000 });
    expect(values.get('s100')).toMatchObject({ value: 9000, redraftValue: 4500 });
  });

  it('keeps the scale of an entry it has to drop', () => {
    // The top asset has no Sleeper id. Everyone else is still priced against it.
    const rows = response();
    rows[0] = entry(0, { player: { id: 0, name: 'Unmatched', position: 'WR', sleeperId: null } });

    const file = buildSnapshot(JSON.stringify(rows), meta);
    expect(file.rawMax).toBe(10000);
    expect(file.rows).toHaveLength(149);
  });

  it('refuses a body that is not JSON', () => {
    expect(() => buildSnapshot('<html>Bad gateway</html>', meta)).toThrow(/not JSON/);
  });

  it('refuses a response whose shape changed', () => {
    const rows = response().map((r) => ({ ...r, value: 'high' }));
    expect(() => buildSnapshot(JSON.stringify(rows), meta)).toThrow(/shape/);
  });

  it('refuses a response too thin to be the market', () => {
    expect(() => buildSnapshot(JSON.stringify(response(20)), meta)).toThrow(/floor/);
    expect(() => buildSnapshot('[]', meta)).toThrow(/floor/);
  });

  it('refuses a response in which nobody has a value', () => {
    const rows = response().map((r) => ({ ...r, value: 0 }));
    expect(() => buildSnapshot(JSON.stringify(rows), meta)).toThrow(/no scale/);
  });
});
