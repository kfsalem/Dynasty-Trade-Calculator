# Roadmap

**Status lives in [#19](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/19), not here.**
Every item below is now a GitHub issue, and the issues move on their own. This
document duplicated their state as prose and drifted badly — it described three
finished milestones as future work for over a week. Keeping the checkboxes in
one place is the fix.

What this document is for now:

- **The research and rationale** behind the ordering — the durable part, and the
  part that does not fit in an issue body.
- **The specifications as written**, including the live-endpoint constraints
  behind R1 that are still the reason the ingest pipeline exists.

Each item carries its issue number and current state. Read it as the record of
why the work was ordered this way, not as a queue.

Research date: 2026-07-29. Data constraints in R1 were verified against live
endpoints that day and should be re-checked if they look wrong.

**As of 2026-08-19: R1–R10 and R12–R18 have shipped**, along
with #53's design brief. Milestones 1–3 and 5 are complete. What remains is R11
— **blocked**, see the CORS table under it — and the post-roadmap items at the
end.

---

## What the research found

### The community's actual complaint

The recurring criticism of trade calculators is not that the numbers are wrong.
It is that they answer the wrong question. The consensus across dynasty writing:

- *"Never accept or decline a trade just because the calculator says it's fair
  — fair value and team fit aren't the same thing."*
- *"'Losing the trade' implies both teams are trying to accomplish the same
  thing. Often they are not."* A rebuilder selling a veteran and a contender
  buying him can both be right.
- The two-test rule: value gap inside ~10%, **and** what you receive addresses a
  real roster need. Calculators do the first test and leave the second to you.

**This app already does the second test** — that is what VORS, the contention
quadrants, and "why they say yes" are. The strategic conclusion is to lean into
that, not rebuild toward parity with KeepTradeCut.

Specific valuation complaints worth knowing:

- KTC overvalues 1st-round rookie picks, and prices pick 23 about the same as
  pick 22 — no within-round granularity.
- FantasyCalc devalues future picks partly because it is agnostic about where
  they land.

Both are already addressed here (`pickRealismFactor` + `projectedSlots`), which
is worth saying out loud in the UI at some point. Still unsaid — tracked as
[#49](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/49), where it
turns out to be more than a missed boast: the realism curve prices a third-rounder
well below KeepTradeCut's quote, and a correction the user cannot see reads as a
bug.

### Competitive gaps

Dynasty Daddy ships multi-platform support (ESPN/Yahoo/Sleeper/MFL/Fleaflicker/
Fantrax/FFPC), power rankings with contender labels, a trade finder, a playoff
simulator, a start/sit tool, and a database of 3.6M+ real trades. KTC has power
rankings and its own crowd-sourced values.

Genuine gaps we could own, in rough order of differentiation:

1. **Weekly activity in the valuation** — nobody prices a player off his current
   role. This is R3–R7 and it is the most defensible thing on this list.
   **Shipped.**
2. Playoff odds tied to the trade you are considering. **Shipped** (R13).
3. Real trade market data for calibration. **Open** —
   [#48](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/48). The last
   unclaimed item on this list, and the one whose feasibility is least certain:
   it needs a bulk cross-league source available to a zero-backend static site,
   and no such source has been confirmed to exist.

### Why activity data is the right bet

Opportunity metrics are more *stable* than production, because touchdowns and
long catches bounce week to week while a player's share of targets does not.
Target share alone explains roughly 60–70% of the variance in per-game WR
fantasy points. WOPR — `1.5 × target_share + 0.7 × air_yards_share` — is the
standard composite and nflverse publishes it precomputed.

That is the mechanism by which this beats market value: the market reprices a
role change slowly, so a player whose snap share jumped three weeks ago is
mispriced *right now*.

---

# Milestone 1 — Data foundation ✅ Complete

Nothing in Milestone 2 could start until these two landed. Both have.

## R1 — Ingest nflverse at build time (CORS + size blocker)

**Status:** Shipped — [#1](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/1).
`scripts/ingest.ts`, `.github/workflows/ci-ingest.yml` and the scheduled
`refresh-data.yml` are the result. The constraints below are why it works this
way and are still worth reading before touching the pipeline.

**Labels:** `enhancement`

### The constraint

Weekly activity data lives in [nflverse-data](https://github.com/nflverse/nflverse-data)
releases. The app cannot fetch it directly, for two independent reasons — both
verified against live endpoints on 2026-07-29:

**1. No CORS.** Release assets redirect to `release-assets.githubusercontent.com`,
which sends no `Access-Control-Allow-Origin` header. A browser fetch from
`kfsalem.github.io` is blocked outright.

```
raw.githubusercontent.com            -> Access-Control-Allow-Origin: *   (dynastyprocess.ts uses this today)
release-assets.githubusercontent.com -> (no CORS header)                 (all nflverse releases)
```

**2. Size.** Some files are far past what a client should pull:

| file | size | usable in browser? |
|---|---|---|
| `rosters/roster_2025.csv` | 1.0 MB | yes |
| `snap_counts/snap_counts_2025.csv` | 2.4 MB | yes, if CORS allowed |
| `players/players.csv` | 7.3 MB | borderline |
| `stats_player/stats_player_week_2025.csv` | 8.5 MB | borderline |
| `depth_charts/depth_charts_2025.csv` | **53 MB** | no |

### Approach

Ingest at build time in CI; ship reduced JSON as static assets. Keeps the app a
zero-backend static site, solves CORS, and turns 53 MB into kilobytes.

- Add `scripts/ingest.ts`, run from `.github/workflows/deploy.yml` before `npm run build`.
- Fetch the CSVs, reduce hard (latest season, aggregate to per-player rows, drop
  unused columns), emit `public/data/*.json`.
- Key everything by **Sleeper id at ingest time** so the client never does
  crosswalk work — see R2.
- Commit a fallback copy so a nflverse outage cannot break a deploy.
- Add a scheduled workflow (weekly, Tuesday in season) so data refreshes without
  a code push.

### Acceptance

- [ ] `npm run ingest` produces `public/data/*.json`, total < 1 MB
- [ ] Deploy runs ingest; fetch failure falls back to the committed copy with a
      warning rather than breaking the deploy
- [ ] Output carries `generatedAt` + `throughWeek` so the UI can say "data
      through Week N"
- [ ] Schema drift in a source CSV fails the build with a readable error, rather
      than shipping silently-empty data
- [ ] Scheduled weekly refresh workflow

### References

`.github/workflows/deploy.yml` · `src/values/dynastyprocess.ts` (existing CSV
fetch pattern) · `src/lib/csv.ts` · `src/lib/cache.ts`

---

## R2 — Player ID crosswalk: Sleeper ↔ gsis ↔ pfr

**Status:** Shipped — [#2](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/2).

**Labels:** `enhancement`

### Problem

Every nflverse dataset keys on a different id, and none of them is the Sleeper id
the app runs on:

- `snap_counts` → `pfr_player_id`
- `stats_player_week` → `player_id` (gsis)
- app → Sleeper id (`Player.id`)

### Approach

DynastyProcess publishes a crosswalk at
`raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv`
(2.6 MB, **CORS-enabled**), carrying `sleeper_id`, `gsis_id`, `pfr_id`,
`espn_id`, `mfl_id`, `fleaflicker_id`, `ktc_id` and more.

Resolve it during R1's ingest so the shipped JSON is already Sleeper-keyed and
the client never loads 2.6 MB of crosswalk. Report unmatched rates per position —
a silent drop in match rate is how this rots.

Note `Player.platformIds` already exists in `src/types/index.ts` and is populated
from FantasyCalc; this extends the same idea rather than replacing it.

### Acceptance

- [ ] Ingest resolves pfr/gsis → Sleeper, emits match-rate stats per position
- [ ] Match rate for QB/RB/WR/TE reported in build output; a drop below a
      threshold fails the build
- [ ] Unmatched players are listed in the build log, not silently dropped

### References

`src/types/index.ts` (`Player.platformIds`) · `src/values/fantasycalc.ts`
(existing cross-platform id harvesting)

---

# Milestone 2 — Activity-based value ✅ Complete

The core bet. R6 was the payoff; R3–R5 were its inputs. All five shipped between
2026-07-30 and 2026-07-31.

## R3 — Snap share and role participation

**Status:** Shipped — [#3](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/3).

**Labels:** `enhancement`

Ingest `snap_counts_2025.csv` (columns: `season, week, player, pfr_player_id,
position, team, offense_snaps, offense_pct, defense_snaps, defense_pct, st_snaps,
st_pct`).

Derive per player: season-to-date offensive snap %, last-4-week snap %, and the
delta between them. The delta is the signal — a back whose snap share went from
35% to 70% over a month is a different asset than his market price says.

### Acceptance

- [ ] Snap % (season and last-4) available per Sleeper-keyed player
- [ ] Surfaced on the roster row and asset picker next to the value columns
- [ ] Missing data renders as "—", never as 0% (a rookie with no snaps and a
      player we failed to match must not look identical)

### References

`src/components/RosterList.tsx` · `src/components/AssetPicker.tsx` (the existing
`ValuePair` two-column layout is the place this goes)

---

## R4 — Opportunity metrics: target share, air yards, WOPR

**Status:** Shipped — [#4](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/4).

**Labels:** `enhancement`

`stats_player_week_2025.csv` already carries `target_share`, `air_yards_share`
and `wopr` precomputed, alongside `targets`, `carries`, `receptions` and
`fantasy_points_ppr`, keyed by gsis `player_id` with `season`/`week`.

No need to compute WOPR ourselves — ingest it. Same season-to-date vs last-4
treatment as R3.

For RBs, the equivalent role signal is carry share plus target share (receiving
backs hold value in PPR that carry share alone misses).

### Acceptance

- [ ] Target share, air yards share, WOPR per player, season and last-4
- [ ] Carry share for RBs
- [ ] Position-appropriate metrics only — no air yards share on a running back

---

## R5 — Depth chart role classification

**Status:** Shipped — [#5](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/5).

**Labels:** `enhancement`

The 53 MB `depth_charts` file is the reason R1 exists. Reduce it at ingest to
one row per player: current depth position and whether they are the starter at
their spot.

Worth validating against snap share rather than trusting it — published depth
charts lie, and a "backup" at 70% snaps is the more interesting player. Where the
two disagree, prefer snaps and flag the disagreement; that gap is itself a
buy-low signal.

### Acceptance

- [ ] Role per player: starter / rotational / backup / inactive
- [ ] Derived from snap share, with the published chart as a cross-check
- [ ] Disagreements between chart and snaps are surfaced, not hidden

---

## R6 — Activity-adjusted valuation

**Status:** Shipped — [#6](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/6).
`src/engine/activityFactor.ts`. The design constraints below were binding and
still are — in particular the rule that the multiplier degrades to exactly 1.0
with no data, which is what makes the app usable in the offseason.

**Labels:** `enhancement`

### The payoff

Today `PlayerValue.value` is `market² / (market + replacement)`
— entirely a market view, adjusted only for league context. It has no idea
whether a player is currently playing.

Add a third layer: an activity multiplier from R3–R5, applied on top of the
replacement-adjusted value.

### Design constraints, learned the hard way

The replacement-clamp bug (fixed in `2720882`, written up in `docs/DESIGN.md`)
is the cautionary tale for this issue. Anything that collapses many players onto
one number destroys ordering, and ordering feeds back into the model through
`bestLineup` → `startersByPosition` → replacement level. So:

- The multiplier must be **continuous and strictly monotonic**. No cliffs, no
  clamps to a constant.
- It must be **bounded** — something like 0.75–1.25. Activity refines a dynasty
  value; it does not replace it. A rookie WR on 20% snaps in Week 3 is not worth
  25% of his dynasty price.
- Dynasty value already prices *expected future role*. Double-counting current
  role is the main risk. Weight activity by how much of the horizon it should
  inform — heavy for a 29-year-old, light for a 22-year-old.
- Keep `marketValue` untouched, exactly as now. Fairness stays arguable in the
  terms the other manager checks.
- Offseason and Week 1 have no current-season data. The multiplier must degrade
  to exactly 1.0, not to zero.

### Acceptance

- [ ] `activityFactor(player, activity, settings)` — pure, unit-tested, bounded,
      monotonic in each input
- [ ] Property test: shuffling roster order changes nothing (the R6 version of
      the regression test in `replacement.test.ts`)
- [ ] Degrades to 1.0 with no data; never produces NaN on a partial row
- [ ] UI explains the adjustment per player — "70% snaps, up from 35%" beats an
      unexplained number

### References

`src/engine/replacement.ts` (`leagueValue`, `valueLeague`) ·
`docs/DESIGN.md` "The clamp was destroying the model" · `src/engine/replacement.test.ts`

---

## R7 — Role-trend detection: buy-low and sell-high

**Status:** Shipped — [#7](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/7).
`src/engine/roleTrend.ts`. Now also the engine behind the waiver recommender
([#47](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/47)) — the same
signal run against unrostered players instead of rostered ones.

**Labels:** `enhancement`

Where activity data actually earns its keep. The market reprices a role change
slowly, so the gap between *market value* and *activity-adjusted value* is a
tradeable edge.

Surface two lists:

- **Buy low** — activity well above what market value implies. Someone else's
  bench player who is now playing.
- **Sell high** — market value well above current role. Name value outliving
  usage.

Feed both into `movableAssets` so the suggestion engine proposes them, with the
reason stated in the existing "why they say yes" format.

### Acceptance

- [ ] Both lists computed league-wide, ranked by size of the gap
- [ ] Wired into `suggest.ts` candidate selection
- [ ] Each entry states the evidence: snap/target trend, weeks of data
- [ ] Small samples are excluded or visibly caveated — a two-game trend is noise

### References

`src/engine/suggest.ts` (`movableAssets`, `explain`) · `src/engine/analysis.ts`
(`surpluses`)

---

# Milestone 3 — Known model gaps ✅ Complete

Found during the 2026-07-29 review. Independent of Milestones 1–2; picked up in
parallel with the data pipeline, as intended.

## R8 — Separate win-now value from dynasty value

**Status:** Shipped — [#8](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/8).
The four-number model in `PlayerValue` (`value` / `marketValue` /
`redraftValue` / `winNowValue`) is this issue's output, and its doc comment in
`src/types/index.ts` is the authoritative explanation of the two scales.

**Labels:** `enhancement`

### Problem

Replacement level is computed by ranking players by **dynasty** market value and
taking the Nth. Dynasty value prices multi-year future production. Subtracting a
dynasty-derived replacement level from a dynasty value conflates two questions,
and it shows at both ends:

- **Aging starters** — Mike Evans, Davante Adams. Real weekly starters whose
  dynasty price is age-suppressed, so they land below a dynasty-ranked
  replacement despite being startable now.
- **Speculative youth** — Travis Hunter, Cam Ward. Value entirely in the future,
  so they rank *above* replacement today without helping a lineup this week.

The residual floor stops these from reading as worthless, but the underlying
conflation remains.

### Approach

FantasyCalc already returns `redraftValue` alongside dynasty value, and the app
already stores it in `PlayerValue.redraftValue` — currently unused. Compute
replacement level against redraft value for the *starting lineup* question,
keeping dynasty value for the *asset* question.

That likely means `PlayerValue` grows a third figure, and `bestLineup` runs on
the win-now one while trade fairness stays on dynasty market value.

### Acceptance

- [ ] Lineup strength computed on a win-now scale; asset value on dynasty
- [ ] Contention quadrants recomputed and sanity-checked against the real league
- [ ] `docs/DESIGN.md` updated — this changes the core model and needs the same
      write-up standard as the clamp fix

### References

`src/types/index.ts` (`PlayerValue.redraftValue`, already populated and unused) ·
`src/engine/replacement.ts` · `src/values/fantasycalc.ts`

---

## R9 — Injury status in valuation

**Status:** Shipped — [#9](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/9).
`src/engine/availability.ts`, and the expanded `InjuryStatus` union that
distinguishes roster designations (`dnr`, `na`) from actual injuries.

**Labels:** `enhancement`

`Player.injury` is mapped from Sleeper (`InjuryStatus` in `src/types/index.ts`)
and never used in valuation or lineup construction. A player on IR still fills a
starting slot in `bestLineup`, which overstates the roster and understates the
need the trade engine should be solving for.

### Acceptance

- [ ] Season-ending statuses (IR, PUP, suspended) excluded from `bestLineup`
- [ ] Week-to-week statuses surfaced in the UI but not silently repriced
- [ ] Trade warnings mention incoming injured players — `buildSide` in
      `trade.ts` already has the warnings array

### References

`src/types/index.ts` (`InjuryStatus`) · `src/engine/rosterValue.ts` ·
`src/engine/trade.ts`

---

## R10 — Unvalued positions: K, DEF, and the deep bench

**Status:** Shipped — [#10](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/10).
Resolved by excluding K/DEF from the maths while keeping them on the roster, with
`UnvaluedCell` drawing the "no value published" / "worth nothing" distinction.

That distinction gets its real test in
[#46](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/46): on the free-agent
board it applies to 662 of 893 players rather than 18 of 176.

**Labels:** `enhancement`, `good first issue`

FantasyCalc publishes no K or DEF values. On the test league that leaves 18 of
176 rostered players with no value at all, and the K/DEF starting slots
contribute exactly 0 to every roster.

Harmless for comparing rosters (everyone is equally penalised) but it makes the
UI look broken, and `startersByPosition` counts K/DEF starters that can never
have a replacement level.

Decide and implement one of: exclude K/DEF from lineup math entirely, or assign a
nominal flat value. Either is defensible; the current silent zero is not.

### Acceptance

- [ ] K/DEF handled explicitly, with the choice documented
- [ ] UI distinguishes "no value published" from "worth nothing" — `AssetPicker`
      already has a `~0` affordance for this

### References

`src/values/fantasycalc.ts` (`POSITIONS`) · `src/engine/rosterValue.ts` ·
`src/components/AssetPicker.tsx`

---

# Milestone 4 — Reach and retention ◐ R12, R13 and R14 shipped

Only worth doing once the valuation is something to be proud of — which, after
Milestones 2 and 3, it is. R11 remains, and is blocked on something no adapter
code can move — see below.

## R11 — Multi-platform: MFL, Fleaflicker, ESPN

**Status:** Blocked — [#11](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/11).

Note that the `LeagueBundle` contract this depends on is being widened by
[#46](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/46), which adds a
free-agent set every provider will be expected to supply. Worth sequencing
deliberately: doing #46 first means one more thing for each new provider to
implement, doing R11 first means retrofitting each of them.

**Labels:** `enhancement`

The architecture already anticipates this — `src/platforms/types.ts` defines
`LeagueProvider`, and everything downstream of `platforms/` speaks the canonical
types in `src/types/index.ts`. FantasyCalc hands us the cross-platform id map for
free, and R2 adds more.

Largest single addressable-audience win on this list. Dynasty Daddy supports
seven platforms; we support one.

### Blocked: two of the three cannot be reached from a browser at all

Probed live on 2026-08-19, sending `Origin: https://kfsalem.github.io`:

| Platform | Response | Usable from a static site |
|---|---|---|
| **Fleaflicker** | `200`, and **no `Access-Control-Allow-Origin` header on any response**. `OPTIONS` preflight answers `405`. | No |
| **MyFantasyLeague** | `200` with `Access-Control-Allow-Origin: https://www42.myfantasyleague.com` — a fixed value, not an echo of the caller. `&CALLBACK=` does not produce a JSONP wrapper either. | No |
| **ESPN** | CORS headers correctly echo the caller's origin and allow credentials. | Yes, in principle |

This invalidates §3.1 of `docs/DESIGN.md` — *"Every data source is keyless,
public, and CORS-enabled"* — and the **Sleeper → MFL → Fleaflicker** sequence in
§2.5. The two platforms picked for their dynasty userbase are exactly the two a
zero-backend app cannot call, and the one that answers is the one that table
rated hardest and deferred.

ESPN is not a free win either. A sweep of league ids returned only `404` (no
such league) and `401` (exists, private) — public ESPN leagues are rare enough
that there was no league to develop or verify against, and ESPN does not support
trading future draft picks at all, which is half of what this app values.

**So R11 needs a decision, not an implementation:** ship ESPN against remembered
API shapes, or put a proxy in front of MFL and Fleaflicker and give up the
no-backend property in §3.1. Until one of those is chosen this is blocked on a
constraint no amount of adapter code moves.

### Acceptance

- [ ] At least one additional provider behind the existing `LeagueProvider` interface
- [ ] No engine or UI code learns which platform a league came from
- [x] Provider-specific quirks documented — see the CORS table above

---

## R12 — Shareable trade permalinks

**Status:** Shipped — [#12](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/12).
The OG image shipped with it: `scripts/og.ts` generates `public/og.png`, and
`index.html` carries the full `og:` and `twitter:` card metadata.

**Labels:** `enhancement`

Encode a proposed trade in the URL so it can be pasted into a league chat. This
is the app's growth loop and it is nearly free — the state is already
serialisable.

Pairs naturally with an OG image for link previews.

---

## R13 — Playoff odds for a proposed trade

**Status:** Shipped — [#13](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/13).
`src/engine/playoffOdds.ts`.

**Labels:** `enhancement`

Dynasty Daddy runs 10k+ simulations for playoff odds. The differentiated version
here is answering it *about a trade*: "this moves you from 34% to 51% to make the
playoffs."

Needs the remaining schedule (Sleeper provides it) and a weekly scoring
distribution per roster. `starterValue` is already the per-roster strength input.

### Acceptance

- [ ] Monte Carlo over the remaining schedule, seeded and deterministic
- [ ] Before/after odds shown on the trade analysis panel
- [ ] Runs in a worker — must not block the UI

---

## R14 — Weekly start/sit optimizer

**Status:** Shipped — [#14](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/14).
`engine/startSit.ts`, surfaced as the lineup panel at the top of **My team**.

**Labels:** `enhancement`

`bestLineup` already computes the optimal legal lineup. With R3–R4 activity data
it becomes a genuine weekly tool rather than a valuation internal, and it is the
feature most likely to bring users back between trades.

### What the build turned on

**The season question and the Sunday question are not the same question, and the
difference is one line of `engine/availability`.** A player designated *Out* is
out for the next game, so R9 deliberately left him in the pool: a season-length
valuation that repriced every roster each Friday would be noise. A lineup for
Sunday inverts that exactly, and `canPlayThisWeek` is that inversion. Without it
this feature is a rename of `summarizeRoster`; with it, it is the thing that
catches the most expensive mistake a manager makes.

**The platform's own lineup had been discarded.** `Roster.starterIds` stripped
Sleeper's `"0"` placeholders, which compacted the array and shifted every player
after an empty slot into somebody else's position — so the one input this
feature compares against could not say which slot anybody was in. It is now
`Roster.setLineup`, aligned to `startingSlots`, `null` for an empty slot.

**Two legal lineups over the same players are the same lineup.** Diffing slot by
slot against the greedy arrangement invented corrections that cancelled out, so
the recommendation is rearranged to agree with the manager's own wherever that
is legal (`arrangeLike`). Rows that remain are rows that matter.

**What it does not know, said out loud.** Values are season-long win-now prices
corrected for role and availability — not weekly projections. There are no
matchups, and no feed this app reads publishes bye weeks, so a confident-looking
list would be over-claiming. The panel says so in its own subtitle.

### A live bug this found

Sleeper reports `week: 2` in the middle of August and means the *preseason*.
`remainingFixtures` read that as a regular-season week and filtered the schedule
to weeks 2 and later — deleting the first fortnight of a season nobody had
played from every playoff simulation, silently, with every number still
rendering. `LeagueBundle.seasonPhase` and `engine/season.regularSeasonWeek` fix
it: a week number is only a week once the phase says which season it counts.

---

# Milestone 5 — The premium feel ✅ Complete

**The reason this was last no longer holds.** The original argument: *"Polish
applied to a model you do not yet trust is wasted work, and every one of these
touches surfaces that Milestones 2–3 will reshape."* Milestones 2 and 3 have
shipped. The reshaping has happened, the surfaces are stable, and the model is
one worth trusting — so the condition the deferral was waiting on is satisfied.

Milestone 5 is now most of what remains.

**Milestone 5 is complete.** #53, R15, R16, R17 and R18 shipped in that order —
the design brief (`docs/DESIGN-SYSTEM.md`), the token layer it specified, the
charts that spend both, the motion and states layered over them, and finally the
small-screen pass over all of it. The order mattered: R18 laid out surfaces that
were finished, rather than guessing at ones still being reshaped.

## R15 — Design system foundation

**Status:** Shipped — [#15](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/15).
Sequenced after [#53](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/53),
which also corrected this item's premise: `POSITION_STYLES` is no longer the only
shared token set. `src/index.css` carries a Tailwind 4 `@theme` block that is
half-adopted — three of its declared tokens are dead while 51 distinct raw color
utilities run alongside it. A partly-used vocabulary is a harder starting point
than none.

**Labels:** `enhancement`

Establish the vocabulary before restyling anything: type scale, spacing rhythm,
a real color system with semantic tokens, elevation, focus states, dark mode.

Currently styling is ad-hoc Tailwind utilities per component with a
`POSITION_STYLES` map in `src/lib/format.ts` as the only shared token set.

### Acceptance

- [ ] Tokens defined once and consumed everywhere; no raw hex outside the token file
- [ ] Dark mode via `prefers-color-scheme` plus a manual toggle
- [ ] Type scale and spacing documented with rendered examples
- [ ] WCAG AA contrast verified in both themes

---

## R16 — Data visualization overhaul

**Status:** Shipped — [#16](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/16).

**Labels:** `enhancement`

The app's whole argument is quantitative and it currently renders as tables and
bars. The scarcity panel, contention quadrants, positional strength, and (after
R3–R7) activity trends all deserve real charts.

Highest-leverage single view: the contention quadrant as an actual two-axis
scatter of the league, with your team marked. It is currently a label.

### Acceptance

- [x] Consistent chart language — one palette, one axis treatment, one tooltip
- [x] Accessible: not color-alone, keyboard-reachable, screen-reader labelled
- [x] Responsive without horizontal page scroll

### What it turned out to be

`src/components/charts/` — plain SVG, no charting dependency. The design brief
had already settled every colour question (§4.4), so the work was form and
mechanism rather than palette.

**`ChartFigure` is the chart language, and it enforces rather than documents.**
Its `table` prop is required, not optional, so a chart cannot be added to this
app without its WCAG-clean twin; `markProps` returns hover and focus handlers
together, so a mark that responds to a pointer responds to the keyboard by
construction. Neither can be forgotten because neither can be omitted.

Two decisions worth keeping:

- **The scatter is an emphasis chart, not four coloured quadrants.** Colouring
  the dots by verdict would have spent the reserved status palette on identity
  and seated a fourth categorical hue in an all-pairs form, which caps at three.
  Your team is the accent dot; the league is recessive grey; the quadrant is
  carried by position against the median crosshair, which is what a quadrant has
  always meant.
- **`leagueContention` shares `quadrantOf` and both medians with
  `contentionProfile`.** A dot in the top-right under a banner reading "Danger
  zone" would be the scarcity panel's old bug in a new costume, so the agreement
  is a unit test rather than a convention.

The diverging bar was also **encoding its verdict in colour alone** — a green or
red bar and nothing else on the row saying which. It now carries the signed
delta at the bar's tip.

Rendering it caught three things no validator could: a corner label colliding
with the team name in the exact quadrant a rebuilding team occupies, a missing
y-axis caption, and a full-extent bar printing its own value straight through
the position chip.

---

## R17 — Motion, states, and onboarding

**Status:** Shipped — [#17](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/17).

**Labels:** `enhancement`

What separates a competent tool from an expensive-feeling one:

- Purposeful transitions on value changes and trade edits — motion that explains,
  not decorates
- Skeletons rather than spinners; the league load is genuinely slow (5 MB player
  blob) and currently unexplained
- Empty, error, and first-run states designed rather than defaulted
- An onboarding pass that teaches replacement level in one screen, because the
  core idea is non-obvious and is the reason to use this over KTC

### What it turned out to be

Three CSS animations and no library. They live in `src/index.css` beside the
tokens, because motion is part of the vocabulary rather than a component's
private business — and because the `prefers-reduced-motion` rule already sitting
in the base layer then switches all three off for free.

**The hard part was deciding what *not* to animate.** Ticking one player moves
every figure on the verdict panel at once, so a flash on any of them fires on
every click and quickly means nothing. `useChanged` therefore drives exactly
three marks, each on a different event:

- the running "Sending away" total, which answers the tick you just made and can
  be a scrolled screen away from the checkbox that moved it;
- the fairness chip, but **only when the rating itself crosses a boundary** —
  the numbers behind it move constantly and the verdict rarely does;
- the playoff odds, which arrive late from a worker and are the one figure that
  can change while nobody is looking at it.

Two rules keep those honest. `useChanged` never fires on its own first render,
so a freshly mounted panel does not light up end to end; and the verdict is its
own component, so mounting it *is* the appearance event and `.rise-in` plays
without a flag to keep in sync.

The odds mark was wrong on the first attempt in a way only the rendered page
showed: fed the *gated* value, the pending dip to `undefined` counted as a
change of its own and lit up the "…" placeholder a beat before the number it was
pointing at. Feeding it the raw value fixed that and bought a second property —
a re-run returning the same odds no longer flashes at all, so the mark means
"this moved" rather than "this recomputed".

**The skeleton is deliberately vague about counts.** It mirrors the header,
tablist and card stack closely enough that nothing jumps on arrival, but it does
not draw twelve roster rows: guessing twelve and rendering ten is a worse lie
than implying no number. It also says what is slow, since an unexplained wait is
how a slow league becomes a suspected broken one.

The failed load gained a retry — and `useLeagueSummaries` re-runs only the query
that actually failed, because `refetch` in react-query v5 ignores `enabled` and
retrying the values query while the *league* is broken would call
`fetchFantasyCalcValues` with undefined settings, turning a retryable network
error into a thrown one.

The onboarding is set in type rather than drawn as a chart: a three-row
subtraction in large tabular figures, market minus replacement, is the whole
idea, and bars would have added a legend and an axis to one arithmetic
operation. It shows only on a true first run — stacking it under a failed load
would bury the error and the retry, which is the one thing on that screen anyone
needs.

---

## R18 — Mobile-first pass

**Status:** Shipped — [#18](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/18).

**Labels:** `enhancement`

Trades get discussed on phones, in league group chats. The two-column
market/league value layout, the asset picker, and any R16 charts all need a
deliberate small-screen design rather than a reflow.

### Acceptance

- [x] Every primary flow usable one-handed at 375 px
- [x] No horizontal page scroll at any breakpoint
- [x] Touch targets ≥ 44 px

### What it turned out to be

**Measured first, and the measuring is most of the value.** A Playwright pass at
375px reported page overflow, the elements causing it, and every interactive
target under 44px, per tab. It found three things that reading the CSS would
not have: the standings rendered every team name as a single letter — "S…",
"Ic…", "P…" — because a 150px value block left 45px for the name; the tradeable
surplus did the same to players; and the trade calculator stacked two pickers
that each kept their own 24rem inner scroll, so a thumb drag landed in whichever
of three scrollers it started over and the second team was ~900px away.

**Density is keyed to the pointer, not the width.** This is the decision worth
keeping. "A 17-row roster should fit" (§2) and "44px touch targets" are in
direct conflict and both are right — one is about scanning with a pointer, the
other about hitting with a thumb. `sm:` was the tempting resolution and it is
wrong for the device that needs it most: a landscape tablet is 1024px wide and
thumb-operated. A `fine:` custom variant on `(pointer: fine)` asks the question
that was actually meant, and writing it as `fine:` rather than `coarse:` makes
the comfortable size the default that new controls inherit.

**The calculator is one side at a time.** A segmented switch carrying both
running totals, one picker in the layout, no inner scroll, and the verdict
pinned to the foot of the screen — so an edit's consequence stays in view while
its cause is still under the thumb, and the full reasoning is one tap away. The
switch is plain `aria-pressed` buttons rather than a second tablist: declaring
`role="tab"` promises arrow-key navigation, and a fake tablist beside the real
one teaches a keyboard behaviour that does not exist.

Every horizontal-scroll bug had the same cause: a grid or flex child at its
default `min-width: auto`, refusing to go below its widest row's min-content and
pushing the page sideways instead. `min-w-0` on the column, every time.

**Two exceptions, both deliberate.** Chart marks stay at `MARK.HIT` 24px — a
ten-team scatter at 375px cannot give every dot 44px without the hit areas
overlapping, and a target that selects the wrong team is worse than a small one;
the required table twin is the path that does not depend on hitting anything. And
the tab strip scrolls below ~360px rather than wrapping, because a tablist in two
rows reads as two groups of tabs.

The audit harness needed fixing before its numbers could be trusted, which is
worth recording: a `fullPage` screenshot resizes the viewport, and the restore
afterwards drops Chrome's touch emulation — so every tab measured after the
first screenshot silently reported `pointer: fine`, measured the desktop
density, and called every compact row a failed target. Measurement and
photography are now separate passes, and the harness asserts `pointer: coarse`
before it believes anything.

---

# Post-roadmap

Raised after the 2026-07-29 research and outside its ordering. Specs live in the
issues rather than here — the lesson of this document is that a second copy of a
plan drifts from the first.

## Second source for player values

**Status:** Open — [#43](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/43).

A `ValueSource` seam with DynastyProcess behind it, so FantasyCalc is not the
only answer. Raised when the risk register was found to be claiming a mitigation
that did not exist. The hard part named there is normalisation: two markets must
land on one scale before either can be compared, and the win-now split depends on
that scale holding.

## The waiver wire

**Status:** [#46](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/46)
(free-agent board) **shipped**; then
[#47](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/47) (pickup
recommendations with FAAB bids), still open.

The app used to discard every unrostered player at import — 893 of them on the
test league. #46 widened the provider seam to keep them and prices what can be
priced; #47 points R7's role-trend engine at the result. Measured 2026-08-08:
74% of free agents on an NFL team have no FantasyCalc value, so activity data,
not market value, has to do the ranking.

### What #46 settled

**Two blocks, not one ranked list.** FantasyCalc's universe is about one
league's worth of players, so it prices roughly a quarter of the wire and has
never heard of the rest. Ranking them together means inventing a number for
two-thirds of the list, and #10's rule is that a missing value is not a zero. So
the priced block is ordered by league-adjusted value and the unpriced block by
snap share, and the two are never summed.

**`LeagueBundle.freeAgents` is a separate field, not a widening of `players`.**
Replacement level is derived from the rostered universe, and it sets every value
in the app; a free agent leaking into `players` would move it silently. Two
fields make the leak impossible rather than merely unlikely, and a test pins the
property.

**Ordering on a bare snap share was wrong, and the real data showed it.** The
first version put a quarterback who started five games in October above a
receiver who played all seventeen weeks — because `SnapShare.season` is the mean
over the games a player *appeared in*, which is right, and which `activity.ts`
chose deliberately so a missed week is not a zero. The fix is not to re-weight
by availability, which would contradict that; it is that "98% lately" and "98%
back then" are different claims. The unpriced block ranks in three evidence
tiers — playing recently, played at some point, never seen — each ordered by the
one metric, with no arithmetic crossing a tier.

**Prior-season activity is labelled before it is read, not after.** The board is
*ordered* by activity, so through the offseason a reader who assumes it is
current is misled by the ranking itself rather than by a column he could check.

## Calibration and legibility

- [#48](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/48) — real trade
  market data for calibration. The third competitive gap above, and the one whose
  feasibility is unproven.
- [#49](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/49) — say the
  pick-valuation edge out loud in the UI.
- [#50](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/50) — mine Sleeper
  transaction history. Closes out `DESIGN.md` §7 open question 4, and unblocks the
  bid model in #47.

## League history

**Status:** Open — [#52](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/52).

A dashboard of records, all-time tables and the fun statistics, built on the
seasons Sleeper already chains to the current league via `previous_league_id` —
a field the schema does not yet parse. The test league walks back four seasons to
2023 (renamed from Westeros along the way), giving 510 scored team-weeks.

The trap worth knowing before starting: `roster_id` is not stable across seasons
and `user_id` is, so every historical stat has to key on the manager rather than
the roster slot, and manager identity has to come from `roster.owner_id` rather
than `/users` — that endpoint returns more people than there are teams.

**Final standings are a decision, not a lookup**, and championships, playoff
appearances and last-place finishes all rest on it. Playoff teams rank by how
long they survived, with same-round eliminations split by points scored in the
losing matchup; everyone else ranks on regular-season record, points for
breaking ties. Placement games and the consolation bracket are ignored by
default — they measure who still sets a lineup after elimination rather than who
was better, and the 2025 season is a live example of the two rules disagreeing.

That default is **exposed as a user setting rather than imposed**. Some leagues
take their placement games seriously; plenty of leagues never play them at all,
which is also why the points-based rule has to exist regardless — it is the only
one that works everywhere.

Deliberately a different register from the rest of the app: entertainment built
on real arithmetic, and it should not pretend to predict anything.

## Frontend design direction

**Status:** Shipped — [#53](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/53).
Sequenced before R15 — see Milestone 5 above.

The design brief Milestone 5 lacked: register, density, typography, a semantic
color layer, light and dark, and the accessibility bar. Delivered as
`docs/DESIGN-SYSTEM.md`, plus the repo's first `.claude/skills/` entries, so the
decisions apply to everyone working in the codebase rather than living in one
person's head.

## The league settings the app reads past

**Status:** Shipped — [#78](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/78).
The first of the league-native pass, and deliberately first: it is the only
layer of it that cannot be confidently wrong.

`/league/<id>` publishes about fifty settings keys and the app read seven. The
rest are deterministic facts about how a league works — no model, no inference,
no shrinkage. They are read or they are not.

### Two leagues, because one was not enough

**Corrected 2026-08-28.** The findings first recorded here were gathered from
the wrong league. `LeagueImport` carries **Tight Ends Dynasty League**
(`1235622229488717824`) as its placeholder, and that is what got checked; the
league every issue in this pass means is **The Eternal Rebuild**
(`1336802780030988288`), which is the one with 148 scoring rules. Both are real
leagues and every behaviour shipped in #78 is correct — but three of the stated
findings described only the placeholder, and two of them contradicted the issue
in the issue's favour.

The corrected picture, from four seasons of each:

| | Eternal Rebuild | Tight Ends |
|---|---|---|
| settings keys | 48–52 | 47–51 |
| scoring keys | 52 → 148 | 43 |
| `waiver_bid_min` | published every season | absent every season |
| `trade_deadline` | **13** — a real one | 99 — "no deadline" |
| `playoff_seed_type` | 1 | 0 |
| bench spots | 7 | 19 |
| starting slots | 10 | 11 |

What survives, and what changes:

- **`waiver_bid_min` is not "never published".** It is published in every season
  of one league and absent from every season of the other. The `number | null`
  handling is right — and better justified by the split than by the absence,
  because it is *variance* that makes the distinction load-bearing. The issue was
  right to list the key; this document was wrong to say otherwise.
- **`trade_deadline` is not always the 99 sentinel.** The Eternal Rebuild sets a
  genuine week-13 deadline in all four of its seasons, so the deadline work in
  #78 binds in the league it was written for rather than being defensive code
  for a hypothetical. Reading anything past week 18 as "never binds" still
  handles both leagues correctly.
- **The playoff codes are not all uniformly `0`.** `playoff_seed_type` is 1 in
  one league and 0 in the other. Carrying them as raw numbers is still right, and
  the reason is unchanged: nobody here has checked either value against an actual
  bracket.
- **The key count moves**, in both leagues and between seasons of each. Sleeper
  adds settings without notice, which is why the schema strips what it does not
  name instead of failing on it.
- **Bench depth was never discarded**, which remains true and is the one
  correction in the issue's direction. `roster_positions` reaches `allSlots`
  intact and `trade.ts` has always counted it into `rosterCap`; what was missing
  is a *named* figure. `benchSlots` is now it, and the 7-versus-19 spread between
  these two leagues is what makes it worth naming.

The methodological lesson is cheap and worth keeping: **the placeholder league id
in the UI is not the league the issues are about.** Check the id before quoting a
number from it.

### What changes an answer today

**`pick_trading`** was the defect worth the whole issue. `balancePackage` closes
an uneven offer with a draft pick and has no other currency, so in a league that
forbids pick trading every balanced suggestion was *illegal* — not unappealing,
illegal — and nothing said so. Picks are now withheld from the candidate pool
and from the balancer, which means some offers simply cannot be built there, and
the engine says which rule it was working under.

That sentence is **appended, never given as the cause**. A league that forbids
picks and also contains no mutually good trade has two independent facts about
it, and naming the rule as the reason would tell the reader that allowing picks
would have found something. Often it would not, and the app has not tested it.

**`trade_deadline`** bounds every piece of advice the app gives, because all of
it recommends a trade. Telling a contender to press its advantage in week 13 of
a league that closed trading in week 11 is worse than saying nothing:
confident, specific, and impossible to act on. The window is derived from
`weeksPlayed + 1` rather than from a calendar — the season odds already carry
it, so there is no second source of truth about what week it is.

The safe direction is **open**. An unknown week leaves the window open, and only
a deadline that has demonstrably passed closes it: a window wrongly reported
closed hides the app's main feature behind a claim the reader knows to be false.

**`disable_trades`** and **`best_ball`** each delete a surface. Both get an
explanation rather than an empty state — "no trades found" reads as a failure of
the search and invites the reader to try again or conclude the app is broken,
when in fact the league decided this and nothing will change.

### What was parsed but deliberately not modelled

`league_average_match` is read and not simulated. #13's playoff model is
head-to-head, and a median match materially changes the variance it rests on;
building that is a model change, and this issue is about reading fields.

The three playoff bracket codes are carried as raw numbers. The app has only
ever observed `0` for all three, so naming the other values would be inventing
meanings for numbers nobody here has seen. #52 can name them when it has a
league that uses one.

Taxi and reserve capacity are carried through to `LeagueSettings` and no
further. How many stash slots exist genuinely changes what an injured asset
costs to hold — but that is a valuation model, and #9's rule stands: availability
comes from the NFL designation, not from the manager's IR slot.

## Read the league's actual scoring settings

**Status:** Shipped — [#73](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/73),
scoring engine and self-check. Replacement level in league points is the
follow-up; see the end of this section.

The app read **one** of the 148 scoring rules Sleeper publishes — `rec`, to pick
a PPR flavour for FantasyCalc — and dropped the rest. The Eternal Rebuild is
TE-premium with six-point passing touchdowns and seven long-play bonuses, and
the header cheerfully described it as "PPR".

### The oracle is the point

Everything else in `engine/` is a model, testable only against its own intent.
Scoring is arithmetic over published fields, and Sleeper publishes **its own
answer** for every rostered player in every played week under
`matchups/<week>.players_points`. So this is the one number in the app that can
be checked against the truth, in the league it is running in.

It rides along in a response `loadSchedule` already fetches, so the oracle costs
no extra request.

Measured over the whole 2025 regular season of that league — 2,579 player-weeks
against Sleeper's own totals:

| | |
|---|---|
| exact to the cent | **95.1%** |
| explained by named bonuses | 4.8% |
| unexplained | 1 player-week (0.04%) |
| aggregate error | **−0.85%** |

Per position, the headline defect is gone: **tight ends are exact**, and
quarterbacks come in at −0.01%. 457 of those player-weeks are committed as a
fixture so the claim is a test rather than a memory.

### What the residuals actually are

Every one bar a single player-week is a **long-touchdown bonus**.
`stats_player_week` publishes plays of 40+ yards but not whether a *touchdown*
was 40+ or 50+, and `pass_int_td` needs to know an interception was returned for
a score. Both need play-by-play — a far larger file for bonuses worth one or two
points on a rare event, against a TE premium the old behaviour missed entirely.

The engine can therefore only ever be **short**, never over — a property worth
having and worth a test, since it means no player is ever priced above what his
league would have paid him.

The one exception: Caleb Williams, week 6, half a point. nflverse nets a −5
fumble-recovery loss into rushing yards where Sleeper does not. That is a
disagreement about what a rushing yard is, not a scoring bug.

### Two corrections to the issue's own findings

- **`passing_40` is completions of 40+ yards**, which the issue flagged as
  unverified before `pass_cmp_40p` read it. Confirmed by cross-checking against
  `receiving_40`: they agree in 543 of 544 team-weeks (228 against 227), against
  controls where `passing_tds`/`receiving_tds` and `completions`/`receptions`
  match exactly. The single mismatch is a lateral splitting receiving yards.
- **Fumbles must come from `fumbles_lost_total`**, not the sum of the rushing,
  receiving and sack buckets. Trevor Etienne lost one on a punt return in week
  3, which belongs to none of the three and cost a real −2 the sum could not
  see. That fix alone took week 3 from 93% to 94% exact.

### The budget decided the file shape

`public/data` has a hard 1 MB ceiling and every visitor pays it. Per-player-week
stat lines for 37 columns measured **492 KB padded**. Ordering the columns so
rarely-used ones trail — kicking last, receptions first — and trimming trailing
zeros brought the same 37 columns to **301 KB**, which is less than the naive
26-column version. Total is now 675 KB of 977 KB.

**`SCORING_COLUMNS` order is therefore load-bearing**, and reordering it without
re-measuring quietly costs tens of kilobytes.

Season totals would have been 53 KB, and were rejected: per-week rows are what
make the runtime self-check possible at all, and the self-check is the feature.

### Saying so out loud

Two surfaces, both of which existed to be wrong before:

- The header badges now say **TE premium +0.5** and **6-pt pass TD**, which
  "PPR" was actively hiding.
- `ScoringNote` reports what the app can and cannot reproduce, naming
  unreachable rules in words rather than Sleeper's key names — "50+ yard
  receiving touchdowns", not `rec_td_50p`. It is silent when there is nothing to
  report, and a league whose scoring cannot be reproduced is told that values
  fell back to market rankings.

`classifyRules` sorts every published rule into supported, unreachable,
defensive and unknown. Defensive rules are set aside rather than counted as
gaps: the app does not value DEF or IDP at all (#10), so counting 22 of them as
failures would bury the six that actually cost a skill player points.

### Deliberately not done here

**Replacement level in league points.** The issue's real payoff and the reason
it was split: re-deriving replacement level moves every valuation in the app,
where the scoring engine merely adds one that can be checked against an oracle.
`scoringIsUsable` is the seam it will read — a league the engine cannot
reproduce falls back to the market ranking rather than shipping quietly wrong
numbers.

**Play-by-play** for the long-touchdown bonuses, at a measured 0.85% on a
deliberately bonus-heavy league.

**Replacing FantasyCalc.** Market value stays market value; `ppr` is still
derived, because it is one of the four knobs that API takes.

## Replacement level, and the correction that actually mattered

**Status:** Shipped — the payoff deferred from [#73](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/73),
and scope item 6 of [#74](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/74).

### The obvious implementation is a no-op

Both issues describe deriving replacement level from league points instead of
from a market ranking. Built and measured on the two real leagues, that changes
**nothing**:

```
starters who change identity, ranked by league points vs the market's rulebook
  Eternal Rebuild 2026   QB 0/10   RB 0/25   WR 0/35   TE 0/12
  Tight Ends 2025        QB 0/10   RB 0/25   WR 0/35   TE 0/12
```

The reason is structural. A TE premium or six-point passing touchdowns lift
*every* player at a position together, so the ordering **within** a position
barely moves — and replacement level reads a market price off whoever sits at
rank N+1. Re-picking that player by points hands back the same player.

### The mis-valuation was between positions, not within them

Scoring the same players under the league's rules and under the rulebook the
market prices assume:

| | QB | RB | WR | TE |
|---|---|---|---|---|
| Eternal Rebuild 2026 | **+12.7%** | −5.1% | −5.0% | **+10.9%** |
| Tight Ends 2025 | +0.2% | −3.2% | −2.8% | **+15.8%** |

That is #73's claim — "every tight end in it is systematically underpriced by
the tool today, and so is every quarterback" — as a number. Nothing measured
within a position was ever going to find it.

### Why this is still a measurement

FantasyCalc is asked for prices parameterised by `isDynasty`, `numQbs`,
`numTeams` and `ppr`, and nothing else. So its prices **are** prices under
standard scoring at that reception value — a rulebook this repo can write down
exactly (`marketBaseline`). The premium is the ratio of two scorings of the same
players: theirs and yours. No projection, no fitting, no thresholds.

Normalised by the **pooled** ratio rather than the mean of the ratios, so the
total value of every starting lineup is unchanged and only the split between
positions moves. A mean would weight a ten-starter position like a
thirty-five-starter one and quietly inflate or deflate the whole league
depending on its lineup shape.

Last season's stat lines are the right sample here, and this is the one place in
the app that needs no prior-season caveat: the same players are scored twice
under two rulebooks, so the ratio is a property of the *rulebooks*, not of the
season. #46's labelling rule exists because "98% of snaps" reads as a claim
about now; "a TE reception is worth 0.5 here" does not.

### The identity case, and the degrade path

A league scored the way the market assumes gets `measured: false` and is left
completely alone — including half-PPR, since `ppr` is one of the knobs the
market API already takes. Below a 2% spread the premium is smaller than the
0.85% the scoring engine is itself known to be short by, and applying it would
be dressing noise as a finding.

`scoringIsUsable` is finally wired, which is what #73 built it for: a league
whose published points this engine cannot reproduce keeps the uncorrected market
prices rather than having every position reweighted by arithmetic already known
to disagree with the platform's own.

### One trap worth recording

`positionScarcity` feeds the panel that explains the model, and its levels now
arrive on the corrected scale. Reading a top-of-position price uncorrected there
divides two different currencies and teaches a `retained` share the engine never
computes — the exact failure that panel's own comment warns about. Both ends
take the premium, and a test pins that a uniform correction cannot move the
ratio.

## Points left on the bench

**Status:** Shipped — the payoff half of
[#74](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/74), on top of
the `players_points` ingestion that landed with #73.

The lineup a manager set against the best one his roster could have fielded,
scored on what the league itself paid, for every week it has ever played. There
is no model in it anywhere: the lineup, the roster and the points are all
published, and the comparison between two lineups over a completed week is
arithmetic.

### Sleeper publishes the answer, too

`roster.settings.ppts` — "potential points" — is Sleeper's own season total for
the best lineup each roster could have fielded, and it ships in a response the
walk already makes. It is the second oracle this API has turned out to hold,
after `players_points`, and it turns the whole engine from something to argue
for into something to check:

```
60 roster-seasons across two real leagues
  within half a point of Sleeper's own total   46 (77%)
  aggregate error                              0.12% of potential points
  worst single roster-season                   +1.31%
  residuals below zero                         none
```

The residual is **one-sided by construction**, which is what makes it safe. See
below.

### The pool is the whole roster, and that was measured rather than assumed

The obvious objection to any bench figure is that it credits the manager with
players he could not legally have started — a rookie on the taxi squad, a man on
injured reserve. It is a real effect and a large one: excluding everyone on the
season's final IR and taxi lists moves the league average from 20.7 to 14.2
points a week on one test league, a third of the figure.

Three things settle it.

**Per-week parking is not published.** The roster endpoint's `reserve` and `taxi`
are the state *now* — for a finished season, its final state. Neither list can
say who was parked in week 9. The transaction feed does not carry it either:
`status_updates` is empty on all 716 transactions across a full season of the
test league, which is checked rather than assumed.

**The end-of-season lists are wrong in both directions.** 14 to 22 men on those
lists *started* games that same season, so excluding them under-counts; and IR
men average 3.5 to 9.3 points a week across the six league-seasons measured,
because a player placed on IR in November played all of October. There is no way to use the list that is
not wrong somewhere.

**Sleeper includes them.** Its own `ppts` is reproduced to 0.12% by a pool that
holds the whole roster, and not by either narrower pool. So the app agrees with
the number the league's own site shows its managers, which is the only figure a
user can check this against.

What remains is the one-sided residual: Sleeper knows who was parked in a given
week and this app does not, so its figure is at most a little higher than the
platform's — 0.12% on aggregate, never lower on any roster-season observed.

### Four traps, all found live

**`previous_league_id` is `"0"`, not null, at the head of the chain.** Both test
leagues end that way. It is a perfectly good league id as far as any type is
concerned and answers 404, so every walk has to stop on both shapes.

**Starting slots move between seasons.** One test league plays ten starting slots
in 2023 and eleven in 2025. A lineup is positional, so aligning a 2023 week to
2026's slots shifts every player after the new slot into somebody else's
position — the compaction bug `mapSetLineup` documents, one season removed. Each
season is therefore read with its own settings, not the league's current ones.

**`roster_id` is not stable across seasons; `user_id` is.** Both test leagues
happen to keep their roster ids, which is exactly why this cannot be relied on —
the failure it produces, one manager's record shown under another's name, is
worse than showing nothing. Orphan teams have no `user_id` at all, so their
seasons are deliberately never joined to each other.

**`custom_points` is a commissioner override.** Week 3 of Westeros 2023: the
lineup earned 122.58 and the commissioner recorded 136.58. `fpts` carries the
override and `ppts` does not, which is why the check compares potential against
potential — and why the panel scores the set lineup from `players_points` rather
than from the fixture's own total. An adjustment to the standings is not
something the lineup did.

### Cost

68 requests for a four-season league, about two seconds cold; three requests
warm, since every season but the current one is finished and cached in
IndexedDB. Gated on a claimed team and the team tab, so a visitor pricing a
trade never pays for it. Fourteen of the 68 re-read the current season's weeks
that `loadSchedule` already fetched — left alone deliberately, since sharing
them would couple an optional panel to the odds every league load computes.

### What #74 still leaves open

Per-player consistency — floor, ceiling and spike weeks in the league's own
points — is the third thing that issue asks for and is untouched here. It reads
the same `players_points` this now walks, so the data is in hand.

## Shrinkage: how much a league has actually said

**Status:** Shipped —
[#75](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/75).
`src/engine/learned.ts` and `src/lib/learnedText.ts`.

Every number learned from one league's own record is strong in a league with
four seasons behind it and meaningless in one created last week. The obvious fix
is a threshold, and a threshold is a cliff: invisible, and it puts two leagues
one trade apart on opposite sides of a completely different answer. The
alternative is a shrunk mean.

```
value = (1 - w) * prior + w * estimate
w     = observations / (observations + half)
```

### The count of prior reinventions was right, and the shapes were not

The issue said the app had reached for this twice. It was three times, and only
one of them was actually this:

| where | what it turned out to be |
|---|---|
| `playoffOdds.calibrate` | **exactly this**, written by hand, with a half-life measured against a synthetic season |
| `analysis.seasonOutlook` | the same blend, a different weight function — and rightly so |
| `suggest.windowWeights` | not this shape at all |

`calibrate` is the canonical instance and now calls the shared helper. Its
`SHRINK_HALF_LIFE = 6` stays exactly where it is, which is the point: **`half`
belongs to the signal, not to the module.** A shared default would be a constant
picked by taste wearing the clothes of arithmetic, and `calibrate`'s six is the
only one in the app so far that has been measured — against a synthetic season
where the raw estimate swung between 2.5 and 11.5 over four to six weeks against
a true 9.

`seasonOutlook.weight` is `weeksPlayed / weeksTotal`, and that is not a
shrinkage curve — it is a proportion of a **known denominator**. A fourteen-week
season has fourteen weeks in it, so there is nothing to estimate about how much
evidence a full season would be. It keeps its own weight and blends through
`learned.blend`, which takes a weight computed elsewhere. The weighting is
written once; the weight is arrived at honestly in each case.

`windowWeights` stays where it is. Its bilinear interpolation reads four design
constants continuously instead of as a switch, and there is no prior in it and
nothing accumulating: a team in the middle of the league is not a team we know
less about, it is a team that genuinely wants a middling answer. Routing it
through the same helper would assert that the two are the same idea when only
one of them is about evidence. Its *second* half — correcting the roster
projection by the standings — is this shape, and does use it.

### The guard is the type

`Learned<T>` carries `value`, `prior`, `observations` and `weight`, and
deliberately **not** the raw estimate. A consumer cannot reach past the shrunk
figure to the unshrunk one, so forgetting to shrink is a compile error rather
than a quiet bias. What the type cannot do is force a consumer to use it at all;
that part is a convention, and the reason this is written down.

### Saying it out loud

The rule the issue sets — every league-learned number is displayed with the
evidence behind it — needs one phrasing rather than ten, so `lib/learnedText`
owns the clause after the claim:

> Your league pays about 18% over market for running backs — from 47 trades
> since 2023. Moderate confidence.

Three words, cut at the thirds of the blend: below a third the prior still
supplies more than two-thirds of the answer, and above two-thirds the league's
own record does. They are properties of the arithmetic rather than opinions
about it, and — this is the part that matters — **they change only the word.**
The value moves continuously at every sample size, so nothing the app does jumps
as a league crosses one. Describing confidence is not thresholding on it.

Zero observations gets its own sentence rather than "low confidence", because a
number with no league in it is not a number held weakly: the value there *is*
the prior, and a reader told "low confidence" would think their league had said
something quiet rather than nothing.

The first surface to use it is the playoff-odds tooltip, which already
distinguished a measured model from an assumed one but could not say how far
along the blend it was. `ScoringModel` now carries its own `weight` for that.

### What it is for

#76 and #77, which are the two issues that learn a number from a league's own
record and would otherwise each invent a threshold. Ordering them behind this is
what stops the quadrant's median-split cliff happening a third time.

## The transaction feed, verified

**Status:** Shipped — [#50](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/50).
The data layer under #76, #77 and the bid half of #47. Nothing reads it yet, by
design: those three each need it, and the point of gathering it once is that
they do not each invent their own reading of the same feed.

#50's first scope item was to **verify `settings.waiver_bid` against a live
league**, because the issue was written from Sleeper's documentation against a
test league that was `pre_draft` and returned an empty array for every week.
That is now measured across **3,264 transactions in seven league-seasons**:

| type | count |
|---|---|
| free agent | 1,902 |
| waiver | 1,155 — 461 of them failed claims |
| trade | 163 — 135 with picks, 17 with FAAB, one three-way |
| commissioner | 44 |

`waiver_bid` is real: 1,038 rows carry one, only waivers ever do, and the values
run 0 to 120 with a median of 1.

### Four things a consumer has to know

**A bid of zero is a real bid.** 377 of one league's 545 bids are exactly zero,
and a league running priority waivers instead of FAAB publishes no bid at all.
Reading a missing bid as a zero would turn "this league does not use FAAB" into
"this league values everyone at nothing", and it would discard two-thirds of the
other league's signal.

**Week 1 is not a week.** Sleeper files the entire offseason under it: 827 of
the 3,264 transactions and 85 of the 163 trades. Anything that counts activity
per week has a first bar that is a different kind of thing from the sixteen
after it.

**The calendar runs to 17, and it is not `playoff_week_start`.** Weeks 18 and 19
answer empty in every season of both leagues; week 17 still carries claims. Both
leagues end their regular season at 14, and three hundred moves happen after it,
so cutting the walk at the regular season would have dropped them.

**Failed transactions are evidence.** Only waivers ever fail — all 461 of them —
and a losing bid is the only published record of what it took to win. They are
kept, with `succeeded` carrying the distinction, rather than filtered at the
boundary where no consumer could get them back.

### What the feed cannot say

Nothing publishes a *declined* trade. The app can see everything a league agreed
to and nothing it refused, which bounds what #77 can honestly claim about a
manager who "never trades": he may be asking constantly and being turned down.

### Sharing the walk

`loadHistory` and `loadTransactions` are separate provider methods over one
shared `walkSeasons` helper. Separate because the two are wanted by different
surfaces at different times and each is around seventy requests — folding them
together would make a panel about bench points pay for a feed about trades.
