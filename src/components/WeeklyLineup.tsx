import { useMemo, useState } from 'react';
import type { LeagueSettings, Roster, SeasonPhase } from '../types';
import type { RosterSummary, ValuedPlayer } from '../engine/rosterValue';
import { startSit, CLEAR_MARGIN, type LineupChange } from '../engine/startSit';
import { wireUpgrades, type WireUpgrade } from '../engine/wire';
import type { FreeAgentBoard } from '../engine/freeAgents';
import { playingTime } from '../engine/freeAgents';
import { isGameWeek } from '../engine/season';
import { injuryNote } from '../engine/availability';
import { formatInjury, formatSlot, formatValue, POSITION_STYLES } from '../lib/format';
import { changeAction, describeChange } from '../lib/lineupText';

interface Props {
  roster: Roster;
  summary: RosterSummary;
  settings: LeagueSettings;
  /** Where the NFL calendar stands, so the panel knows whether a game is next. */
  seasonPhase: SeasonPhase | undefined;
  currentWeek: number | null;
  /**
   * Teams with no game this week. Empty means no claim, not an empty schedule —
   * see `engine/byes`.
   */
  byeTeams?: ReadonlySet<string> | null;
  /**
   * The waiver wire, priced. Undefined until it loads, and the panel simply
   * says nothing about free agents until then.
   */
  board?: FreeAgentBoard;
  /** Whether the activity data describes the season being played. */
  activityCurrent?: boolean;
}

/**
 * The lineup panel: what you have set, against what you could field.
 *
 * First thing on the tab, above the contention window, and that ordering is the
 * feature. Everything else here answers a question a manager asks twice a
 * season; this answers the one he asks every week, and it is the only surface
 * in the app with a deadline attached to it.
 *
 * Two registers, decided by `isGameWeek`. In the regular season a game is next
 * and the panel is a correction: a week number, a gain, and rows to act on. Out
 * of season nothing is next, so the same comparison is offered as information —
 * the same rows, no urgency, no "this week". Between February and September the
 * alternative was a panel that either vanished for seven months or spent them
 * shouting about a Sunday that does not exist.
 */
export function WeeklyLineup({
  roster,
  summary,
  settings,
  seasonPhase,
  currentWeek,
  byeTeams,
  board,
  activityCurrent = false,
}: Props) {
  const [showLineup, setShowLineup] = useState(false);

  const plan = useMemo(
    () =>
      startSit({
        entries: summary.players,
        startingSlots: settings.startingSlots,
        setLineup: roster.setLineup,
        byeTeams,
      }),
    [summary.players, settings.startingSlots, roster.setLineup, byeTeams],
  );

  const wire = useMemo(
    () =>
      wireUpgrades({
        lineup: plan.lineup,
        entries: summary.players,
        board,
        byeTeams,
      }),
    [plan.lineup, summary.players, board, byeTeams],
  );

  const gameWeek = isGameWeek(seasonPhase ?? 'unknown');
  /**
   * Whether byes are actually being applied, so the disclaimer can say which.
   *
   * A panel that claims to check byes and silently is not would be worse than
   * the one that admitted it never did — a manager who trusts the sentence
   * stops checking for himself.
   *
   * Null, not empty: weeks 1-4, 12 and 15-18 of a real season have no byes in
   * them, and "nobody is off this week" is data rather than the lack of it.
   */
  const knowsByes = byeTeams != null;
  const eyebrow =
    gameWeek && currentWeek !== null ? `Week ${currentWeek} lineup` : 'Your best lineup';

  /*
    The headline counts what the panel is actually claiming, not how many slots
    differ. A count that includes coin flips trains the reader to skim all of
    them, and the two rows that matter — an empty slot, a starter who is out —
    lose their urgency to the noise beside them.
  */
  const changes = plan.decisive.length;
  const headline = plan.unset
    ? 'No lineup set yet'
    : changes === 0
      ? gameWeek
        ? 'Your lineup is the best you can field'
        : 'Nothing to change'
      : `${changes} ${changes === 1 ? 'change' : 'changes'} to make`;

  /*
    Best ball has no lineup decision in it — the platform scores each team's
    optimal lineup after the games, so there is nothing to set and nothing to
    get wrong. Every sentence below this point is about a choice the manager
    does not make, which makes the whole panel a confident answer to a question
    this league never asks.

    After the hooks rather than before them, because React requires it: the
    plan and the wire are computed and discarded here, which costs one pass over
    a thirty-player roster and keeps the rule inside the component that is
    wrong without it.
  */
  if (settings.bestBall) {
    return (
      <section className="card">
        <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
          Weekly lineup
        </p>
        <h3 className="mt-1 text-lg font-bold tracking-tight">
          Best ball — no lineup to set
        </h3>
        <p className="mt-2 text-sm text-muted">
          This league scores each team's best possible lineup automatically once the
          games are done, so there is no start/sit call to make and no way to leave
          points on your bench. The rest of the app still applies: what your roster is
          worth, where it is thin, and who is worth acquiring are the same questions
          here as anywhere.
        </p>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-subtle">
            {eyebrow}
          </p>
          <h3 className="mt-1 text-lg font-bold tracking-tight">{headline}</h3>
        </div>
        {plan.gain > 0 && (
          /* Signed, not just green: colour alone never carries a direction here,
             and the plus is what makes this a delta rather than a total. */
          <p className="tabular text-lg font-bold text-positive">
            +{formatValue(plan.gain)}
          </p>
        )}
      </div>

      <p className="mt-2 text-sm text-subtle">
        {plan.unset
          ? 'Nothing has been set on the platform to compare against, so this is a recommendation rather than a correction.'
          : gameWeek
            ? knowsByes
              ? 'Ranked on win-now value — season-long, corrected for role, who can actually play, and who is on bye. Not a weekly projection: no matchups.'
              : 'Ranked on win-now value — season-long, corrected for role and who can actually play. Not a weekly projection: no matchups, and bye weeks could not be loaded.'
            : 'Ranked on win-now value. No game is next, so this is the lineup this roster can field rather than a call for Sunday.'}
      </p>

      {changes > 0 && (
        <ul className="mt-4 space-y-3">
          {plan.decisive.map((change) => (
            <ChangeRow key={`${change.slot}-${change.index}`} change={change} />
          ))}
        </ul>
      )}

      {plan.marginal.length > 0 && <Marginal changes={plan.marginal} />}

      {wire.length > 0 && <Wire upgrades={wire} activityCurrent={activityCurrent} />}

      {plan.watch.length > 0 && (
        <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
          <span className="font-semibold">
            {gameWeek ? 'Worth checking again before kickoff: ' : 'Carrying a designation: '}
          </span>
          {plan.watch.map((entry, i) => (
            <span key={entry.player.id}>
              {i > 0 && ', '}
              <span title={entry.player.injury && injuryNote(entry.player.injury)}>
                {entry.player.name}
                {entry.player.injury ? ` (${formatInjury(entry.player.injury)})` : ''}
              </span>
            </span>
          ))}
          . They are in the lineup — most questionable players play — but they are the
          ones that can still change.
        </p>
      )}

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setShowLineup((open) => !open)}
          aria-expanded={showLineup}
          aria-controls="weekly-lineup-slots"
          className="text-sm font-medium text-accent"
        >
          {showLineup ? 'Hide the full lineup' : 'Show the full lineup'}
        </button>

        {showLineup && (
          <ul id="weekly-lineup-slots" className="rise-in mt-3 space-y-1">
            {plan.lineup.map((assignment, index) => {
              const changed = plan.changes.some((change) => change.index === index);
              return (
                <li
                  key={`${assignment.slot}-${index}`}
                  className="flex items-center gap-2 py-3 text-sm fine:py-1.5"
                >
                  <span className="w-12 shrink-0 text-xs font-semibold uppercase tracking-wide text-subtle">
                    {formatSlot(assignment.slot)}
                  </span>
                  {assignment.entry ? (
                    <>
                      <PositionChip entry={assignment.entry} />
                      <span className="min-w-0 flex-1 truncate">
                        {assignment.entry.player.name}
                        {changed && (
                          <span className="ml-1.5 text-xs font-semibold text-accent">
                            new
                          </span>
                        )}
                      </span>
                      <span className="tabular shrink-0 text-subtle">
                        {formatValue(assignment.entry.winNowValue)}
                      </span>
                    </>
                  ) : (
                    <span className="flex-1 italic text-subtle">
                      nobody eligible on this roster
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/**
 * The swaps the app will not argue for, folded away but not hidden.
 *
 * These are real disagreements between the lineup you have set and the best one
 * — they are simply too close to call. Values here are season-long and carry no
 * matchup, so a two-percent edge is inside the noise of a single Sunday, and
 * printing it as a correction claims a precision the model does not have.
 *
 * Still reachable, because "too close to call" is itself an answer a manager may
 * want, and because silently discarding a difference the app can see would be a
 * worse habit than showing it quietly.
 */
function Marginal({ changes }: { changes: LineupChange[] }) {
  const count = changes.length;
  return (
    <details className="mt-4 border-t border-line pt-3">
      <summary className="cursor-pointer text-sm font-medium text-accent">
        {count} {count === 1 ? 'swap' : 'swaps'} too close to call
      </summary>
      <p className="mt-2 text-xs text-muted">
        Within {Math.round(CLEAR_MARGIN * 100)}% on win-now value. Worth knowing about,
        not worth acting on.
      </p>
      <ul className="mt-3 space-y-3">
        {changes.map((change) => (
          <ChangeRow key={`${change.slot}-${change.index}`} change={change} />
        ))}
      </ul>
    </details>
  );
}

/**
 * Free agents who beat somebody you are starting.
 *
 * The panel used to stop at the edge of the roster, which meant it could say
 * "start Smith over Jones" and not the more useful thing — that the best man at
 * the position is unrostered. On the real ten-team league seven of a hundred
 * starting slots held somebody the wire would beat, five of them quarterbacks,
 * which is what a 1QB league guarantees: ten teams start ten of them, so QB11 is
 * always available and somebody is always starting worse.
 *
 * The drop is named because nearly every claim is an add/drop and a
 * recommendation that ignores the cost is only half of one.
 */
function Wire({
  upgrades,
  activityCurrent,
}: {
  upgrades: WireUpgrade[];
  activityCurrent: boolean;
}) {
  return (
    <section className="mt-4 rounded-lg border border-accent bg-accent-soft/60 p-4">
      <h4 className="text-sm font-semibold text-accent">
        {upgrades.length === 1 ? 'A free agent beats' : 'Free agents beat'} your lineup
      </h4>
      <p className="mt-1 text-xs text-accent/90">
        Unrostered, and priced against this league's replacement levels — so these
        numbers mean the same thing as everyone else's.
      </p>

      <ul className="mt-3 space-y-3">
        {upgrades.map((upgrade) => {
          const time = playingTime(upgrade.add.snaps);
          return (
            <li key={upgrade.add.player.id}>
              <div className="flex items-baseline gap-2">
                <span className="w-12 shrink-0 text-xs font-semibold uppercase tracking-wide text-accent/70">
                  {formatSlot(upgrade.slot)}
                </span>
                <span className="min-w-0 flex-1 font-medium">
                  <span className="text-accent/80">Add </span>
                  {upgrade.add.player.name}
                </span>
                <span className="tabular shrink-0 text-sm font-semibold text-positive">
                  +{formatValue(upgrade.addValue - upgrade.replaces.winNowValue)}
                </span>
              </div>
              <p className="mt-0.5 pl-14 text-xs text-muted">
                Better than {upgrade.replaces.player.name} in this slot.
                {/*
                  Playing time is evidence, never part of the ranking — the two
                  are different currencies and #46 is explicit that they are
                  never mixed. Labelled by season, because out of season the only
                  shares there are belong to last year.
                */}
                {time
                  ? ` ${Math.round(time.share * 100)}% of snaps${
                      time.recent ? ' lately' : ''
                    }${activityCurrent ? '' : ' last season'}.`
                  : ''}
                {upgrade.drop
                  ? ` Drop ${upgrade.drop.player.name} for him.`
                  : ' Nothing on your roster is obviously spare, so the claim costs you a choice.'}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function PositionChip({ entry }: { entry: ValuedPlayer }) {
  const style = POSITION_STYLES[entry.player.position];
  return (
    <span
      className={`inline-flex w-11 shrink-0 justify-center rounded px-1.5 py-0.5 text-xs font-semibold ${style.chip}`}
    >
      {style.label}
    </span>
  );
}

/**
 * One change, on two lines.
 *
 * The action and the value on the first, the reason on the second. At 375px
 * there is room for a slot label, a chip, a name and one number and nothing
 * else, so the sentence that explains the row gets its own line rather than
 * being cut to a word.
 */
function ChangeRow({ change }: { change: LineupChange }) {
  return (
    <li>
      <div className="flex items-baseline gap-2">
        <span className="w-12 shrink-0 text-xs font-semibold uppercase tracking-wide text-subtle">
          {formatSlot(change.slot)}
        </span>
        {change.start ? (
          <>
            <PositionChip entry={change.start} />
            {/*
              Wraps rather than truncates, unlike the roster tables. Those are
              scanned a column at a time and a clipped name is recoverable from
              the row around it; this row *is* the name — "Start Emeka Egb…" is
              the app failing to say the one thing it is here to say. Two lines
              on a phone is the cheaper price. See #18.
            */}
            <span className="min-w-0 flex-1 font-medium">
              <span className="text-muted">{changeAction(change)} </span>
              {change.start.player.name}
            </span>
          </>
        ) : (
          <span className="min-w-0 flex-1 text-muted">
            Nobody on your roster can fill this slot
          </span>
        )}
        {/*
          Priced only where somebody joins the lineup. A row that shuffles a
          starter between two slots is worth nothing on its own and can even
          net negative — the value it releases shows up on the row that spends
          it — so putting a figure on it would advertise a downgrade the plan is
          not making. The headline is the total for all of them together.
        */}
        {change.startIsNew && change.gain > 0 && (
          <span className="tabular shrink-0 text-sm font-semibold text-positive">
            +{formatValue(change.gain)}
          </span>
        )}
      </div>
      <p className="mt-0.5 pl-14 text-xs text-muted">{describeChange(change)}</p>
    </li>
  );
}
