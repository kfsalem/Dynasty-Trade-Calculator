# Roadmap

Ordered backlog. Each item below is written to be pasted straight into a GitHub
issue — title, labels, body. Work top to bottom; the ordering is a dependency
order, not a wish list.

Research date: 2026-07-29. Data constraints in R1 were verified against live
endpoints that day and should be re-checked if they look wrong.

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
is worth saying out loud in the UI at some point.

### Competitive gaps

Dynasty Daddy ships multi-platform support (ESPN/Yahoo/Sleeper/MFL/Fleaflicker/
Fantrax/FFPC), power rankings with contender labels, a trade finder, a playoff
simulator, a start/sit tool, and a database of 3.6M+ real trades. KTC has power
rankings and its own crowd-sourced values.

Genuine gaps we could own, in rough order of differentiation:

1. **Weekly activity in the valuation** — nobody prices a player off his current
   role. This is R3–R7 and it is the most defensible thing on this list.
2. Playoff odds tied to the trade you are considering.
3. Real trade market data for calibration.

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

# Milestone 1 — Data foundation

Nothing in Milestone 2 can start until these two land.

## R1 — Ingest nflverse at build time (CORS + size blocker)

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

# Milestone 2 — Activity-based value

The core bet. R6 is the payoff; R3–R5 are its inputs.

## R3 — Snap share and role participation

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

**Labels:** `enhancement`

### The payoff

Today `PlayerValue.value` is `max(market × RESIDUAL_SHARE, market − replacement)`
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

`src/engine/replacement.ts` (`RESIDUAL_SHARE`, `leagueValue`, `valueLeague`) ·
`docs/DESIGN.md` "The clamp was destroying the model" · `src/engine/replacement.test.ts`

---

## R7 — Role-trend detection: buy-low and sell-high

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

# Milestone 3 — Known model gaps

Found during the 2026-07-29 review. Independent of Milestones 1–2; can be picked
up in parallel by anyone not touching the data pipeline.

## R8 — Separate win-now value from dynasty value

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

# Milestone 4 — Reach and retention

Only worth doing once the valuation is something to be proud of.

## R11 — Multi-platform: MFL, Fleaflicker, ESPN

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

**Labels:** `enhancement`

Encode a proposed trade in the URL so it can be pasted into a league chat. This
is the app's growth loop and it is nearly free — the state is already
serialisable.

Pairs naturally with an OG image for link previews.

---

## R13 — Playoff odds for a proposed trade

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

**Labels:** `enhancement`

`bestLineup` already computes the optimal legal lineup. With R3–R4 activity data
it becomes a genuine weekly tool rather than a valuation internal, and it is the
feature most likely to bring users back between trades.

---

# Milestone 5 — The premium feel

Deliberately last. Polish applied to a model you do not yet trust is wasted work,
and every one of these touches surfaces that Milestones 2–3 will reshape.

## R15 — Design system foundation

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

**Labels:** `enhancement`

The app's whole argument is quantitative and it currently renders as tables and
bars. The scarcity panel, contention quadrants, positional strength, and (after
R3–R7) activity trends all deserve real charts.

Highest-leverage single view: the contention quadrant as an actual two-axis
scatter of the league, with your team marked. It is currently a label.

### Acceptance

- [ ] Consistent chart language — one palette, one axis treatment, one tooltip
- [ ] Accessible: not color-alone, keyboard-reachable, screen-reader labelled
- [ ] Responsive without horizontal page scroll

---

## R17 — Motion, states, and onboarding

**Labels:** `enhancement`

What separates a competent tool from an expensive-feeling one:

- Purposeful transitions on value changes and trade edits — motion that explains,
  not decorates
- Skeletons rather than spinners; the league load is genuinely slow (5 MB player
  blob) and currently unexplained
- Empty, error, and first-run states designed rather than defaulted
- An onboarding pass that teaches replacement level in one screen, because the
  core idea is non-obvious and is the reason to use this over KTC

---

## R18 — Mobile-first pass

**Labels:** `enhancement`

Trades get discussed on phones, in league group chats. The two-column
market/league value layout, the asset picker, and any R16 charts all need a
deliberate small-screen design rather than a reflow.

### Acceptance

- [ ] Every primary flow usable one-handed at 375 px
- [ ] No horizontal page scroll at any breakpoint
- [ ] Touch targets ≥ 44 px
