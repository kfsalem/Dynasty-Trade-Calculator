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

**As of 2026-08-16: R1–R10 and R12–R18 have shipped**, along
with #53's design brief. Milestones 1–3 and 5 are complete. What remains is R11
and R14, and the post-roadmap items at the end.

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

# Milestone 4 — Reach and retention ◐ R12 and R13 shipped

Only worth doing once the valuation is something to be proud of — which, after
Milestones 2 and 3, it is. R11 and R14 remain.

## R11 — Multi-platform: MFL, Fleaflicker, ESPN

**Status:** Open — [#11](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/11).

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

### Acceptance

- [ ] At least one additional provider behind the existing `LeagueProvider` interface
- [ ] No engine or UI code learns which platform a league came from
- [ ] Provider-specific quirks documented (MFL's API is materially stranger than
      Sleeper's)

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

**Status:** Open — [#14](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/14).
Its precondition is met: R3–R4 activity data has shipped.

**Labels:** `enhancement`

`bestLineup` already computes the optimal legal lineup. With R3–R4 activity data
it becomes a genuine weekly tool rather than a valuation internal, and it is the
feature most likely to bring users back between trades.

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

**Status:** Open — [#46](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/46)
(free-agent board), then
[#47](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/47) (pickup
recommendations with FAAB bids).

The app currently discards every unrostered player at import — 893 of them on the
test league. #46 widens the provider seam to keep them and prices what can be
priced; #47 points R7's role-trend engine at the result. Measured 2026-08-08:
74% of free agents on an NFL team have no FantasyCalc value, so activity data,
not market value, has to do the ranking.

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
