/**
 * Point the roster measures at a real league and print what they say.
 *
 * The engine's arithmetic is fixture-tested, and a fixture can only prove that
 * a measure does what it was written to do. It cannot say whether the thing it
 * measures *happens* — whether a slot weakness fires on two rosters in ten or
 * on all of them, whether a warning is signal or furniture, whether a search
 * that generates a shape in a contrived league generates it in a real one.
 * Those are questions about the world, and the only way to answer them is to
 * run against the world.
 *
 * Both #64 and #65 shipped with that question open. This is how it was closed,
 * kept so the next change to either can close it again in one command:
 *
 *     npm run check:slots -- <leagueId>
 *
 * Not in CI, and it should not be: it needs a league id and three live
 * endpoints, so it fails for reasons that have nothing to do with the code
 * under test. It is a thing you run when you have changed a measure and want to
 * know what it does to real rosters.
 *
 * Drives the app's own pipeline — `loadLeague`, `fetchFantasyCalcValues`,
 * `valueLeague` — rather than reimplementing it, and feeds the suggestion
 * engine every input the app does: league-adjusted values, activity and the
 * league's scoring from the files under `public/data`, role trends, the
 * claimable free-agent wire and the live playoff odds. Checked on the test
 * league on 2026-09-26, it reports the same suggestions, team by team, as the
 * Trade ideas tab (#138).
 *
 * The one input left out is the manager model: it needs a request per week per
 * season to build, and it only scales the score of offers that already cleared
 * the bar. That can change which offers make the top six for a team with more
 * than six, never how many there are, so the counts here are unaffected by it.
 *
 * That parity is load-bearing. Before it, this script handed the engine raw
 * market prices and no wire, odds, activity or scoring, and reported 16
 * suggestions where the app showed 14 — which read as a feature working when it
 * was not.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sleeperProvider } from '../src/platforms/sleeper';
import { snapShares } from '../src/engine/snapShare';
import { opportunities } from '../src/engine/opportunity';
import { checkScoring, scoringIsUsable } from '../src/engine/scoringCheck';
import { roleTrends } from '../src/engine/roleTrend';
import { fetchFantasyCalcValues } from '../src/values/fantasycalc';
import { fetchPickValues } from '../src/values/dynastyprocess';
import { buildDraftPicks, tradeableSeasons } from '../src/engine/picks';
import { valueLeague } from '../src/engine/replacement';
import { analyzeTeam, futureLineup, leagueDemand } from '../src/engine/analysis';
import { bucketRoster, type Bucket } from '../src/engine/buckets';
import { bareSlots, fragility, slotStrengths } from '../src/engine/rosterDepth';
import { suggestTrades } from '../src/engine/suggest';
import { claimableFreeAgents, freeAgentBoard } from '../src/engine/freeAgents';
import {
  calibrate,
  playedFixtures,
  remainingFixtures,
  simulate,
  teamStates,
} from '../src/engine/playoffOdds';
import { regularSeasonWeek } from '../src/engine/season';
import type { SeasonOdds } from '../src/engine/analysis';
import type { RosterSummary } from '../src/engine/rosterValue';

const leagueId = process.argv[2];
if (!leagueId) {
  console.error('usage: npm run check:slots -- <leagueId>');
  process.exit(1);
}

const round = (n: number) => Math.round(n).toLocaleString();
const share = (n: number, of: number) => (of === 0 ? '0%' : `${Math.round((n / of) * 100)}%`);
const pad = (s: string) => s.padEnd(22).slice(0, 22);

/** Players only. A pick occupies no roster spot and fills no slot. */
const bodies = (assets: { kind: string }[]) => assets.filter((a) => a.kind === 'player').length;

const BUCKETS: Bucket[] = ['core', 'depth', 'depreciating', 'lottery', 'dead'];

async function main() {
  const bundle = await sleeperProvider.loadLeague(leagueId);
  const { league, players } = bundle;
  const name = (rosterId: number) =>
    league.rosters.find((r) => r.rosterId === rosterId)?.teamName ?? `roster ${rosterId}`;

  console.log(`\n${league.name} — ${league.rosters.length} teams, ${league.season}`);
  console.log(`slots: ${league.settings.startingSlots.join(', ')}`);

  const values = await fetchFantasyCalcValues(league.settings);

  /*
    Everything else the app feeds the model, read the way `useLeagueData` reads
    it. The activity and scoring files the app fetches from `/data` are the
    same files committed under `public/data`, so they are read from disk.
    Without them this script priced a different league than the app shows, and
    said so only in a comment: on the test league it once reported 16 trade
    suggestions where the app showed 14 (#138).
  */
  const file = <T,>(name: string): T | null => {
    try {
      return JSON.parse(
        readFileSync(fileURLToPath(new URL(`../public/data/${name}`, import.meta.url)), 'utf8'),
      ) as T;
    } catch {
      return null;
    }
  };
  type SnapFile = Parameters<typeof snapShares>[0];
  type UsageFile = Parameters<typeof opportunities>[0];
  type ScoringStats = NonNullable<Parameters<typeof checkScoring>[0]>;
  const snapFile = file<SnapFile>('snaps.json');
  const usageFile = file<UsageFile>('opportunity.json');
  const scoringFile = file<ScoringStats>('scoring.json');
  const snaps = snapFile ? snapShares(snapFile) : undefined;
  const usage = usageFile ? opportunities(usageFile) : undefined;

  // Activity counts only for the season being played, as in the app.
  const played = Number(bundle.currentSeason);
  const snapsLive = snapFile?.season === played;
  const usageLive = usageFile?.season === played;
  const activity = {
    snaps: snapsLive && snaps ? snaps : new Map(),
    usage: usageLive && usage ? usage : new Map(),
    current: snapsLive || usageLive,
  };

  // The schedule carries both the awarded points the scoring check needs and
  // the fixtures the playoff odds need, so it is loaded once, here.
  const weeksTotal = league.settings.playoffWeekStart - 1;
  const schedule =
    sleeperProvider.loadSchedule && weeksTotal > 0
      ? await sleeperProvider.loadSchedule(leagueId, weeksTotal)
      : null;

  // The league's own scoring corrects market prices only where this engine
  // reproduces it — the gate the app applies.
  const fidelity = checkScoring(scoringFile, schedule?.awarded, league.settings.scoring);
  const scoringStats = scoringIsUsable(fidelity) ? scoringFile : null;

  const valuation = valueLeague(
    league.rosters,
    players,
    values.bySleeperId,
    league.settings,
    activity,
    scoringStats,
  );
  const trends = roleTrends({
    summaries: valuation.summaries,
    values: valuation.values,
    snaps,
    usage,
    current: activity.current,
  });
  console.log(
    `activity: ${activity.current ? 'this season' : 'not this season, factors at 1'} · scoring: ${fidelity.verdict}${scoringStats ? ', applied' : ', not applied'}`,
  );
  const summaries: RosterSummary[] = [...valuation.summaries].sort(
    (a, b) => b.starterValue - a.starterValue,
  );

  /*
    Picks are not optional here, and running without them is the trap this
    comment exists to stop the next person falling into. `balancePackage` closes
    an uneven gap with a draft pick, so a search handed an empty pick list
    rejects most packages before it ever evaluates one — and reports zero
    suggestions, which looks exactly like a feature that does not work.
  */
  const pickTable = await fetchPickValues(league.settings);
  const picks = buildDraftPicks(
    league,
    bundle.tradedPicks,
    tradeableSeasons(bundle.currentSeason, pickTable.seasons, league),
    pickTable,
    // Rookie order is the reverse of the standings; `summaries` is sorted
    // strongest-first, as `useLeagueData` does it.
    [...summaries].reverse().map((s) => s.rosterId),
    valuation.shrink,
    bundle.draftOrders,
  );
  console.log(`picks: ${picks.length} tradeable`);

  /*
    The waiver wire, as the app builds it — and not optional, for the same
    reason picks are not. Since #114 the engine refuses to propose paying for a
    player the wire gives away, so a search run without it proposes trades the
    app never shows. On the test league it once reported 16 suggestions where
    the app showed 14, every extra one a quarterback purchase with Bo Nix
    unrostered (#138). Priced against the rostered pool's own levels, and
    narrowed to who could be claimed today, exactly as `useLeagueData` does.
  */
  const board = freeAgentBoard({
    freeAgents: bundle.freeAgents,
    market: values.bySleeperId,
    levels: valuation.levels,
    snaps,
    usage,
    current: activity.current,
  });
  const claimable = claimableFreeAgents(board, league, bundle.currentSeason);
  console.log(`free agents: ${board.all.length} on the wire, ${claimable.length} claimable and priced`);

  /*
    The live playoff odds, built the way `useLeagueData` builds them and for the
    same reason the wire is here: the engine reads them. `windowWeights` moves a
    team whose season is slipping towards the future (#66), so a 0-2 roster is
    not told to spend picks on a quarterback — and without the odds this script
    told it exactly that. Only in the regular season, as in the app.
  */
  let season: SeasonOdds | undefined;
  const week = regularSeasonWeek(bundle.currentWeek, bundle.seasonPhase, weeksTotal);
  if (bundle.seasonPhase === 'regular' && week !== null && schedule) {
    const teams = teamStates(league, summaries);
    const odds = simulate({
      teams,
      remaining: remainingFixtures(schedule.matchups, week, league.settings.playoffWeekStart),
      playoffTeams: league.settings.playoffTeams,
      model: calibrate(teams, playedFixtures(schedule.matchups)),
    });
    season = {
      odds: new Map(odds.map((o) => [o.rosterId, o.odds])),
      weeksPlayed: Math.min(Math.max(week - 1, 0), weeksTotal),
      weeksTotal,
    };
    console.log(`playoff odds: week ${week} of ${weeksTotal}`);
  } else {
    console.log(`playoff odds: none (${bundle.seasonPhase})`);
  }

  console.log('\n=== SLOT STRENGTH ===');
  let weakTotal = 0;
  let strongTotal = 0;
  let slotTotal = 0;
  for (const summary of summaries) {
    const slots = slotStrengths(summary, summaries);
    const weak = slots.filter((s) => s.verdict === 'weakness');
    weakTotal += weak.length;
    strongTotal += slots.filter((s) => s.verdict === 'strength').length;
    slotTotal += slots.length;
    console.log(
      `  ${pad(name(summary.rosterId))} weak ${weak.length} (${
        weak.map((w) => w.label).join(',') || '-'
      })`,
    );
  }
  console.log(
    `  ${weakTotal} weaknesses, ${strongTotal} strengths across ${slotTotal} slots ` +
      `(${share(weakTotal, slotTotal)} / ${share(strongTotal, slotTotal)})`,
  );

  /*
    The headline check. A slot weakness the position sum reports as neutral or
    as a strength is the defect #64 exists to fix, and this is the count of them
    that a real league actually contains.
  */
  console.log('\n=== HOLES THE POSITION SUM DOES NOT REPORT ===');
  let hidden = 0;
  for (const summary of summaries) {
    const analysis = analyzeTeam(summary.rosterId, summaries, league.settings);
    if (!analysis) continue;

    for (const slot of analysis.slotWeaknesses) {
      const positions = analysis.positions.filter((p) => slot.label.startsWith(p.position));
      if (positions.length === 0 || positions.every((p) => p.verdict === 'weakness')) continue;

      hidden++;
      console.log(
        `  ${pad(name(summary.rosterId))} ${slot.label} ${round(slot.value)} vs median ` +
          `${round(slot.leagueMedian)} (${slot.rank}/${slot.teamCount}) — position reads ` +
          positions.map((p) => `${p.position}=${p.verdict}`).join(','),
      );
    }
  }
  console.log(`  ${hidden} of ${weakTotal} slot weaknesses are invisible to the position sum.`);

  /*
    Watch the kickers here. A league that starts a K and a DEF gives every
    roster two permanently uncovered slots, and the `marginalValue > 0` filter
    is the only thing stopping that becoming a warning on every team every week.
    If a kicker ever appears in this section, the filter has stopped working.
  */
  console.log('\n=== FRAGILITY ===');
  for (const summary of summaries) {
    const f = fragility(summary, league.settings.startingSlots);
    const bare = bareSlots(f.starters);
    console.log(
      `  ${pad(name(summary.rosterId))} bare ${f.uncoveredSlots}  worst drop ${round(f.worstDrop)}` +
        (bare.length > 0
          ? `  [${bare.map((b) => `${b.entry.player.name} ${b.slotLabel}`).join(', ')}]`
          : ''),
    );
  }

  console.log('\n=== BUCKETS (share of dynasty value) ===');
  const demand = leagueDemand(summaries);
  for (const summary of summaries) {
    const out = bucketRoster({
      summary,
      futureStarterIds: new Set(
        futureLineup(summary, league.settings)
          .map((s) => s.entry?.player.id)
          .filter((id): id is string => Boolean(id)),
      ),
      demand,
      picks: picks.filter((p) => p.ownerRosterId === summary.rosterId),
    });

    console.log(
      `  ${pad(name(summary.rosterId))} ` +
        BUCKETS.map((b) => `${b} ${out.count[b]} (${share(out.value[b], out.total)})`).join('  '),
    );
  }

  console.log('\n=== SUGGESTIONS ===');
  let uneven = 0;
  let found = 0;
  for (const summary of summaries) {
    const result = suggestTrades(summary.rosterId, {
      league,
      players,
      // League-adjusted, as the app passes them — not the raw market the
      // valuation started from. Handing the engine raw prices beside rosters
      // valued in adjusted ones was a second, older gap between this script
      // and the app.
      values: valuation.values,
      picks,
      summaries,
      claimable,
      season,
      trends,
    });
    found += result.trades.length;

    console.log(
      `  ${pad(name(summary.rosterId))} considered ${String(result.considered).padStart(4)}  ` +
        `found ${result.trades.length}  [${
          result.trades.map((t) => `${bodies(t.give)}-for-${bodies(t.get)}`).join(', ') || '-'
        }]` +
        // Why the rest failed, as the empty Trade ideas tab now says (#133).
        `  rejected: uneven ${result.rejections.unbalanced}, worse ${result.rejections.someoneWorse}, ` +
        `roster ${result.rejections.overRoster}, small ${result.rejections.tooSmall}`,
    );

    // The uneven ones in full, since they are the shapes #65 added and the only
    // way to tell a real consolidation from an arithmetic accident is to read it.
    for (const trade of result.trades) {
      if (bodies(trade.give) === bodies(trade.get)) continue;
      uneven++;
      console.log(`      give ${trade.give.map((a) => a.label).join(' + ')}`);
      console.log(`      get  ${trade.get.map((a) => a.label).join(' + ')}`);
      console.log(`      to   ${trade.partnerName}`);
      for (const line of trade.rationale) console.log(`        · ${line}`);
      for (const line of trade.whyTheySayYes) console.log(`        » ${line}`);
    }
  }
  console.log(`  ${found} suggestions, ${uneven} of them uneven (${share(uneven, found)}).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
