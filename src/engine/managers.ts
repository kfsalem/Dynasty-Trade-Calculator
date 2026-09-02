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
  partners: Map<string, PartnerRecord>;
  /** Earliest season he traded in. Null when he never has. */
  firstTraded: string | null;
  /**
   * Seasons the league's own tables name him in, traded or not.
   *
   * Tenure, and the reason `appetite` can weigh a manager who joined this year
   * against one who has been here four. Counted from the roster tables rather
   * than from `firstTraded`, which is silent about exactly the manager the
   * model most needs to get right: the one who has been in this league for
   * years and never traded once.
   */
  seasons: number;
}

/**
 * What one pair has done together.
 *
 * The season here is the pair's own. Each manager's `firstTraded` says when
 * *he* started trading, which is a different fact and not one a sentence about
 * the two of them is entitled to borrow.
 */
export interface PartnerRecord {
  trades: number;
  /** Earliest season the pair traded with each other in. */
  since: string;
}

export interface ManagerModel {
  /** Keyed by `userId`. Everyone the league's own tables name. */
  managers: Map<string, ManagerRecord>;
  /**
   * Current-season roster id to `userId`, so a caller holding a roster can find
   * a manager without having to know that the two are different kinds of thing.
   */
  rosters: Map<number, string>;
  /**
   * Current-season roster ids the league's own table gives no owner.
   *
   * Held apart from a roster the walk simply never saw, because the two are
   * different states of knowledge: this one is the table saying nobody owns the
   * team, and `appetiteFor` is entitled to act on it.
   */
  orphans: Set<number>;
  /** Completed trades every side of which could be attributed to somebody. */
  trades: number;
  /**
   * Trades touching a team nobody owned. Skipped, never guessed at — one test
   * league carries an orphan through a whole season, and 12 of its 137 trades
   * involve it.
   */
  unattributed: number;
  /**
   * Mean trades per manager *per season* — the rate at which one season of one
   * manager is unremarkable, and what `expectedTrades` scales by tenure to get
   * the `m` in `(k + c)/(m + c)`.
   *
   * Per season rather than per manager, because the denominator has to survive
   * turnover. A manager who joined this year has not had four seasons in which
   * to make four seasons' worth of trades, and measuring him against a total
   * that spans them reads the busiest trader in the league as a quiet one.
   */
  tradesPerSeason: number;
  /**
   * What a manager of typical tenure in this roll has completed. Used for one
   * thing: the expectation to hold an *unowned* roster to, which has no tenure
   * of its own to scale by.
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
  /** Earliest season the pair traded with each other in. */
  since: string;
}

const EMPTY: ManagerModel = {
  managers: new Map(),
  rosters: new Map(),
  orphans: new Set(),
  trades: 0,
  unattributed: 0,
  tradesPerSeason: 0,
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
  const named = (userId: string, name = userId): ManagerRecord => {
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
      seasons: 0,
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

    Every season, not only the newest, because tenure is what `appetite`
    measures a manager's count against and a manager who left after 2024 still
    took his seasons' worth of the league's trading with him. Newest first, so
    the name a record carries is the one he goes by now.
  */
  const newestFirst = [...history.managers.keys()].sort().reverse();
  const rosters = new Map<number, string>();
  const orphans = new Set<number>();
  const current = newestFirst[0];
  if (current) {
    for (const [rosterId, manager] of history.managers.get(current) ?? []) {
      if (manager.userId) rosters.set(rosterId, manager.userId);
      else orphans.add(rosterId);
    }
  }

  for (const season of newestFirst) {
    const counted = new Set<string>();
    for (const manager of history.managers.get(season)?.values() ?? []) {
      if (!manager.userId || counted.has(manager.userId)) continue;
      counted.add(manager.userId);
      named(manager.userId, manager.name).seasons++;
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
      const record = named(userId);
      record.trades++;
      /*
        Oldest wins. Recorded and not currently rendered: the card used to
        date a manager's count from it, which paired a lifetime figure with a
        season and read as a claim about tenure. `seasons` is the tenure now,
        and this stays for the same reason `claims` and the pick counts do —
        it is an exact count off a pass already being made.
      */
      if (!record.firstTraded || transaction.season < record.firstTraded) {
        record.firstTraded = transaction.season;
      }
      for (const other of sides) {
        if (other === userId) continue;
        const pair = record.partners.get(other);
        // Oldest wins here too, and the season kept is the pair's own — the
        // first time these two traded with each other, whatever either of them
        // was doing with the rest of the league before that.
        if (!pair) record.partners.set(other, { trades: 1, since: transaction.season });
        else {
          pair.trades++;
          if (transaction.season < pair.since) pair.since = transaction.season;
        }
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
  const managerSeasons = roll.reduce((total, record) => total + record.seasons, 0);

  return {
    managers: records,
    rosters,
    orphans,
    trades,
    unattributed,
    tradesPerSeason: managerSeasons > 0 ? participations / managerSeasons : 0,
    meanTrades: roll.length > 0 ? participations / roll.length : 0,
    seasons: [...tradedSeasons].sort(),
    truncated: history.truncated,
  };
}

/**
 * How much likelier than average this manager is to act on an offer.
 *
 * Two steps, and they answer different questions.
 *
 * **The rate**, `(k + c)/(m + c)`, where `k` is his completed trades and `m` is
 * what the league's own rate alone predicts for him. This is the measured half
 * — what the constant above was fitted against, and what the split-half test
 * showed predicts.
 *
 * `m` is his own, not the league's, and that is what `expectedTrades` is for.
 * A rate compared against a multi-season total is a claim about tenure wearing
 * a claim about appetite: a manager who joined this year and has already made
 * six trades — the busiest trader of the current season — measures 6 against
 * four seasons of everyone else and is demoted for it, and the card then says
 * out loud that he trades less than his league does. Scaling the expectation by
 * the seasons he has actually been here is the whole of the fix.
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
 * **The transform**, a square root, and this one is a modelling choice rather
 * than a measurement — the honest place where this engine stops knowing.
 *
 * A completed-trade count is the product of two things: how often a manager is
 * *asked*, and how often he says yes. The score needs only the second, and no
 * published field separates them, because nothing publishes a declined trade.
 * Two readings bracket the answer:
 *
 * - **Linear** — the whole gap is willingness. A manager who completes twice as
 *   many trades accepts twice as readily.
 * - **Square root** — engagement lifts both alike, so a manager asked `e` times
 *   as often who says yes `e` times as readily completes `e²` of them, and his
 *   acceptance rate is the root of his trade rate.
 *
 * The root is taken, deliberately conservatively. Measured across both leagues,
 * linear promotes an offer worth 36% less in two-sided benefit into a team's
 * top slot; the root drops the marginal reorderings and keeps the decisive
 * ones. Where the evidence runs out the smaller claim is the one to make — and
 * note that it is the *transform* being assumed here, never the rate.
 *
 * Applied after the shrinkage and never before it. The constant was measured
 * against rates, so shrinking a rooted estimate toward 1.0 would be applying a
 * calibration to a quantity it was never calibrated on.
 *
 * A league with no trades at all gives `sqrt((0 + c)/(0 + c))` — one, exactly,
 * for everybody, which is the app as it was before this existed.
 */
export function appetite(model: ManagerModel, userId: string | null): Learned<number> {
  if (!userId) return unlearned(1);

  const record = model.managers.get(userId);
  if (!record) return unlearned(1);

  const expected = expectedTrades(model, record);
  if (expected <= 0) return unlearned(1);

  const weight = expected / (expected + APPETITE_PRIOR);
  const rate = blend(record.trades / expected, 1, weight, record.trades);

  // `prior` survives the transform unchanged, the root of one being one.
  return { ...rate, value: Math.sqrt(rate.value) };
}

/**
 * Trades a manager of this tenure is expected to have made — the `m` above.
 *
 * Exported because the card has to be able to say what the count was measured
 * against. A sentence that quotes `k` and a denominator the reader cannot see
 * is not an explanation.
 */
export function expectedTrades(model: ManagerModel, record: ManagerRecord): number {
  return model.tradesPerSeason * record.seasons;
}

/**
 * The factor to rank an offer to a *roster* by, unowned teams included.
 *
 * Three states, and they are genuinely different. A roster with an owner is his
 * record. A roster this walk never saw is nothing known, and gets the prior.
 * And a roster the league's own table names and gives no owner is not an
 * unknown at all — it is a team with nobody reading the message, and ranking it
 * at the league's average acceptance put it above every real manager who trades
 * below that average, which is the one ordering this data will not support.
 *
 * So the orphan is held to the same arithmetic as a manager who has completed
 * nothing, against the expectation of a manager of typical tenure here. A
 * demotion and not a filter, for the reason every other term here is one:
 * orphan teams do trade — one test league's carries twelve of that league's —
 * and whoever is running it may well answer. They are simply not evidence of an
 * average appetite, and the model should stop implying that they are.
 */
export function appetiteFor(model: ManagerModel, rosterId: number): Learned<number> {
  const userId = model.rosters.get(rosterId);
  if (userId) return appetite(model, userId);
  if (!model.orphans.has(rosterId) || model.meanTrades <= 0) return unlearned(1);

  const weight = model.meanTrades / (model.meanTrades + APPETITE_PRIOR);
  const rate = blend(0, 1, weight, 0);
  return { ...rate, value: Math.sqrt(rate.value) };
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

  const pair = record.partners.get(b);
  if (!pair || pair.trades === 0) return null;

  let most = 0;
  for (const manager of model.managers.values()) {
    for (const theirs of manager.partners.values()) most = Math.max(most, theirs.trades);
  }

  /*
    The pair's own first season, carried on the pair record itself. Deriving it
    from the two managers' `firstTraded` — the later of the two, on the theory
    that it is when both were around — dates the pair from a season they may
    never have traded in: two managers who each traded with other people in
    2023 and first traded with each other in 2026 rendered as "since 2023",
    which is a claim about their shared history the data never made.
  */
  return { trades: pair.trades, strongest: pair.trades >= most, since: pair.since };
}
