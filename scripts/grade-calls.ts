/**
 * Grade the lineup panel's stated odds, and print the whole record (#164).
 *
 *     npm run grade:calls
 *
 * Brings `public/data/track-record.json` up to date exactly as the weekly
 * ingest does — see `ingest/trackRecord` for what is replayed and why it is
 * honest — and then prints it in more detail than the panel shows: by bucket,
 * by season and by position.
 *
 * Not in CI, for the reason `check:slots` is not: it needs live endpoints.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ingestTrackRecord } from './ingest/trackRecord';
import {
  BUCKETS,
  TRACK_RECORD_FILE,
  tally,
  type TrackRecordFile,
  type TrackRecordRow,
} from '../src/engine/trackRecord';

const OUT_DIR = fileURLToPath(new URL('../public/data/', import.meta.url));

const pct = (share: number) => `${(share * 100).toFixed(1)}%`.padStart(6);

/** One line of the table: how many calls, how many came true, and what was stated. */
function line(label: string, rows: TrackRecordRow[]) {
  const { calls, rate, low, high, stated } = tally(rows);
  const counts = `${label.padEnd(9)} ${String(calls).padStart(6)}`;
  const cameTrue = `${pct(rate)} (${pct(low)}–${pct(high)})`;
  console.log(`  ${counts}  ${cameTrue}  ${pct(stated)}`);
}

function report(title: string, rows: TrackRecordRow[]) {
  console.log(`\n${title}: ${rows.length} calls`);
  if (rows.length === 0) return;
  console.log('  stated     calls  came true (95% interval)  stated mean');
  for (let i = 0; i < BUCKETS.length - 1; i++) {
    const from = BUCKETS[i];
    const to = BUCKETS[i + 1];
    const inside = rows.filter((row) => row[4] / 1000 >= from && row[4] / 1000 < (to === 1 ? 2 : to));
    if (inside.length) line(`${Math.round(from * 100)}–${Math.round(to * 100)}%`, inside);
  }
  line('all', rows);
}

await ingestTrackRecord(OUT_DIR, new Date().toISOString());
const file = JSON.parse(readFileSync(`${OUT_DIR}${TRACK_RECORD_FILE}`, 'utf8')) as TrackRecordFile;

/*
  Two kinds of call, graded apart. Benching a man projected to play is the
  projection's opinion against the manager's, and the curve is a claim about
  exactly that. Benching a man who was on bye or projected for nothing is a
  fact about the roster: the curve still prints a chance for it, from the
  newcomer's projection alone, but it is not the question the curve answers.
*/
const opinions = file.rows.filter((row) => row[7] === 0);

report('Opinions: benching a man projected to play', opinions);
report('Opinions the panel states as a change to make', opinions.filter((row) => row[6] === 1));
report('Facts: benching a man on bye or projected for nothing', file.rows.filter((row) => row[7] === 1));
for (const season of [...new Set(opinions.map((row) => row[0]))].sort()) {
  report(`Opinions, ${season}`, opinions.filter((row) => row[0] === season));
}
for (const position of ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']) {
  const at = opinions.filter((row) => row[3] === position);
  if (at.length) report(`Opinions, ${position}`, at);
}
