import { describe, expect, it } from 'vitest';
import { availability, canStart, injuryNote } from './availability';
import type { InjuryStatus, Player } from '../types';
import { makePlayer } from './testFixtures';

const withStatus = (status: InjuryStatus['status'], description?: string): Player => ({
  ...makePlayer('p1', 'WR'),
  injury: { status, description },
});

describe('availability', () => {
  it('rules out the statuses that end a season', () => {
    for (const status of ['ir', 'pup', 'sus', 'dnr', 'na'] as const) {
      expect(availability(withStatus(status))).toBe('out_for_season');
      expect(canStart(withStatus(status))).toBe(false);
    }
  });

  it('leaves week-to-week statuses in the lineup', () => {
    // The tag flips twice a week and most questionable players play. A model
    // that repriced on it would rewrite every roster in the league each Friday.
    for (const status of ['questionable', 'doubtful', 'out'] as const) {
      expect(availability(withStatus(status))).toBe('week_to_week');
      expect(canStart(withStatus(status))).toBe(true);
    }
  });

  it('treats no status and an explicit healthy one alike', () => {
    expect(availability(makePlayer('p1', 'WR'))).toBe('available');
    expect(availability(withStatus('healthy'))).toBe('available');
  });

  it('fails open on a status it does not recognise', () => {
    // Sleeper adds designations without asking. Both directions are wrong when
    // the word is a mystery, but only one of them silently deletes a starter
    // from a lineup on the strength of a word nobody has read.
    expect(availability(withStatus('unknown', 'Reserve/Whatever'))).toBe('week_to_week');
    expect(canStart(withStatus('unknown', 'Reserve/Whatever'))).toBe(true);
  });
});

describe('injuryNote', () => {
  it('says what the app did, not just what the status is', () => {
    // A player vanishing from a lineup with no explanation is indistinguishable
    // from a bug.
    const note = injuryNote({ status: 'ir' });
    expect(note).toContain('injured reserve');
    expect(note).toContain('Held out of the best lineup');
    expect(note).toContain('unchanged');
  });

  it('promises a week-to-week player has not been repriced', () => {
    expect(injuryNote({ status: 'questionable' })).toContain('not marked down');
  });

  it('quotes an unrecognised status back verbatim', () => {
    expect(injuryNote({ status: 'unknown', description: 'Reserve/Whatever' })).toContain(
      '"Reserve/Whatever"',
    );
  });
});
