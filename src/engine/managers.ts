import type { LeagueTransaction, SeasonManager, TransactionHistory } from '../platforms/types';
import { blend, unlearned, type Learned } from './learned';

/**
 * What these particular managers do, as opposed to what a model says they
 * should.
 *
 * `suggestTrades` proves a trade helps the other side. It has never had any
 * idea whether that manager would answer the message — every partner is weighted
 * identically, so a sixth of the engine's output goes to someone who trades
 * twice a year and is ranked no lower for it.
 *
 * The league's own transaction feed answers that, and the answer is not subtle.
 * Measured over both test leagues on 2026-08-31:
 *
 * | league | seasons | trades | managers | busiest / quietest |
 * |---|---|---|---|---|
 * | The Eternal Rebuild | 2023-2026 | 137 | 11 | 6.1x |
 * | Tight Ends Dynasty | 2023-2025 | 26 | 10 | 6.5x |
 *
 * ## What survived measurement, and what did not
 *
 * The issue this comes from named seven signals. Two were testable against the
 * only question that matters — does knowing this from half a league's trades
 * predict the other half — and only one of them earned a place in the ranking.
 *
 * **Trade appetite predicts.** Against out-of-sample Poisson deviance, using a
 * manager's own rate beats assuming everyone trades alike by 2.87 to 1.41 in
 * the four-season league and 1.41 to 1.16 in the three-season one. It replicates
 * on two independent leagues and it is a count, which is robust at a sample size
 * where a price model is not.
 *
 * **Partner history does not, enough.** It is real — past pairing predicts
 * future pairing beyond what appetite alone explains, r=0.40 (p=0.003) and
 * r=0.26 (p=0.045) — but the predictive *gain* is 0.036 of deviance against
 * appetite's 1.47, and the best shrinkage constant for it lands at 8 in one
 * league and 50 in the other, which is to say it is not identifiable. A term
 * nobody can calibrate does not belong in a score. It is stated as a fact
 * instead, where it is genuinely interesting and cannot mislead a ranking.
 *
 * That distinction is the whole point of ordering this behind `engine/learned`:
 * both signals are real, and only one of them is worth acting on.
 *
 * ## What it cannot say
 *
 * Nothing publishes a *declined* trade. This sees everything a league agreed to
 * and nothing it refused, so a manager who reads as inactive here may be asking
 * constantly and being turned down. The figure is a rate of completed trades and
 * is never described as a willingness.
 */

/**
 * Trades' worth of prior on every manager's rate — the `c` in `(k + c)/(m + c)`.
 *
 * The half-life this signal owns, and it is measured rather than chosen.
 * `engine/learned` deliberately supplies no default; the sweep below is what
 * this one rests on.
 *
 * Both test leagues were split at random into halves six hundred times over, a
 * rate estimated from one half and scored against the counts in the other by
 * Poisson deviance. Six is the minimum **in both**, which is the part worth
 * trusting — one league finding an optimum is a tuned constant, two independent
 * leagues finding the same one is a property of how managers trade:
 *
 * | c | Eternal Rebuild | Tight Ends |
 * |---|---|---|
 * | 1 | 1.570 | 1.377 |
 * | 3 | 1.418 | 1.178 |
 * | **6** | **1.406** | **1.161** |
 * | 12 | 1.466 | 1.284 |
 * | infinite (everyone alike) | 2.874 | 1.407 |
 *
 * Both ends are worse than the middle in both leagues, so this is a real
 * minimum and not the edge of a range someone picked.
 *
 * It shares a number with `playoffOdds.SHRINK_HALF_LIFE` and shares nothing
 * else: that one is measured in weeks of football and this one in trades. They
 * are not the same constant, and unifying them would be a coincidence mistaken
 * for a model.
 */
const APPETITE_PRIOR = 6;

/** What one manager's record says about him. Counts only; nothing fitted. */
export interface ManagerRecord {
  /** The identity that survives across seasons. Never a roster id. */
  userId: string;
  name: string;
  /** Completed trades he was a side of, across every season the walk reached. */
  trades: number;
  /** Successful adds off the wire — waivers won and free agents taken. */
  claims: number;
  /** Draft picks taken in, and given up, in trades. */
  picksAcquired: number;
  picksSpent: number;
  /** Trades with each other manager, keyed by their `userId`. */
  partners: Map<string, number>;
  /** Earliest season he traded in. Null when he never has. */
  firstTraded: string | null;
}

export interface ManagerModel {
  /** Keyed by `userId`. Everyone the league's own tables name. */
  managers: Map<string, ManagerRecord>;
  /**
   * Current-season roster id to `userId`, so a caller holding a roster can find
   * a manager without having to know that the two are different kinds of thing.
   */
  rosters: Map<number, string>;
  /** Completed trades every side of which could be attributed to somebody. */
  trades: number;
  /**
   * Trades touching a team nobody owned. Skipped, never guessed at — one test
   * league carries an orphan through a whole season, and 12 of its 137 trades
   * involve it.
   */
  unattributed: number;
  /**
   * Mean trades per manager: the rate at which a manager is unremarkable, and
   * the `m` in `(k + c)/(m + c)`.
   */
  meanTrades: number;
  /** Seasons that contributed a trade, oldest first. */
  seasons: string[];
  /** True when the walk could not reach the whole chain. */
  truncated: boolean;
}

/** Two managers, and what they have done with each other before. */
export interface Partnership {
  trades: number;
  /** No pair in this league has traded more often. A tie counts as strongest. */
  strongest: boolean;
  /** Earliest season both had traded by. Null when the pair never has. */
  since: string | null;
}

const EMPTY: ManagerModel = {
  managers: new Map(),
  rosters: new Map(),
  trades: 0,
  unattributed: 0,
  meanTrades: 0,
  seasons: [],
  truncated: false,
};

/**
 * The sides of one transaction, as managers rather than as rosters.
 *
 * Null for any roster the season's own table cannot name, and the caller then
 * drops the whole transaction: half a trade is not evidence about the half that
 * can be named, because the count being built is of trades a manager *made*, and
 * one made with a team nobody owned is not one of them.
 */
function sidesOf(
  transaction: LeagueTransaction,
  managers: Map<string, Map<number, SeasonManager>>,
): string[] | null {
  const table = managers.get(transaction.season);
  if (!table) return null;

  const users = new Set<string>();
  for (const rosterId of transaction.rosterIds) {
    const userId = table.get(rosterId)?.userId ?? null;
    if (!userId) return null;
    users.add(userId);
  }

  // A one-sided "trade" is a correction filed under the wrong type, and a trade
  // with nobody on it is not a trade.
  return users.size >= 2 ? [...users] : null;
}

/**
 * Build the model from a league's own feed.
 *
 * Everything here is a count over data already fetched. There is no fitting, no
 * threshold and no projection — the only arithmetic that is not addition is the
 * mean, and the shrinkage that reads it lives in `appetite`.
 */
export function modelManagers(history: TransactionHistory | undefined): ManagerModel {
  if (!history) return EMPTY;

  const records = new Map<string, ManagerRecord>();
  const named = (userId: string, name: string): ManagerRecord => {
    const existing = records.get(userId);
    if (existing) return existing;
    const record: ManagerRecord = {
      userId,
      name,
      trades: 0,
      claims: 0,
      picksAcquired: 0,
      picksSpent: 0,
      partners: new Map(),
      firstTraded: null,
    };
    records.set(userId, record);
    return record;
  };

  /*
    Everyone the league's tables name, before a single transaction is read.

    A manager who has never traded has to exist in this model, and he is exactly
    the one a feed-driven pass would miss: he appears in no trade, so building
    the roll from transactions alone would leave him out and his appetite
    unstated rather than low. He is the clearest evidence the feed contains.

    Named from the newest season, because that is who is in the league now.
  */
  const newestFirst = [...history.managers.keys()].sort().reverse();
  const rosters = new Map<number, string>();
  const current = newestFirst[0];
  if (current) {
    for (const [rosterId, manager] of history.managers.get(current) ?? []) {
      if (!manager.userId) continue;
      rosters.set(rosterId, manager.userId);
      named(manager.userId, manager.name);
    }
  }

  let trades = 0;
  let unattributed = 0;
  const tradedSeasons = new Set<string>();

  for (const transaction of history.transactions) {
    if (!transaction.succeeded) continue;

    const table = history.managers.get(transaction.season);

    if (transaction.type === 'waiver' || transaction.type === 'free_agent') {
      /*
        A claim is one roster's, and `adds` is the field that says a player
        actually arrived. `rosterIds` carries the claimant too, but a move that
        only drops somebody is not an add and should not read as wire activity.
      */
      for (const rosterId of transaction.adds.values()) {
        const manager = table?.get(rosterId);
        if (!manager?.userId) continue;
        named(manager.userId, manager.name).claims++;
      }
      continue;
    }

    if (transaction.type !== 'trade') continue;

    const sides = sidesOf(transaction, history.managers);
    if (!sides) {
      unattributed++;
      continue;
    }

    trades++;
    tradedSeasons.add(transaction.season);

    for (const userId of sides) {
      const record = named(userId, nameOf(table, userId) ?? userId);
      record.trades++;
      // Oldest wins: the evidence clause says how far back the record goes.
      if (!record.firstTraded || transaction.season < record.firstTraded) {
        record.firstTraded = transaction.season;
      }
      for (const other of sides) {
        if (other === userId) continue;
        record.partners.set(other, (record.partners.get(other) ?? 0) + 1);
      }
    }

    for (const pick of transaction.picks) {
      const to = pick.toRosterId === null ? undefined : table?.get(pick.toRosterId);
      const from = pick.fromRosterId === null ? undefined : table?.get(pick.fromRosterId);
      if (to?.userId) named(to.userId, to.name).picksAcquired++;
      if (from?.userId) named(from.userId, from.name).picksSpent++;
    }
  }

  const roll = [...records.values()];
  const participations = roll.reduce((total, record) => total + record.trades, 0);

  return {
    managers: records,
    rosters,
    trades,
    unattributed,
    meanTrades: roll.length > 0 ? participations / roll.length : 0,
    seasons: [...tradedSeasons].sort(),
    truncated: history.truncated,
  };
}

/** A manager's display name in one season's table, if it names him at all. */
function nameOf(
  table: Map<number, SeasonManager> | undefined,
  userId: string,
): string | null {
  for (const manager of table?.values() ?? []) {
    if (manager.userId === userId) return manager.name;
  }
  return null;
}

/**
 * How much more, or less, than the league's own average this manager trades.
 *
 * A shrunk Poisson rate, `(k + c)/(m + c)`, where `k` is his completed trades
 * and `m` is what the league's rate alone predicts for him. One multiplier
 * around 1.0: a manager who completes twice as many trades as the rest is twice
 * as likely to act on an offer, which is the honest reading of a completed-trade
 * count — a rate, and not a willingness.
 *
 * The form matters more than it looks. The obvious `learn(k / m, 1, k, c)`
 * shrinks on the manager's *own* count, and so hands a manager who has never
 * traded in four seasons a weight of zero and a factor of exactly 1.0 — scoring
 * the single clearest case in the data as though nothing were known about him.
 * The evidence about a manager is every trade the league made while he sat there
 * not making it, which is `m`, so `m` is what the weight is built from and `k`
 * is what the reader is shown. `blend` takes the two separately, for exactly
 * this kind of reason.
 *
 * A league with no trades at all gives `(0 + c)/(0 + c)` — one, exactly, for
 * everybody, which is the app as it was before this existed.
 */
export function appetite(model: ManagerModel, userId: string | null): Learned<number> {
  if (!userId) return unlearned(1);

  const record = model.managers.get(userId);
  if (!record || model.meanTrades <= 0) return unlearned(1);

  const estimate = record.trades / model.meanTrades;
  const weight = model.meanTrades / (model.meanTrades + APPETITE_PRIOR);

  return blend(estimate, 1, weight, record.trades);
}

/** The manager holding a roster this season, or null for an orphan team. */
export function managerFor(model: ManagerModel, rosterId: number): ManagerRecord | null {
  const userId = model.rosters.get(rosterId);
  return userId ? (model.managers.get(userId) ?? null) : null;
}

/**
 * What two managers have done together.
 *
 * Deliberately not a factor. Partner history predicts out of sample — past
 * pairing beats appetite alone at r=0.40 and r=0.26 on the two test leagues —
 * but it buys 0.036 of deviance where appetite buys 1.47, and its shrinkage
 * constant lands six-fold apart on the two. It is a fact worth telling a manager
 * about his own league, and not a number worth ranking on, so this returns a
 * count and no estimate at all.
 */
export function partnership(
  model: ManagerModel,
  a: string | null,
  b: string | null,
): Partnership | null {
  if (!a || !b || a === b) return null;

  const record = model.managers.get(a);
  const other = model.managers.get(b);
  if (!record || !other) return null;

  const trades = record.partners.get(b) ?? 0;
  if (trades === 0) return null;

  let most = 0;
  for (const manager of model.managers.values()) {
    for (const count of manager.partners.values()) most = Math.max(most, count);
  }

  /*
    The pair's own span, not the league's. Two managers who first traded in 2025
    have not been trading "since 2023" whatever the league has been doing, so
    this is the later of the two first seasons — the point from which both were
    around to trade with each other at all.
  */
  const since =
    record.firstTraded && other.firstTraded
      ? (record.firstTraded > other.firstTraded ? record.firstTraded : other.firstTraded)
      : (record.firstTraded ?? other.firstTraded);

  return { trades, strongest: trades >= most, since };
}
