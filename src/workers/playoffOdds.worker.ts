import { simulate, type OddsInput, type TeamOdds } from '../engine/playoffOdds';

/**
 * The season simulation, off the main thread.
 *
 * 10,000 iterations of a 12-team league runs in about 60ms on a desktop, which
 * sounds cheap enough to skip this. It is not, for two reasons. The trade panel
 * needs *two* runs — the league as it stands and the league after the proposed
 * trade — and it re-runs them on every checkbox tick; and a mid-range phone is
 * several times slower than the machine this was measured on, which is the
 * device a trade actually gets argued on. A hundred milliseconds of blocked
 * main thread per keystroke is a janky panel.
 *
 * The protocol is deliberately dumb: one request in, one result out, correlated
 * by id. Nothing about trades leaks in here — this worker runs a simulation and
 * has no idea why.
 */

export interface OddsRequest {
  /** Correlates the reply, so a stale answer can be discarded rather than shown. */
  id: number;
  input: OddsInput;
}

export interface OddsReply {
  id: number;
  odds: TeamOdds[];
}

self.onmessage = (event: MessageEvent<OddsRequest>) => {
  const { id, input } = event.data;
  const reply: OddsReply = { id, odds: simulate(input) };
  self.postMessage(reply);
};
