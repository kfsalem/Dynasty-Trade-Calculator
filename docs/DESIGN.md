# Dynasty Utility — Design Document

**Status:** Draft v1
**Last updated:** 2026-07-28
**Context:** Resuming an abandoned scaffold. Expanding scope from a personal trade calculator to a general NFL dynasty league utility.

---

## 1. Product Vision

A dynasty fantasy football companion that knows **your specific league and your specific roster**, not just generic player values.

The differentiator is context. KeepTradeCut tells you two players are worth the same. This tells you:

> "This trade is even on raw value, but it's bad for you — you're already three deep at RB and you'd be starting a replacement-level TE. Meanwhile Team 4 is desperate at RB and has surplus TE. Offer them this instead, and here's why they say yes."

Generic calculators are roster-blind. That gap is the entire product.

### Target users
1. **Primary:** me + league mates (10–14 people, Sleeper)
2. **Secondary:** any dynasty player who can paste a league ID

Designing for (2) from day one costs very little, because the league-import path is the same either way.

---

## 2. Data Sources — Verified Live 2026-07-25

All three core sources were tested and returned live data. **None require an API key, account, or OAuth.** All three send `Access-Control-Allow-Origin: *`, meaning they are callable directly from browser JavaScript.

### 2.1 Sleeper — league data
Base: `https://api.sleeper.app/v1`
No auth. Read-only. Self-documented limit: **stay under 1000 calls/min**.

| Endpoint | Returns |
|---|---|
| `/user/<username>` | user_id lookup |
| `/user/<user_id>/leagues/nfl/<season>` | all of a user's leagues |
| `/league/<league_id>` | settings, scoring, roster positions |
| `/league/<league_id>/rosters` | every team's players + starters |
| `/league/<league_id>/users` | owner names/avatars |
| `/league/<league_id>/traded_picks` | **critical for dynasty** |
| `/league/<league_id>/transactions/<round>` | trade/waiver history |
| `/league/<league_id>/matchups/<week>` | weekly results |
| `/league/<league_id>/drafts`, `/draft/<id>/picks` | draft history |
| `/players/nfl` | **~5 MB** — docs say fetch **once per day**, cache it |
| `/players/nfl/trending/add\|drop` | waiver buzz |
| `/state/nfl` | current season/week |

Live check: `/state/nfl` → `season: 2026, season_type: "off", week: 0`. We are in the **offseason**, pre-2026 season. The app must handle offseason mode as a first-class state, not an edge case.

### 2.2 FantasyCalc — player values
`https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=1`

No auth. **Values are parameterized by league settings** — dynasty vs. redraft, superflex (`numQbs=2`), team count, PPR. This means values can be computed *for the user's actual league format*, which most calculators fail to do.

Returns 475 players. Per player:
`value`, `redraftValue`, `combinedValue`, `overallRank`, `positionRank`, `trend30Day`, `maybeTier`, `maybeAge`, `maybeAdp`, `maybeTradeFrequency`, `maybeRosterPercent`, `maybeMovingStandardDeviation`

**The critical bonus:** every player object carries cross-platform IDs —
`sleeperId`, `mflId`, `espnId`, `fleaflickerId`, `ffpcId`.

This solves player-ID reconciliation across platforms **for free**. It is normally the single most painful part of building a multi-platform fantasy tool. It also means FantasyCalc doubles as our ID mapping table.

**Gap:** contains no draft picks.

**Coverage gap found in Phase 1:** the 475-player universe does not reach the
bottom of deep dynasty rosters. In a 10-team superflex league with 10 taxi slots
(rosters of 30–45), **61 of 383 rostered skill players — 16% — had no
FantasyCalc value** and were counted as 0. Those players are genuinely fringe
(Ty Chandler, Carson Wentz, Javon Baker), so 0 is defensible for now, but it
will distort *total* roster value more than starter value. DynastyProcess covers
646 players and should be blended in as a fallback tier in Phase 2.

### 2.3 DynastyProcess — draft pick values
`https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv`

Free CSV on GitHub, regenerated daily (verified `scrape_date: 2026-07-24`). 731 rows:

| Position | Rows |
|---|---|
| WR | 240 |
| RB | 182 |
| TE | 129 |
| QB | 95 |
| **PICK** | **85** |

Columns: `player, pos, team, age, draft_year, ecr_1qb, ecr_2qb, ecr_pos, value_1qb, value_2qb, scrape_date, fp_id`

Sample pick rows:
```
"2026 Pick 1.01","PICK", ... value_1qb=6496, value_2qb=8248
"2026 Pick 1.02","PICK", ... value_1qb=5756, value_2qb=7687
```

**This fills FantasyCalc's pick gap.** Also useful: `db_playerids.csv` (cross-platform ID map) and `values-picks.csv` (pick ECR with high/low ranges — good for showing uncertainty bands).

### 2.4 Source strategy

**Players → FantasyCalc.** Live, league-setting-aware, carries platform IDs.
**Picks → DynastyProcess.** FantasyCalc has none.
**Cross-check → DynastyProcess player values** as an optional "second opinion" toggle.

Because the two sources use independent scales, **normalize both to a common 0–10000 basis** by dividing by each source's own max before blending or comparing. Never mix raw numbers across sources.

Design the value layer behind an interface so a source can be swapped or added (e.g. a KeepTradeCut scraper) without touching the engine:

```ts
interface ValueSource {
  id: string;
  fetchPlayerValues(settings: LeagueSettings): Promise<RawValue[]>;
  fetchPickValues?(settings: LeagueSettings): Promise<RawPickValue[]>;
}
```

### 2.5 Other platforms (later phases)

| Platform | Access | Difficulty | Notes |
|---|---|---|---|
| **Sleeper** | Public, no auth | ★ Easy | Ship first |
| **MyFantasyLeague** | Official Open Developer's API | ★★ Medium | Best dynasty support after Sleeper; strong pick/contract handling |
| **Fleaflicker** | Public API | ★★ Medium | Small but real dynasty userbase |
| **ESPN** | Unofficial; private leagues need `SWID` + `espn_s2` cookies | ★★★ Hard | Cookie handling is hostile in a static app; likely needs a proxy |
| **Yahoo** | Official, OAuth2 | ★★★ Hard | **Requires a backend** for the OAuth secret |

Sequence: ~~**Sleeper → MFL → Fleaflicker → (ESPN/Yahoo only if demand justifies a backend).**~~

**This sequence is wrong, and the difficulty column above is upside down.**
Measured against live endpoints on 2026-08-19: Fleaflicker sends no
`Access-Control-Allow-Origin` header at all, and MyFantasyLeague sends a fixed
one naming its own domain. Neither can be called from a browser, with or without
JSONP. ESPN — rated hardest here and deferred — is the only one of the three
that answers a cross-origin request correctly. The two platforms chosen for
their dynasty userbase are exactly the two a zero-backend app cannot reach. Full
table and the consequences in `docs/ROADMAP.md` under R11.

---

## 3. Architecture

### 3.1 The headline decision: no backend for v1

Every data source *this app actually uses* is keyless, public, and CORS-enabled.
**The entire v1 runs as a static client-side app.**

The qualifier was added on 2026-08-19 and is not pedantry: the unqualified claim
was read as a property of fantasy platforms in general, and it is not one. Two
of the three platforms in §2.5 fail it, which is what blocks R11. A source is
CORS-enabled only once somebody has sent it an `Origin` header and looked at
what came back.

Consequences:
- Deploy free to Vercel / Netlify / GitHub Pages
- Zero server cost, zero ops, zero secrets to leak
- No database to design before writing a feature
- Fastest possible path to a working, shareable URL

"Profile" in v1 = **localStorage**: your league ID, which team is yours, saved trade scenarios. No account required. Most of what people want from a profile is just "remember my league," and that needs no server.

**Add a backend only when a feature genuinely requires one:**
- cross-device sync / real accounts
- shared or persistent trade history between league mates
- push alerts ("a player on your roster dropped 12% this week")
- Yahoo OAuth (client secret cannot live in a browser)
- proxying/slimming the 5 MB Sleeper player blob at scale

When that day comes: **Supabase** (Postgres + auth + edge functions, generous free tier) is the lowest-friction fit. Deferring costs nothing because the engine is pure functions over plain data — it doesn't care where the data came from.

### 3.2 Stack

Keep the existing scaffold — Vite + React 19 + TypeScript + Tailwind 4 is a good 2026 choice.

Add:

| Concern | Choice | Why |
|---|---|---|
| Server state | **TanStack Query** | Caching, retries, stale-while-revalidate — exactly this app's shape |
| Persistent cache | **idb-keyval** (IndexedDB) | localStorage can't hold the 5 MB player blob |
| Runtime validation | **Zod** | These are third-party/unofficial APIs; they *will* change shape. Fail loudly at the boundary, not deep in the engine |
| Client state | **Zustand** | Light; avoids Redux ceremony |
| Routing | **React Router** | Standard |
| Charts | **Recharts** | Age curves, value distribution, contention quadrant |
| Tests | **Vitest** | The engine is pure functions — cheap, high-value tests |

### 3.3 Directory layout

```
src/
  platforms/              # league providers — the multi-platform seam
    types.ts              #   LeagueProvider interface
    sleeper/
      client.ts
      mapper.ts           #   Sleeper shapes -> canonical model
      schema.ts           #   Zod
    mfl/                  #   later
  values/
    fantasycalc.ts
    dynastyprocess.ts     # picks + cross-check
    normalize.ts          # unify scales across sources
    playerIds.ts          # cross-platform ID resolution
  engine/                 # PURE. No I/O. Fully unit-tested.
    rosterValue.ts
    positional.ts
    contention.ts
    ageCurves.ts
    tradeEval.ts
    suggest.ts
  model/                  # canonical domain types (extends existing src/types)
  hooks/
  components/
  routes/
```

**The two seams that matter:**

1. **`platforms/types.ts` — `LeagueProvider`.** Every platform maps into one canonical `League`/`Roster`/`Player` model. Nothing downstream ever knows what Sleeper is. This is what makes "not limited to Sleeper" real rather than aspirational.

2. **`engine/` is pure.** Functions in, values out, no fetching. This makes the hard logic trivially testable, and it means swapping data sources or adding a backend never touches the analytics.

```ts
interface LeagueProvider {
  id: 'sleeper' | 'mfl' | 'fleaflicker';
  getLeague(id: string): Promise<League>;
  getRosters(id: string): Promise<Roster[]>;
  getTradedPicks(id: string): Promise<DraftPick[]>;
  getTransactions?(id: string): Promise<Transaction[]>;
}
```

### 3.4 Caching

| Data | TTL | Store |
|---|---|---|
| Sleeper `/players/nfl` (5 MB) | 24h | IndexedDB |
| FantasyCalc values | 12h | IndexedDB |
| DynastyProcess CSV | 24h | IndexedDB |
| League/rosters | 5 min | TanStack Query memory |

Sleeper explicitly asks for once-a-day on the player blob. Respect it — it also makes the app feel instant after first load.

---

## 4. The Analytics Engine

This is where the product is won or lost. Raw value summing is a commodity; everything below is not.

### 4.1 Roster valuation

All of this runs on **replacement-adjusted** values, not raw market ones — see
Phase 4.5. A player is worth what he adds over the best player at his position
who starts for nobody in this league.

Two scales, and they never mix (R8). **Dynasty** answers *what is he worth* and
prices every trade, every bench, every asset. **Win-now** answers *does he help
me win this season*, and builds and scores every lineup. Both are FantasyCalc
columns run through the same replacement curve against their own replacement
level. Asking one number to do both jobs prices a 33-year-old WR2 and a rookie
who has never played a snap identically; see *Two scales, because there were
always two questions*.

On top of that sits an **activity multiplier** (R6): a bounded, continuous
factor from the player's *change* in snap and usage share, weighted by age and
by how many recent games back it. The level of a player's role is already in his
price, so only the movement counts, and only in the season being played — the
factor is exactly 1.0 through the offseason and whenever the data is missing.
`marketValue` is never touched, so trade fairness stays arguable in the terms the
other manager will quote.

Do **not** just sum player values. Compute:

- **Starter value** — value in actual starting slots, honoring the league's real lineup (including SUPERFLEX and FLEX, read from Sleeper's `roster_positions`)
- **Depth value** — bench, steeply discounted (a WR5 is worth far less to you than his market value)
- **VORS (Value Over Replacement Starter)** — a player's value minus the value of the player he'd actually replace *in your lineup*

**VORS is the core insight.** A trade should be judged on how much it moves your starting lineup, not on how much raw value changed hands. Acquiring a great RB when you already start two great RBs is worth a fraction of his market price *to you*.

### 4.2 Positional strength & weakness

For each position: your starter value vs. the **league median** at that slot → z-score.

- z > +1.0 → **strength**
- z < −1.0 → **weakness**
- **Surplus** — a bench player who would start on ≥ N other teams. Surplus is the raw material of every trade suggestion.

Report against the league, not against the universe. Being "weak at TE" only matters relative to the 11 people you actually play.

### 4.3 Contention window

Two scores per team, one on each scale (R8):

- **Now score** — starting lineup strength in **win-now** value
- **Future score** — age-decayed **dynasty** value at a 3-year horizon

The young/old axis is their ratio: future asset base per point of present
lineup strength. Dynasty value is already the market's claim about a player's
future, so decaying it asks what is left of a roster later; redraft value prices
only this season, so a lineup sum on it asks what the roster is *now*. Running
both halves on dynasty — as the model did before R8 — measured little beyond the
average age of a lineup, and counted a roster of unplayable rookies as strong
today.

Plot as a quadrant:

| | Strong now | Weak now |
|---|---|---|
| **Young** | Juggernaut — press the advantage | Rebuilding on schedule — stay patient |
| **Old** | Window closing — go all-in *now* | **Danger zone** — tear down immediately |

This drives "what should I focus on this year," and it drives trade suggestions: contenders buy win-now, rebuilders sell for picks. A trade is far likelier to be accepted when the two teams sit in opposite quadrants.

#### The season corrects it (#66)

Everything above is computed from rosters and contains **no information about
results**. It cannot know a team has lost six straight, which is how a roster
grading `win_now` at 4% to make the playoffs in Week 11 came to be told to spend
future picks on a season already decided — the worst available advice for that
team, given by an app that was holding the number contradicting it.

So once a season is under way the quadrant is corrected by live playoff odds
(R13), on the one axis where results beat projection:

- `SeasonOutlook.weight` is the fraction of the regular season played. It is a
  statement about **evidence, not urgency** — the simulation already discounts
  for how much season is left, so a 5% in Week 6 is 5% *knowing* eight weeks
  remain. What grows with time is how much real football the model has seen.
- `conviction` is that weight times distance from a coin flip. The advice speaks
  about the season only above a bar, so a mid-table team in October is left
  alone and a 4% team in Week 11 is not.
- Nothing jumps. Both terms are continuous, for the same reason `windowWeights`
  was made continuous: a median split put two teams a percent apart on opposite
  sides of a two-and-a-half-fold difference in weighting.

**The label and the quadrant do not move — only the advice does.** `label` heads
the banner and `quadrant` colours the dot on the contention scatter, and that
scatter plots `nowScore` against `retainedShare`, both roster quantities. A
banner reading "Danger zone" above a dot in the top right would be the scarcity
panel's old bug in a new costume.

The signal lives on `ContentionProfile` rather than being passed to each
consumer separately, which is what makes it structurally impossible for the team
page and the suggestion engine to disagree — `windowWeights` reads that object
and nothing else. Absent out of season, where both fall back to the roster
verdict alone.

### 4.4 Age curves

Position-specific decay, applied to future value:

| Position | Cliff begins |
|---|---|
| RB | ~26–27 (sharpest in fantasy) |
| WR | ~28–29 |
| TE | ~30 |
| QB | ~34+ (flattest by far) |

Powers buy-low / sell-high flags: *"Sell — he's a 27-year-old RB coming off a career year; his value is at peak and the cliff is next season."*

Start with published curves as constants; refine later against historical data if it proves worth it.

### 4.5 Trade evaluation

Given a proposed trade, report:

1. **Raw value delta** — the commodity number everyone else stops at
2. **VORS delta for each side** — the number that actually matters
3. **Positional impact** — what it does to each side's strengths and weaknesses
4. **Contention fit** — does it match each team's window?
5. **Fairness verdict** — mapped onto the existing `fairnessRating` type
6. **Warnings** — "leaves you with 1 startable TE", "you take on two RBs aged 28+", "you give up 60% of your pick capital"

### 4.6 Trade suggestion engine

The hardest and most valuable feature. Approach:

1. Compute surpluses and needs for **all 12 teams**
1a. Add **role trends** (R7) to the candidate pool: players whose price has
    outlived their role, and benched players whose role has outgrown their
    price. The surplus test in step 1 is a *value* test — it asks who would
    out-rank a weakest starter elsewhere — so a player whose role has changed
    but whose price has not is exactly the player it misses.
2. Find complementary pairs — your surplus ↔ their need, and their surplus ↔ your need
3. Generate candidate packages (players and picks) within a value tolerance (~±5–8%)
4. Score by: value balance × **your** VORS gain × **their** VORS gain × contention-window fit — where the window is the quadrant *corrected by live playoff odds*, so a contender whose season is gone is no longer scored as though winning this year were worth 0.9 to it (§4.3)
5. Rank, and prune to a handful of genuinely plausible offers

**Ship the "why they say yes" explanation alongside every suggestion.** A suggestion the other manager instantly rejects is worthless. Showing *their* upside in *their* terms is the feature people will actually come back for — and no major calculator does it.

Guard against the obvious failure mode: suggestions that are lopsided in your favor. If the engine only optimizes your side, it produces offers nobody accepts. Require both sides to gain.

---

## 5. Build log

Sized deliberately small. This project was abandoned once; **momentum is the real risk**, so every phase ended in something visible and shippable.

**This section is a record, not a plan.** It says what shipped and why, in the
order it happened, and it is where a decision gets written down so nobody has to
relitigate it from the diff. The forward-looking backlog lives in
[`ROADMAP.md`](ROADMAP.md), ordered by dependency and wired to issues — that is
the file to read to find out what happens next.

The two drifted apart for a while, "Phase" here and "Milestone" there, numbering
overlapping work in two schemes and leaving the README pointing at this one for
a roadmap it had stopped keeping. They no longer compete: this file looks
backwards, that one forwards.

### Phase 0 — Rescue the repo ✅ *(done 2026-07-25)*
- Initial commit of the scaffold — the repo had **zero commits**, all work untracked
- **Fixed a broken build.** The scaffold had never compiled: Tailwind 3 config against a Tailwind 4 install (CommonJS `postcss.config.js` under `"type": "module"`, missing `@tailwindcss/postcss`, v3 `@tailwind` directives, misordered `@import`). Migrated to Tailwind 4 CSS-first via `@tailwindcss/vite`; dropped `postcss.config.js`, `tailwind.config.js`, `postcss`, `autoprefixer`.
- Real README, real page title, placeholder landing page
- GitHub Actions → Pages, linting and typechecking on every push
- **Shipped:** a live URL and a repo that isn't empty

### Phase 1 — League import ✅ *(done 2026-07-25)*
- Sleeper client, Zod schemas, canonical mapper behind `LeagueProvider`
- IndexedDB cache (24h players / 12h values), slimmed before storing
- FantasyCalc values matched to the league's real format
- Rosters ranked by best fieldable lineup
- 24 unit tests; verified live against a real 10-team superflex dynasty league
- **Shipped:** paste a league ID or URL, see every roster valued

**Design change made during implementation:** we compute the best legal lineup
rather than reading the platform's `starters` array. That array holds whatever
lineup a manager last set — in the offseason (where we are now: week 0,
`season_type: "off"`) that is a stale week-17 lineup, and on a new roster it is
empty. Ranking on what a roster *can* field is both more accurate and the right
input for the VORS work in Phase 2.

### Phase 2 — Trade calculator ✅ *(done 2026-07-25)*
- DynastyProcess pick values, normalized onto the player scale
- Full pick-ownership reconstruction from Sleeper's traded-pick feed
- Two-sided trade builder with players and picks
- VORS: change in best-lineup strength per side, plus warnings
- 61 unit tests; verified live
- **Shipped:** the original goal, now league-aware

**Two findings from implementation:**

1. **Skip the DynastyProcess player fallback.** Phase 1 flagged that 16% of
   rostered skill players were unpriced and recommended blending DP in.
   Measured: DP recovers 53 of 61 (87%), but those players are worth **4–9 out
   of 10000** — roughly **0.3% of a roster's total**. A 2.5 MB extra download
   for 0.3% is a bad trade. The UI now shows unranked players as `~0` instead of
   `—`, which conveys the same truth honestly at zero cost.

2. **`roster_positions` is not the roster limit.** It covers starters and bench
   only; taxi and IR are separate allowances on top. The first live trade fired
   "over the 30-spot limit" on both teams of a 1-for-1 swap, because rosters in
   this league legitimately hold 45 (30 + 10 taxi + 5 IR). The cap is now
   `allSlots + taxiSlots + reserveSlots`, and only warns when a trade actually
   adds players. Unit tests cover both.

### Phase 2.5 — Claim your team ✅ *(done 2026-07-25)*
- `dynasty:myRoster:<leagueId>` in localStorage, keyed per league
- Claim by Sleeper username (`/user/<name>` → `user_id` → `roster.ownerId`) or
  from a dropdown, since orphan and co-owned rosters can't resolve by name
- Trade calculator anchors its left side to you; your team is badged in the
  rankings
- **Shipped:** the app knows who you are, with no account

This was an orphan in the original plan — mentioned twice in passing but never
scheduled. It is really a **prerequisite** for Phases 3 and 4, both of which
promise second-person output ("*your* weaknesses", "trades *for you*") that is
meaningless without it.

Sleeper quirk worth remembering: `/user/<unknown>` answers **200 with a `null`
body**, not 404, so the not-found case has to be detected explicitly.

### Phase 3 — Team analysis ✅ *(done 2026-07-25)*
- Positional strengths/weaknesses as z-scores vs. the league, flex-aware
- Contention quadrant from now-rank vs. 3-year-projected rank
- Position-specific age decay
- Tradeable surplus, and "what to focus on"
- **Shipped:** the "know my team" half of the vision

**Two modelling decisions:**

1. **The quadrant reads league-relative rank, not absolute score.** The decay
   model only ever decays — it never invents growth for ascending young players,
   which would be speculation dressed as arithmetic. That understates young
   rosters in absolute terms, but a uniform understatement cancels out when
   every team is ranked against the same yardstick.

2. **Surplus means "someone else would start him."** The first implementation
   required beating the league *median* starter at the position, and every one
   of the ten teams reported no surplus — impossible with 45-man rosters. The
   bar is now each rival's *weakest* starter at that position, which is both
   what the UI claims and what actually converts into a trade. Results now
   gradient sensibly: the first-place roster shows six surplus assets, the
   last-place roster two.

### Phase 4 — Trade suggestions ✅ *(done 2026-07-28)*
- Surplus/need matching across every team in the league
- Draft picks used to balance packages that players alone leave uneven
- Ranked offers, each with "why they say yes" written in the partner's terms
- "Open in calculator" hands a suggestion to the Phase 2 builder to edit
- 19 unit tests; verified end to end against the real league (10-team 1QB
  dynasty, `1336802780030988288`): 36 suggestions across 10 teams, 6–23 ms and
  ≤200 packages per team
- **Shipped:** the feature that makes it worth showing strangers

**Three findings from implementation:**

1. **"Both sides must gain" cannot mean VORS.** The plan said to require both
   teams to improve, and the obvious reading — both gain starting-lineup
   strength — rules out the most common dynasty trade there is: a rebuilder
   sending a veteran to a contender for picks. Picks never start, so the
   rebuilder's VORS is negative by construction. Measuring their gain in
   win-now units answers a question they did not ask.

   Each side is now scored on a **window-weighted blend** of a now delta (VORS)
   and a future delta (age-decayed lineup three years out, plus pick value
   moved), with weights from their contention quadrant — 0.9/0.1 for a closing
   window, 0.1/0.9 for the danger zone. Both sides' *blended* benefit must be
   positive. The live run confirms the shape: contenders take a negative future
   delta to add a starter, rebuilders take a negative now delta to add picks,
   and both come out ahead on the number they actually care about.

2. **Candidate pools have to encode who would sell what.** Searching every
   player against every player produces mostly offers nobody would read. The
   pool per team is now: surplus always, **plus picks if contending, plus
   aging starters if rebuilding** — the assets a manager has an actual reason
   to move. This is also what keeps the search at teams × 5² rather than
   teams × 45².

3. **`AGE_CLIFF` was defined twice, with different numbers.** `engine/trade.ts`
   used RB 27 / WR 29 / TE 30 / QB 34 for its warnings while `engine/analysis.ts`
   used RB 26 / WR 28 / TE 29 / QB 33 for decay, so a 27-year-old RB was past
   the cliff on the team page and not in the trade warnings. Suggestions consume
   both, which forced the question. Unified on the `analysis.ts` table.

**Two more found only by running the real league**, both invisible against
synthetic data:

4. **The contention quadrant was measuring quality twice.** Phase 3 split the
   future axis on *absolute* projected score. Decay is roughly proportional to
   value, so a strong roster stays strong and the future ordering came out
   almost identical to the present one. On the real league this collapsed the
   model completely: **five juggernauts, five danger-zone teams, and not one
   `win_now` or `rebuilding`** — half the quadrant unreachable, and with it half
   the window weights that Phase 4 depends on.

   The Phase 3 note argued a uniform understatement "cancels out when every team
   is ranked against the same yardstick." It does cancel — that is the problem.
   Cancelling out is precisely what leaves the axis carrying no information
   about age.

   The axis now splits on **retained share** (`futureScore / nowScore`): the
   fraction of today's starting value that survives three years. It is
   scale-free, so a weak young roster and a strong young roster both read as
   young. The real league now returns 4 / 1 / 4 / 1 across the quadrants, and
   the team whose owner named it "DREAM TEAM 2028" — last in present strength,
   highest retention in the league — correctly reads as rebuilding rather than
   danger. `retainedShare` is exposed on `ContentionProfile`.

5. **Mutually positive is not the same as worth proposing.** The strongest
   roster's top suggestion was worth **+172 against 36,704 of starting value** —
   0.5%, arithmetically positive and completely pointless. Both sides must now
   clear a floor of 0.5% of their own starting value (`minBenefitShare`).

   Packages are also deduplicated on their **player** content, since the same
   swap balanced with a 1st, a 2nd, or two picks is one idea shown three times
   and was crowding out genuinely different offers.

   Together these cut the league's suggestions from 45 to 36 and removed every
   trivial one. The league's best team now correctly gets **no** suggestions —
   its surplus is real but nothing it can buy moves a 36,704-point lineup, and
   saying so is better than padding the list.

### Phase 4.5 — Grounding values in league reality ✅ *(done 2026-07-28)*

Market values price a player against the whole dynasty world. They cannot know
that in a 10-team single-QB league every manager already starts a top-10
quarterback. Phases 1–4 inherited that blind spot wholesale.

- **Replacement level per position**, derived from the lineups the league
  actually fields — `leagueValue = market² / (market + replacement(position))`.
  This started as a hard `max(0, market - replacement)`, then a floored
  subtraction; see *The clamp was destroying the model* and *Subtraction was the
  wrong operation* below for why each had to go.
- **Realistic rookie pick values**: projected draft slot from the standings,
  plus a hard cliff after roughly pick 15 and near-zero third-rounders
- **Anti-tanking**: no contention window weights the present below 0.35, and the
  danger-zone advice no longer says "tear down aggressively"
- Every value now carries both a `marketValue` and a league-adjusted `value`
- 16 new tests (111 total); verified on the real league

**Four findings:**

1. **Nothing is hand-tuned per position, and it did not need to be.** The
   starter counts come from real best lineups, so scarcity falls out on its own.
   On the real league: QB 10 starters, RB 23, WR 34, TE 13 — the ten FLEX slots
   resolving to roughly 3 RB, 4 WR, 3 TE. Elite backs keep 77% of market value,
   receivers 78%, tight ends 75%, and the best quarterback alive keeps 50%. The
   five largest drops in the league are all quarterbacks. Change the lineup
   settings to superflex and quarterbacks recover automatically, because twenty
   of them would have to start.

   Worth noting against the intuition that drove this work: once replacement is
   accounted for, RB, WR and TE land within a point of each other at the top,
   and only quarterback separates. The positions differ enormously in *depth* —
   the RB cliff is real — but the best player at each is about equally hard to
   replace. Elite tight ends in particular are scarcer than the "stream a TE"
   framing suggests, because only the top few clear a replacement level set at
   TE14.

2. **Fairness and benefit must run on different numbers.** A trade is *argued*
   in market terms — that is what the other manager looks up before accepting —
   but whether it *helps* is a question about replacement-adjusted value.
   Balancing packages on market value and scoring benefit on league value makes
   suggestions more persuasive rather than less: they look fair in the terms
   they will be judged in, and are genuinely good in the terms that matter.

3. **The pick realism curve is a correction to the market's shape, not the
   shape itself.** It is deliberately flat across the first ten picks, because
   the market already prices 1.01 above 1.10 — when it knows the slot. Within-
   round differences therefore come from DynastyProcess's slot and tier rows,
   which means projecting the slot from the standings is what unlocks them. On
   the real league a bottom team's 1.01 is worth **5.5x** the champion's 1.10
   (6,349 against 1,154), and third-rounders price at 1–2 points. Applying the
   curve to the market figure as well as the league one is deliberate: applying
   it to only one side would let the engine hand over third-rounders that
   "balance" a trade while costing it nothing.

4. **Quarterbacks are now discounted twice, and that is worth watching.**
   FantasyCalc is already asked for single-QB values, and replacement level
   discounts them again on top. Both steps are defensible — the first is about
   format, the second about this specific league's depth — but the combined
   effect is aggressive, and it is the one number most worth sanity-checking
   against how QB trades actually settle in the league. A per-position tuning
   multiplier is the obvious escape hatch if it proves too strong.

**Cost:** league-wide suggestions fell from 36 to 16. That is the intended
direction — quarterback-for-quarterback filler no longer clears the bar — but
it is a real reduction in variety, driven by how few assets carry meaningful
value once replacement is subtracted.

**Post-review corrections.** A review of the commit found six real defects; the
two that mattered most:

- **Starter counts and values define each other, and one pass is not enough.**
  Replacement level is derived from who starts, but who starts is decided by the
  adjusted values — and replacement subtracts a *different* constant per
  position, which is exactly what can flip a FLEX slot. The first version
  computed counts from a market-value pass and never revisited them. Iterating
  to a fixed point moved the real league's flex split from 7 RB / 2 WR / 1 TE to
  3 RB / 4 WR / 3 TE, and every retained-value figure with it. The counts are
  now guaranteed to describe the lineups the returned values actually produce.

  The iteration is not guaranteed to converge: a position that loses its last
  starter has its replacement level drop to zero, which inflates it, which can
  win the slot straight back. Cycles are detected and fall back to the market
  pass, so the result never depends on which parity the loop stopped at.

- **The explanatory UI panel taught the inverse of the model.** It plotted
  replacement level directly under the heading "what each position costs to
  replace" — but a *high* replacement level means a position is *cheap* to
  replace, so quarterbacks drew the longest bar in a league where they are the
  most replaceable thing on the board. It now plots retained share, which points
  the same way as the values.

Also fixed: the FantasyCalc cache key was not bumped when `PlayerValue` gained
required fields, so any returning user inside the 12h TTL would have
deserialized a pre-upgrade entry and rendered `NaN` everywhere; the rookie-pick
realism curve was skipped entirely when standings were unknown, pricing
third-rounders at full value; a position with zero counted starters made its own
best player the replacement level and zeroed the position (reachable in a
pre-draft league with empty rosters); an unclassifiable position failed open,
keeping full market value while every classified player was docked; and the
suggestion cards showed league-adjusted figures beneath a market-derived
fairness verdict, so an even trade could read as wildly lopsided.

### The running record *(2026-07-29 onwards)*

Everything below postdates Phase 4.5 and belongs to no numbered phase. It used
to sit *inside* Phase 4.5, under a heading marked done on 2026-07-28 — which
meant a section declared finished quietly absorbed a week of later work and grew
to three quarters of this document. The phases were the wrong container for it:
they described a product being built out, and this is a model being corrected in
use.

That is the pattern here. Something ships, it gets run against a real league,
and it turns out to be saying something untrue. The fix goes in next to the
reasoning that produced the error, because the reasoning is usually the thing
that needs correcting. Entries are dated and name the issue they close.

**The clamp was destroying the model.** *(2026-07-29)*

The `max(0, …)` floor did not merely understate the bottom of the pool — it
erased the ordering *within* it. On the real 10-team league that was **87 of 158
valued rostered players collapsed onto a single number**, 55% of everyone
rostered, including Josh Jacobs, Mike Evans, Davante Adams and Travis Hunter.

Every consumer that sorts by value then had nothing to sort by, and the model
fed on its own noise:

1. Ties at zero make `bestLineup`'s FLEX choice arbitrary — decided by whatever
   order Sleeper happened to return `playerIds` in.
2. `startersByPosition` counts that arbitrary choice.
3. The counts set replacement level.
4. Replacement level decides who lands at zero. Back to 1.

Reshuffling player lists *within* each roster — an operation that says nothing
whatever about the league — moved RB replacement level between **1,900 and
2,709** and flipped individual players between **0 and 807**. The ordering the
live app happened to receive was the extreme end of that range, which is why the
zeroing looked far worse in practice than the design implied.

Downstream the damage compounded: bench value read exactly `0` for 8 of 10
teams, `analysis.surpluses` filters on `value > 0` so 7 of 10 teams reported no
tradeable surplus at all, and two teams could be offered no trades whatsoever.

Two fixes, deliberately separable:

- **A total order on valued players** (`rosterValue.byValue`): value, then
  market value, then player id. Market value separates players a league-adjusted
  figure cannot — a below-replacement WR1 and a waiver body are not the same
  asset — and the id makes the result depend only on *which* players are on a
  roster, never on the order they arrived in. The decay in `futureScore` and
  `futureLineupValue` now applies to both figures, so the tiebreaker stays in the
  same units as the value it breaks ties for.

- **An order-preserving floor** (`RESIDUAL_SHARE = 0.1`): a below-replacement
  player is not startable today but is still an asset — an aging starter whose
  dynasty price is age-suppressed, or a rookie whose value is entirely ahead of
  him. Keeping a fixed share of market value says exactly that. The function is
  continuous and strictly increasing, the two branches meeting where the surplus
  equals the residual, so nobody meaningfully above replacement is affected: an
  elite back is still worth market minus replacement, exactly as before. It is
  deliberately *not* rounded — rounding the compressed tail to whole points puts
  adjacent players back onto identical values, a smaller version of the same
  collapse. `formatValue` rounds for display, which is where rounding belongs.

After: zero players at zero, replacement levels identical across 25 reshuffles
in test and 8 on the real league, bench value non-zero for all 10 teams, and
every team reachable by the suggestion engine (129–205 packages considered per
team, up from as few as 33). Retained share moved to RB 81%, WR 79%, TE 73%,
QB 49%.

**Subtraction was the wrong operation.** *(2026-07-31)*

The floor kept the tail ordered and hid what it was ordering. Underneath, 94 of
158 rostered players — **59%** — sat on `market × 0.1`, so the 10th, 25th and
50th percentiles of retained value were all exactly `0.100`. The median rostered
player was priced by nothing except a tenth of his market value, and the floor
that was supposed to be a rescue was doing all the work.

Two symptoms a manager sees before any of that:

- **Jahmyr Gibbs and D'Andre Swift are 4.4x apart on market and came out 34x
  apart.** Swift is a starting NFL back who finished RB15 in PPR; he was worth
  230 against Gibbs' 7,846. Patrick Mahomes was 264, Travis Kelce 130.
- **The league's best and worst rosters went from 1.82x apart on market to
  3.93x.** Every lineup lost roughly eight starters × two thousand — the same
  ~15,000 came off all ten teams — and the rankings render that ratio as a bar
  width. A shift is not a scale, and ratios of a shifted quantity mean nothing.

The mistake is a category error, not a tuning problem. VORP subtraction is
defined on **projected points**, where one replacement level is a real quantity
you can take away. A dynasty market value is a **price** — already convex in
quality, already carrying scarcity — and subtracting a constant from a price
shears it rather than deflating it. No choice of floor fixes that; the floor is
what makes it survivable enough to ship.

Replaced with `market² / (market + replacement)`, which is the same idea written
so it cannot shear:

```
market² / (market + replacement)  ===  market - replacement × (market / (market + replacement))
```

You are charged the replacement cost *scaled by how far clear of it you are*.
Far above replacement the scale approaches 1 and this is the old subtraction
exactly, so nothing about the top of the model changed. Near replacement the
charge shrinks with the surplus it comes out of, and can never overtake it —
which is why no floor is needed: the curve is strictly increasing and strictly
positive for any positive market value, so the ordering `RESIDUAL_SHARE` existed
to protect is now a property of the curve rather than a repair to it.
`RESIDUAL_SHARE` is deleted.

On the real league: Gibbs/Swift **7.2x**, roster spread **2.30x**, retained
percentiles p10/p25/p50/p75/p90 of **0.319 / 0.398 / 0.491 / 0.622 / 0.711**
against `0.100 / 0.100 / 0.100 / 0.392 / 0.621` before. Retained share at the top
of each position moved to RB 82%, WR 82%, TE 79%, QB 66% — the quarterback
double-discount flagged as "worth watching" in finding 4 above is now a discount
rather than an erasure.

**The tests could not have caught any of this, and that is the more important
finding.** All 296 passed throughout. Nothing was *locally* wrong: the clamp
returned what it promised, the floor kept the tail ordered, every function met
its own contract. The failure was in the shape of the distribution, which no
test looked at.

So `replacement.test.ts` gains a `calibration` block asserting properties of the
whole output, in the terms a manager would notice them going wrong in:

- Two players at a position can never come out further apart than the **square**
  of their market ratio. This is a provable ceiling for `m²/(m+r)` and no bound
  at all for subtraction — Gibbs and Swift cleared it by 34 against 19.7.
- No block of the pool larger than 10% may share a single retained share (the
  plateau test — the clamp put 55% on one number, the floor 59% on one line).
- Retention is strictly monotone: a better player is always worth a larger
  *share* of his price, not merely a larger number.
- The best-to-worst roster spread may not exceed 1.6x the market's own spread.

The last one needs a second fixture. `league()` snakes its pool out so every
roster is near-identical, and a spread of 1.0 stays 1.0 under any shift
whatsoever — the assertion would have passed against the model it exists to
reject. `stratified()` deals in blocks instead, with decay rates calibrated to
produce a 1.68x market spread against the real league's 1.82x. All six
assertions fail against the old model and pass against the new one.

**"Buy low" was measuring the wrong thing.** *(2026-07-31)*

R7 ranked both lists on `roleShift`, which compares a player **only against
himself**: did his usage move? On the real league that put **Jahmyr Gibbs at the
top of the buy-low list** — 64% of the snaps to 76% over the last month of 2025,
correctly detected, and completely useless. Gibbs is the second-most-expensive
asset in dynasty football. There is no reading of the market under which it has
failed to notice that he is a workhorse, and a rising workload on a player
already priced as one is a *reason he is expensive*, not a discount.

The error is systematic rather than incidental. The gap is measured in value
points — correctly, since a 3% move on a 6,000-point starter beats a 20% move on
a bench body — so the most expensive players clear any threshold on the smallest
percentage move. Ranking on change alone therefore fills the list with precisely
the players whose roles are most thoroughly priced. Josh Allen was second on it.

A row now needs two things, not one:

1. **His role moved** — `roleShift`, unchanged, and still what prices a value.
2. **The role he moved to is not already in his price** — `rolePricing`, new.

The second is a percentile comparison inside his own position: where his current
usage ranks against where his price ranks. Gibbs is the 96th percentile on role
and the 99th on price, so his headroom is **−0.03** and he is filtered as fairly
priced. A back playing like the RB8 while priced like the RB25 is what survives,
which is what "buy low" has always meant to a dynasty manager — a good player
whose *price* is depressed, not merely one whose usage ticked up.

The pool is drawn from every player with both a market value and snap data, not
from the league's rosters, so the same player does not rank differently in a
10-team and a 14-team league for reasons that have nothing to do with him.
Percentiles are midranks, because at quarterback ties are the normal case —
every healthy starter sits at or near 100% of the snaps.

A third gate came out of the same review. The lists required only that the
*factor* move half a percent, while the roster snap column draws its arrow at
`MATERIAL_DELTA`, ten share points. So the panel listed Ja'Marr Chase as a
sell-high on a five-point snap dip with flat targets, while the column three
inches away showed nothing for him — and `MIN_SHARE`'s own comment already said
that a list disagreeing with its neighbour reads as a bug in one of the two. A
row now needs one metric to have moved ten points. It reads the *largest* metric
rather than the average `roleShift` prices on, because averaging snaps and usage
is right for a factor and wrong for a threshold: Jonathan Taylor went from 73% to
85% of the carries on unchanged snaps and averaged out to under six.

Before and after on the real league, buy-low side:

```
was: Gibbs +316, Josh Allen +229, Smith-Njigba +204, St. Brown +202, ...
now: Jonathan Taylor +213, Travis Etienne +108, RJ Harvey +103, Chris Godwin +63,
     Travis Kelce +59, Tyrone Tracy +49, Wan'Dale Robinson +34, Woody Marks +32
```

Every surviving row is a player who took on work his price has not caught up
with. Sell-high keeps Achane, Hampton, Lamar Jackson, Javonte Williams and Josh
Jacobs, and loses Chase.

Also fixed here: `suggest.ts` asserted "that's worth about N the market hasn't
charged for yet" in trade rationales **regardless of `applied`**. Through the
offseason `applied` is false, no value on the page includes the gap, and the
Role trends panel says so in as many words — so a suggestion card three feet
below it was directly contradicting the panel. The offseason wording now says
the move happened and is not counted.

**Still open, and deliberately not changed:** `ageWeight` gives a 30-year-old
1.0 and a 22-year-old 0.35. That is right for *pricing* — an old player's value
is very nearly a statement about his current role — but it tilts both lists
toward older players, which is backwards for dynasty. Travis Kelce at 36 is on
the buy-low list because of it. Changing the weight for the lists alone would
make them disagree with the values they are denominated in, which is a worse
inconsistency than the one it fixes; the honest fix is a separate horizon-aware
score, not a second weighting of the same one.

**The rookie-pick curve had the same disease.** *(2026-07-29)*

`pickRealismFactor` short-circuited on `round >= 3` *before* consulting the pick
number, directly contradicting its own doc comment — "the thresholds are
absolute pick numbers, not rounds, because the supply of NFL talent does not
care how many teams are in your league". Two consequences:

- **An 11x drop between adjacent picks.** In a 10-team league 2.10 is overall
  pick 20 and kept 33%; 3.01 is overall pick 21 and kept 3%. Projected draft
  slots are not precise to one pick, so a step that large was an artifact, not a
  model. There was a second step at 15 → 16 (0.75 → 0.45).
- **The curve depended on league size.** "Round 3" is overall pick 21 in a
  10-team league and 33 in a 16-team one — the same rule firing at very
  different depths of the same talent pool.

And flattening every third-rounder onto 0.03 destroyed the ordering among them
for exactly the reason the value clamp did: 22 of 30 third-round picks priced to
league value 0, indistinguishable from each other and from nothing.

Replaced with linear interpolation between anchors on absolute pick number —
`(10, 1.0) (15, 0.70) (20, 0.30) (30, 0.08) (45, 0.03)`, floored past 45.
Continuous, monotone, and league-size-independent by construction; the largest
single-pick drop is now 0.08, down from 0.30. Rounds 1 and 2 barely move
(2026 2.01 went 624 → 618), third-rounders go from 0–1 to 1–13, and no pick in
the league prices to zero. A third-rounder is now worth appreciably more in a
10-team league than a 14-team one, which is correct.

**The cliff was in the data all along, and we were charging for it twice.**
*(2026-07-31)*

`pickRealismFactor` existed on the argument that "market pick values are smoother
than reality, because they average across league formats and because hope is
priced in." Checked against the source, they are not. DynastyProcess's own 2026
curve, read by overall pick number, is:

```
pick   1: 5505    5: 2514   10: 1004   13: 598   20: 195   25: 95   30: 49   45: 11
```

A **28x** drop by pick 20 and 112x by pick 30, before anything of ours runs. The
realism curve then took another 70% off at pick 20 and 92% at pick 30. Compounded
on the real league, a 2026 second-rounder priced at **44 out of 10,000** — a
sixth of a waiver-wire running back, and roughly a fiftieth of what anybody in
the league would accept for one. Third-rounders ran 2 to 26.

Worse, the curve was arguing against the lookup underneath it. Its anchors were
absolute pick numbers "because the supply of NFL talent does not care how many
teams are in your league" — while `lookupPickValue` was reading the league's
*own slot label* off DynastyProcess's twelve-team board. A 10-team league's 2.09
is the 19th pick; asking the source for its "2.09" prices it as the 21st. Round 1
was immune, since slot and overall pick coincide there, which is what kept it
invisible for so long.

Both are fixed by the same change: `lookupPickValue` now takes an **overall pick
number** and maps it onto the source's board internally, and nothing is applied
on top of the result.

The league-size property the curve was hand-drawn to produce now falls out of the
source directly, and more precisely:

| | 1.01 | 2.01 | 3.01 |
|---|---|---|---|
| 10-team | 5,505 (pick 1) | 842 (pick 11) | 168 (pick 21) |
| 12-team | 5,505 (pick 1) | 598 (pick 13) | 95 (pick 25) |
| 14-team | 5,505 (pick 1) | 429 (pick 15) | 56 (pick 29) |

It also fixes larger leagues outright. A 14-team league has slots 13 and 14 that
no DynastyProcess row names; those fell through the entire chain onto the round's
median, so its 1.13 and 1.14 were priced identically *and* as mid-firsts. As
picks 13 and 14 they now read off the front of the second round, where they
belong. And a round deeper than the source publishes clamps to the deepest
available rather than pricing at zero — a 6th-rounder in a six-round rookie draft
was an asset the suggestion engine would hand over for free.

On the real league the whole board is now smooth and monotone from 5,505 down to
49 with no step at any round boundary: 2.10 went 44 → 195, 3.01 went 26 → 168,
3.10 went 2 → 49. Firsts are unchanged, as they should be.

`marketValue` for a pick is now the source's number untouched, which matters
beyond accuracy. It is defined everywhere else as "what the other manager will
quote", and trade fairness is *argued* in it — so a private correction applied
there settled every fairness verdict in units nobody else in the league uses.

**`tradeableSeasons` — a latent bug, not a live one.** The first review claimed
the app was listing 2026 rookie picks after that draft had happened. That was
wrong, and checking beat assuming: this league's status is `pre_draft` and its
rookie draft is scheduled for **2026-08-23**. Dynasty rookie drafts commonly run
in August, not with the NFL draft in April.

The underlying gap is real though, and about to open. `season >= currentSeason`
has no notion of whether a draft has run, and Sleeper's season field does not
roll over until the following spring — so from the day a league drafts until
then, the app would offer picks that no longer exist, and a first-rounder is
both the most valuable asset it prices and its usual currency for balancing an
offer. Now gated on the league's own status, and only when the league has
actually rolled over to the current season: a dynasty league still sitting on
last year's entry reads `complete`, which describes a finished season rather
than this year's unscheduled rookie draft.

**Two numbers that were saying more than they knew.** *(2026-07-31)*

**The rankings ranked eight-slot lineups and called them lineups.** This league
starts a kicker and a defence, neither of which has a dynasty market, so both
count as exactly zero in `starterValue` — the one figure the rankings sort on and
draw their bar from. That is the right price for a kicker and the wrong thing to
say silently: an unfilled slot and a filled one are indistinguishable in it, and
the starter counts confirm the gap is real rather than theoretical (K 9, DEF 8
across ten teams). `RosterSummary` now carries `pricedSlots` and `totalSlots`,
and the card reads "8 of 10 starters" whenever the number does not cover the
whole lineup.

**A median split was deciding what kind of team you are.** Both contention axes
split on the median, so exactly half the league is "weak now" by construction.
On the real league that put four teams in the danger zone every season, including
one sitting **sixth of ten and four percent below the median**, and told it to
"sell the veterans whose value is peaking."

As a label that is only unkind. As an input it was worse: `WINDOW_WEIGHTS` read
the quadrant and nothing else, so fifth place was scored on every trade at 0.9 on
the present and sixth at 0.35 — a two-and-a-half-fold difference between two
teams a few percent apart, deciding which offers each was shown.

`ContentionProfile` now carries `nowShare` and `youthShare`, each team's position
on its axis from 0 to 1, and `suggest.windowWeights` interpolates bilinearly
across the four corner values instead of switching on the label. The corners are
exactly the old table, so an unambiguous juggernaut and an unambiguous
danger-zone team are scored precisely as before; only the ground between them
changes. On the real league the step across the median is gone — 0.54 and 0.57
for the teams either side of it, against 0.65 and 0.35 before.

The interpolation deliberately inherits one non-monotonicity from the table it
reproduces: a *weak* old team gets less weight on the present than a weak young
one, because the anti-tanking floor holds the danger zone at 0.35 while a
rebuilder sits at 0.4. That is the table's own shape and smoothing it away would
be a different model, so a test pins it.

The quadrant label itself is unchanged and still a median split. It is a summary
now rather than a decision, which is the right job for it.

**Kickers and defences: excluded from the arithmetic, kept on the roster.**
*(2026-08-01, closes #10)*

FantasyCalc publishes no values for K or DEF, and this league starts both. That
left 18 of 176 rostered players unpriced and two of every ten starting slots
contributing exactly zero.

The issue offered two options — exclude them from lineup maths entirely, or give
them a nominal flat value — and noted that the silent zero was the one
indefensible choice. **Excluded.** A nominal value would be a fiction with a
number attached: it would make kickers tradeable assets the suggestion engine
could use to balance a package, and giving every kicker the same figure
reintroduces exactly the tie-collapse this codebase has already been bitten by
twice (see *The clamp was destroying the model*). There is no dynasty market for
these positions because dynasty managers stream them off waivers, and the model
should say that rather than price it.

What "excluded" means in three specific places:

1. **`startersByPosition` counts only starters the source prices.** The reason is
   arithmetic, not tidiness. A count is an *index into the sorted value list* —
   `startersNeeded` of 25 means "the 26th best back is the replacement." A
   starter carrying no value is not in that list, so counting him shifts the
   index one place deeper and overstates replacement level for everyone at his
   position. For kickers the count was merely dead — `replacementLevels`
   iterates the value pool and the pool has no kickers, so `K: 9` could never
   produce a level — but it read as live data to anything downstream. The same
   rule also catches a genuine skill starter too fringe for the source to rank,
   where the index shift is not harmless at all.

   Measured on the real league, the skill counts are **byte-identical** under the
   old rule and the new one (`QB 10, RB 25, WR 34, TE 11`), because no unvalued
   player currently starts at a skill position. This is a correctness fix that
   removes dead data and closes a live hazard, not a numeric improvement, and it
   is worth saying so plainly.

2. **The lineup still holds them.** They are real players who really do fill your
   K slot; the app simply cannot price them. `pricedSlots` / `totalSlots` on
   `RosterSummary` report the coverage, and the team card reads "8 of 10
   starters" so the headline number stops claiming to describe a full lineup.

3. **The UI distinguishes "no market" from "~0".** Both facts arrive as the same
   missing map entry and they are different sentences. A fringe receiver past
   the end of a 475-player universe really is worth about nothing, and `~0` says
   so honestly — Phase 2 measured it, those players are worth 4–9 out of 10,000.
   A starting kicker is worth something every Sunday and nothing in a trade.
   Telling him `~0` asserts he is a bad player, which is both wrong and the
   specific thing that made the roster list look broken. `UnvaluedCell` now reads
   **"no market"** for a position nobody prices and keeps `~0` for a player
   nobody ranks, each with the full explanation in a title.

`pricedPositions` derives the distinction from the value pool rather than
hardcoding `['K', 'DEF']`. `analysis.SKILL_POSITIONS` already names the
dynasty-relevant positions, and this document records what happened the last time
one fact lived in two places: `AGE_CLIFF` was defined twice with different
numbers, so a 27-year-old back was past the cliff on the team page and not in the
trade warnings. Reading it from the data also means a source that starts
publishing kicker or IDP values is picked up with no code change.

**Two scales, because there were always two questions.** *(2026-08-02, closes #8)*

Replacement level was computed by ranking players on **dynasty** market value and
taking the Nth. Dynasty value prices multi-year future production, so subtracting
a dynasty-derived replacement level from a dynasty value answered the asset
question twice and the lineup question never. Four players on the real league,
before:

|               | pos | age | market | league | redraft |
|---------------|-----|-----|--------|--------|---------|
| Mike Evans    | WR  | 32  | 1,762  | 837    | 2,074   |
| Davante Adams | WR  | 33  | 1,875  | 920    | 2,535   |
| Travis Hunter | WR  | 23  | 1,691  | 786    | 239     |
| Cam Ward      | QB  | 24  | 1,896  | 834    | 386     |

All four within 10% of each other, because the model had one scale and their
dynasty prices genuinely are alike. Their redraft prices differ by **roughly
8x**. Two of these men start every week and two of them do not play, and nothing
downstream could tell — not the lineup, not the rankings, not the quadrants, not
a single trade suggestion.

`PlayerValue` now carries four numbers as two pairs: `marketValue` → `value` on
dynasty, `redraftValue` → `winNowValue` on win-now. Each pair runs through the
same `market² / (market + replacement)` curve against a replacement level drawn
from its **own** ranking, because the two scales do not order a position the same
way — Christian McCaffrey is 4,136 on dynasty and 7,175 on redraft at 30, Jaxson
Dart 2,469 against 877 at 23. The starter *counts* are shared, since how many
quarterbacks must start on a Sunday is a fact about the lineup and does not
change with the horizon.

Same curve on both, deliberately. A redraft value looks more like projected
points than a dynasty price does, which makes it exactly the scale where plain
subtraction would be tempting again — and it is still a price. One category error
was enough; see *Subtraction was the wrong operation*.

After, the same four: **1,187 / 1,574 / 32 / 97**.

**What moved to win-now, and what deliberately did not.** Everything that builds
or scores a lineup: `bestLineup`, `starterValue`, `vorsDelta`, positional
strength and weakness, the surplus test, and the roster rankings. The exception
is `futureScore`, which stays on dynasty and must. Redraft value prices this
season, so a prospect enters at nothing and decays to nothing — a team built
entirely of them would project to have no future whatsoever, in the one
calculation whose whole subject is the future. Dynasty value is already the
market's bet on what he becomes.

`RosterSummary` therefore grows `starterAssetValue` alongside `starterValue`.
Not decoration: `benchValue` has to be the dynasty complement of a dynasty
total, and subtracting a win-now lineup from a dynasty roster total produces a
bench figure meaning nothing at all.

**Measured on the real 10-team league.** Replacement levels diverge hardest at
tight end, where the win-now replacement is barely a third of the dynasty one —
TE12 is a real dynasty asset and a redraft zero:

```
        starters   replacement(dynasty)   replacement(win-now)
RB          28              1,785                  1,402
WR          31              2,044                  1,549
TE          11              1,697                    518
QB          10              2,415                  1,153
```

The quadrants finally populate: **3 juggernaut / 2 win_now / 3 danger / 2
rebuilding**, against 4 / 1 / 4 / 1 before. `retainedShare` spreads from
0.712–0.948 to **0.549–1.053** — and crosses 1.0 for the first time, which is a
rebuild holding more future than present rather than an artifact.

One roster moved four places. A team whose lineup ranked 5th of 10 on dynasty
ranks **8th** on win-now while staying the youngest roster in the league, and its
verdict went from *juggernaut* to *rebuilding on schedule*. That is the entire
defect in a single row: it was being told to press an advantage it did not have.

Lineups changed less than expected and in the right direction — one team benches
a tight end priced at 1,740 dynasty and 589 win-now in favour of players who
actually play. Surpluses improved sharply, which matters because they are the raw
material of every suggestion: the top team's best trade chip went from a backup
quarterback who would start for **one** other team to a receiver who would start
for **four**, and Mike Evans — invisible to the old model — now surfaces as a
chip five teams would start.

**The roster spread widened, and it is the data rather than the curve.** Best-to-
worst went from 2.40x to 3.08x, which is the shape this document has been burned
by twice. So it was checked against the source numbers directly, with no
replacement level and no curve involved: raw market lineups spread **1.81x** and
raw redraft lineups **2.48x**. Redraft value is simply more concentrated —
contenders hold proven starters and rebuilders hold prospects — and the model
amplifies its input by **1.24x** against the dynasty side's 1.33x. The win-now
scale is better behaved on the calibration test's own metric than the scale it
sits beside, not worse.

**Half the redraft column is missing, and that is the correct answer.**
FantasyCalc prices about 400 players per position group on dynasty and ranks
almost exactly half of them on redraft — 199 of 398, by position QB 42%, RB 59%,
WR 49%, TE 45%. A 10-team league fields 80 skill starters, so a player outside
the top 200 on redraft really is worth nothing this season; the absence is
informative. On the real league only 12 of 158 rostered players lack a redraft
value, none worth more than 899.

That makes a coverage gate useless for completeness and necessary for something
else. `redraftValue` is `nullish` in the schema, so a renamed field would parse
cleanly, arrive as zeroes, and price **every lineup in the app at zero** — all
ten rosters ranked at nothing, the suggestion engine empty, every number still
rendering and every test still passing. `hasWinNowScale` therefore checks for the
column having vanished rather than for it being full, and on failure the win-now
scale mirrors dynasty: a worse model and a working app, which is the right way
round.

**The tests still could not see it, so 14 were added that can.** Every fixture in
the repo left `redraftValue` equal to the dynasty figure — the right neutral for
tests about something else, and it meant all 321 existing tests passed against
this change without exercising one line of it. The new block pins the four
players above to the point, because ordering alone cannot tell *which*
replacement level was charged: swapping in the dynasty level leaves every
comparison true and quietly reprices Evans at 1,045. Both mutations were checked
by hand — subtraction instead of the curve fails 3 tests, the wrong replacement
level fails 1.

**Still open.** `SideBenefit.total` blends a win-now `now` against a dynasty
`future` under the contention weights. The weights are a statement about how much
a manager cares about each question rather than a claim the units match, and the
figure is only ever compared against other packages for the same team — but it is
the one place in the model where two scales are added, and it is worth revisiting
if suggestion quality ever looks scale-sensitive.

**The model was right and the screen was lying.** *(2026-08-02, closes #34)*

Reported within the hour of R8 merging, by looking at a roster: *"why is David
Njoku now worth 5?"* He was not. His asset value was 417 and his lineup
contribution was 5, and the card showed one of those on the bench and the other
in the lineup with nothing to say they were different questions.

Njoku is worth reproducing in full, because nothing in the chain is a defect:

| | raw FantasyCalc | normalized | league-adjusted |
|---|---|---|---|
| dynasty | 1,062 | 1,039 | 417 |
| redraft | 77 | 75 | single digits |

FantasyCalc prices him at **0.7% of the top player** on redraft — he is TE31 of
66 on dynasty against TE25 of only **30 redraft-ranked TEs** — and the surplus
curve then keeps about a quarter of an already-tiny number. Every step is
correct. Rendering the result as a bare `5` beside a starting NFL tight end is
not.

Three fixes, and one lesson worth more than any of them.

**A player worth something must never render as nothing.** `formatValue` was
`Math.round(n).toLocaleString()`. Harmless on the dynasty scale, where the
numbers are large; on win-now, **25 players carried a positive value under 10
and four receivers rounded to a flat `0`**. `leagueValue` goes to real trouble
never to return zero for a ranked player — that is the whole reason it is a
curve rather than a subtraction — and three characters of formatting threw it
away at the last moment. Sub-1 positive values now read `~0`, which is already
this app's phrase for "ranked, and worth almost nothing". Negative zero, which
`Math.round(-0.2)` produces and which reads as a bug in a trade delta, is gone
with it.

**Both scales, on every row.** Showing only the list's own scale was defended on
the grounds that each list should sum to its own heading. That was worth less
than it sounded — the bench heading already does not sum to its visible rows,
since it truncates at fifteen — and it cost the thing that matters, which is
that the gap between a player's two numbers is the most interesting fact about
him. `Dylan Sampson 529 · 4` says *real asset, nothing this season* at a glance.
`Derrick Henry 1,755 · 4,592` says the opposite. The heading labels which column
is which and the list's own scale carries the darker weight.

**The scarcity panel was explaining a scale the lineup no longer used.** It
quoted a tight-end replacement of 1,697 while the lineup above it was scored
against 518. `PositionScarcity` now carries `topRedraft` and `retainedWinNow`,
and the panel draws a second outlined bar. The pair is worth reading on its own:
on the real league TE retains **79% on dynasty and 92% on win-now** — elite tight
ends are harder to replace this Sunday than they are to replace as assets, which
is the sort of thing the panel exists to say and could not previously.

This is the second time this panel has taught something the engine did not do.
The first was plotting replacement level directly, which drew the longest bar
for the most replaceable position. Both failures have the same shape: the panel
was updated a step behind the model.

**The lesson: every calibration check was a *relative* property.** Spread ratios,
plateau share, the squared-ratio amplification ceiling — R8 added all of them,
all of them passed, and all of them would still pass with every value on the
page rendered as `0`. None asked whether a number a human reads still says what
the model means. `replacement.test.ts` gains an assertion that runs values
through `formatValue` itself, since the engine's guarantee and the manager's
guarantee are only the same guarantee if the formatter is inside it. It fails
against the old formatter, and the fixture is checked for actually reaching the
region it asserts about — the trap `stratified()` was added for.

**Not fixed here, and not a display problem:** whether a redraft value of 77 for
David Njoku is defensible on the football merits. That is a question about the
value source, and it would be answered by blending a second one.

**A lineup is a claim about who plays.** *(2026-08-02, closes #9)*

`Player.injury` has been mapped from Sleeper since Phase 1 and read by nothing
but a badge. Meanwhile `bestLineup` — which decides every roster ranking, every
VORS delta and every trade suggestion — started a tight end on the
physically-unable-to-perform list, because a roster's `playerIds` includes
whoever is parked on IR and nothing downstream ever asked whether he could play.

Two statuses, two different mistakes, and only the first is the obvious one:

- **Out for the season.** A man on IR is not a worse starter, he is not a
  starter. Leaving him in overstates the roster.
- **Week to week.** Questionable and doubtful are surfaced and nothing else.
  They are noise on a season-length question — most questionable players play,
  the tag flips twice a week, and a model that repriced on it would rewrite
  every roster in the league each Friday. Sleeper's `Out` sits here too: it
  means out for the *next game*, not the year.

**Nothing is repriced, on either scale.** An injured player is worth what the
market says he is worth; dynasty value already prices the risk that a
24-year-old misses a season, and marking him down again here would charge him
twice. He is absent from the eleven and unchanged in the trade. Saying that
cleanly is only possible because R8 separated the two scales — before it, "out
of the lineup" and "worth less" were the same number.

**The NFL designation, not the manager's IR slot.** `Roster.reserveIds` was the
tempting alternative and is the wrong input. On the real league one manager
parks three players in IR slots, of whom two are merely questionable: reserve
slots are spare bench space in the offseason, so trusting them would bench a
healthy WR1 on a roster-management choice.

**Two of the five statuses that matter are not injuries.** Sleeper reports `DNR`
(reserve/did-not-report) and `NA` (not on an active NFL roster) in the same
field, and `mapInjury` dropped every word it did not recognise — reporting those
players as perfectly healthy, which is a claim, and a wrong one. The real league
rosters a receiver whose only designation is `DNR`. An unrecognised status is now
kept with its raw text and classified week-to-week, so it shows on the row and
changes no arithmetic, which is the right amount of trust to place in a word
nobody has read.

**Measured on the real 10-team league.** Five of 176 rostered players are ruled
out — Kittle (PUP), Alec Pierce (PUP), Zach Charbonnet (PUP), Ricky Pearsall
(IR), Brandon Aiyuk (DNR) — against nine merely questionable, who are untouched.

One lineup changes: Slim Pickens starts Juwan Johnson (36 win-now) in place of
Kittle (1,233), losing **1,197** and dropping from 5th to 6th. That flips two
quadrants past each other — Slim Pickens from *window closing* to *danger zone*,
Heist SZN the other way — which is the whole point restated: a team whose best
tight end will not play is not a team whose window is open.

Starter counts and both replacement levels come out **byte-identical** at every
position (QB 10, RB 28, WR 31, TE 11). That is the safety result, and it is
structural rather than lucky. Availability is a fact about a player and his own
status, so like an activity factor and unlike a value it cannot respond to the
lineups it perturbs — there is no loop for it to run around, which is the
standing hazard in this file since *The clamp was destroying the model*.

**The larger half was never the lineup — it was the need.** Surplus asks whether
a benched player would start elsewhere, and it was answering for men who could
not start anywhere. The model listed **Alec Pierce, on PUP, as a chip four other
teams would start**, with Pearsall and Charbonnet claiming one apiece. All three
are gone from the list; their dynasty value is untouched.

The reciprocal is better still. A tight-end hole at Slim Pickens is a tight-end
market for everyone else, so four other teams' benched tight ends gained a
would-start-on: Jake Ferguson 2→3, Harold Fannin 2→3, Dalton Kincaid 1→2, T.J.
Hockenson 1→2. Slim Pickens' own TE line reads 1,233 (neutral) → **36
(weakness)**, and Fannin — worth exactly nothing to them while Kittle blocked the
slot — is now worth **+510** to their lineup. That number is what the trade
engine is for, and before this it was zero.

**Cost: league-wide suggestions fall from 27 to 24**, all three on teams that
lost an injured player from their chip list. That is honest as far as it goes,
but it exposes a real gap: `movableAssets` has no category for an injured asset
at all. An injured star is one of the most-traded things in dynasty — his owner
has a reason to move him and the buyer is paid in future value — and he now
reaches the suggestion engine only if the role-trend lists happen to catch him.
Not fixed here, because inventing a movable category is a suggestion-engine
change wearing an injury change's clothes.

**Also still open:** duration. IR, PUP and a suspension are all "out" and all
different lengths, and the feed carries no return date for any of them, so they
are treated alike. A four-game PUP stint and a torn achilles are not the same
fact about a season, and pretending otherwise is the largest simplification here.

**The tests could not see it, and that pattern is now three for three.** Every
existing fixture leaves `injury` undefined, so the entire suite passed against
this change once three mechanical signature updates were made — not one existing
assertion touched a line of it, exactly as in R8. Twenty-one were added that can,
including the two halves that must not move together: an injured player is out of
this season's lineup and still in the three-year projection, because a torn ACL
this August is not a fact about 2029.

**A trade you can paste into the group chat.** *(2026-08-03, closes #12)*

Trades are argued in league chats, and until now the app could only be described
there in words. A proposal is nothing but a league, two roster ids and four lists
of asset ids, so the encoding was never the hard part — the hard part is that a
link is opened later, by someone else, against a roster that may have changed.

**Seven query parameters, not one opaque blob.** `?l=…&a=…&b=…&ap=…&ak=…&bp=…&bk=…`,
lists joined on `_` because it is one of the few characters `URLSearchParams`
leaves alone; a comma comes back as `%2C` and turns a shareable link into an
eyesore. Base64 of a JSON object was the obvious alternative and loses on both
counts that matter: it is **260 characters against 109** for the same trade, and
it cannot be read in an address bar when somebody reports that a link "opened the
wrong trade". Players and picks stay in separate parameters rather than one list
split by shape on arrival — telling them apart by hyphen works today, and makes
the format depend on a coincidence of two id schemes this app does not own.

**The URL is the state, not a copy of it.** The builder reports its selection
upward on every edit and `App` writes it with `replaceState` — `pushState` would
turn the back button into an undo history nobody asked for. Writing the link only
behind the copy button was the tempting shortcut and the wrong one: people copy
from the address bar out of habit, and a URL that silently lagged the page would
send someone the wrong offer.

Making the URL authoritative collapsed the seeding machinery rather than adding
to it. `pending: {trade, seq}` is gone; there is one `shared` trade that the
address bar, the builder's seed and the suggestion hand-off all read, plus a
`seed: {seq, dropped}` that describes whatever last arrived from outside the
builder — `seq` forces a remount, `dropped` is how much of that arrival went
missing on the way in. A fix fell straight out: switching to the Rosters tab and
back **used to discard whatever you were building**, because the builder unmounts
and re-read a seed that was only ever the last suggestion. It now re-reads the
live trade.

**Three ways a link can be wrong, and only one of them could crash.**

1. **A roster id this league does not have.** `buildSide` throws on one, so a
   hand-edited `?a=99` would take the render down rather than show a slightly
   wrong trade. Checked before the trade is handed to the builder; the page then
   opens normally with an empty calculator.
2. **An asset the sending roster no longer holds.** Rosters move, and
   `evaluateTrade` would quietly drop the missing ids and price what was left —
   a different offer under the same URL, with nothing on the page to say so. The
   count is surfaced: *"One asset in that link is no longer on the roster that
   was sending it."* Membership is checked per side rather than league-wide,
   because the asset picker only ever shows a roster its own players, so an id
   belonging to the opponent would price into the totals while appearing nowhere
   in the two columns above them.
3. **Truncated or hand-edited generally.** Chat clients stop URLs at punctuation.
   Every such failure has the same answer — ignore the trade, open the app — and
   nothing in the decoder throws.

**The bug the unit tests could not have found, and the browser found in one
click.** Pick values load in their own query, so `picks` is empty for a moment
after the league arrives. Resolving the link in that window dropped **every
traded pick** out of the trade and then told the recipient those picks were no
longer on the roster — a false statement produced entirely by asking the question
too early. `picks` is `[]` both before the values load and when a league genuinely
has none, which is why the hook now publishes `picksSettled` rather than leaving
consumers to guess which empty array they are looking at. Fifteen tests cover the
encoder, the decoder and the resolver, and not one of them could see this: the
race is in the wiring rather than in the logic.

*The `picksSettled` described above was the wrong fix, and shipped that way. It
watched one of the two queries the pick list is built from, so it closed the
window it was written for and left an identical one open. See the correction
below.*

**Link previews are static, and necessarily so.** The issue pairs permalinks with
an OG image, and a card describing the *specific* trade cannot be built here — a
scraper reads the HTML exactly as served, without running JavaScript, so every
trade link previews identically no matter what the page later draws. Per-trade
cards need a server, which §3.1 rules out for v1. `index.html` gets honest static
tags — "a trade calculator that knows your league", plus an instruction to open
the link — rather than a card naming two players it might not contain.

A favicon change went in alongside, on a diagnosis that was wrong, and the
correction is worth more than the change was. `/vite.svg` reads as root-absolute
on a site served from a project subpath, and was written up here as having 404ed
in production, and in every link preview, since Phase 0. It never did. Vite
rewrites root-absolute URLs in `index.html` against `base` at build time, so the
tag has always shipped as `/Dynasty-Trade-Calculator/vite.svg` and has always
resolved — confirmed by building both revisions and reading the output. The
reference is back as it was. The relative `./vite.svg` that briefly replaced it
also worked, but it resolves against the document URL rather than against `base`,
which is the weaker of the two guarantees, and it was bought for nothing.

The lesson is not about favicons. A bug was asserted from reading the source,
in a build system whose entire job is to rewrite that source, and it went into
this document as established fact next to claims that had actually been tested.
A wrong entry here is worse than a wrong line of code, because the code gets
re-read and this gets cited.

**Four bugs in the wiring, and the harness that would have caught them.**
*(2026-08-03, #38 and #41)*

The permalink work above shipped with four defects, none of them in `lib/share`
and none of them visible to a suite of 375 passing tests. That is the finding
worth recording; the individual bugs are almost incidental to it.

**The address bar was cleared on mount.** `shared` is null on the first commit
and the league id is already set from the link, so the effect that keeps the URL
current wrote the bare path immediately — deleting the trade a second or more
before the league arrived to put it back. A refresh on a slow connection, or a
league that failed to load, left the recipient holding a link to nothing. The
entry above argues at some length that a URL which *lagged* the page would send
someone the wrong offer; the first implementation did worse than lag.

Fixing it needed a distinction the code did not have. `fromLink` is null both
before the league arrives and after a link is judged unusable, and only the first
deserves protection — `linkDecided` now says which, and an unhandled link is left
strictly alone.

**`picksSettled` watched the wrong thing.** The pick list is derived from the
DynastyProcess pick table *and* `adjusted` from FantasyCalc: two hosts, two
caches, racing from one trigger. Watching only the pick query meant the flag went
true while `picks` was still empty, which is the same bug the flag was invented to
prevent. A returning user with a warm pick cache and an expired value cache hits
it on the common path, not a rare one — and the failure was worse than the
original, because the false "no longer on the roster" warning then erased itself
when the values landed, leaving a silently pick-less trade with nothing on screen
to say so.

The verification that missed it is instructive: *"against the real league with
`localStorage` cleared"*. Clearing storage forces both caches cold, which is the
one starting state that hides a race between two independently cached sources.
The flag now tracks the derived list rather than one of its inputs.

**The dropped-asset notice outlived its trade**, because it was read from a link
parsed once at module scope and so was fixed for the session — still on screen
after a Clear, still accusing a trade opened from a suggestion. It now travels
with the arrival that caused it and retires at the first edit.

**A trade survived a league switch**, seeding the builder with roster ids from
the previous league. `buildSide` throws on one of those, so the render went down
— the crash `resolveShare` guards the front door against, reached through the
back. Notably `useMyRoster` had this right from the start: it re-reads on a
league change rather than carrying the old value across. The correct pattern was
one file away.

**What the tests could not see, and now can.** Three of the four were ordering
bugs, and the end state was correct in every one of them — which is exactly why
unit tests could not catch them and why a test that waits for everything to
settle before asserting cannot either. There are now two vitest projects:
`.test.ts` runs in node, `.test.tsx` gets jsdom. The DOM tests *drive* resolution
order rather than waiting on it, and the pick-race test asserts an invariant
across every render rather than the final state — `picksSettled` must never be
true while `picks` is empty.

Every regression test was checked against the commit before the fix, and fails
there. That bar is not ceremony: a test written only against fixed code proves
that it runs, not that it works, and an ordering bug is precisely the kind that
passes by getting lucky with timing.

**A full read of the repo, with nothing shipping.** *(2026-08-03)*

Not a feature. A deliberate stop to read everything at once — config, CI, engine,
components, the data pipeline, this document — looking for the things that only
show up when you stop working on what you were working on.

Most of what it found was drift rather than defect, and the pattern was
consistent: **the code was in better shape than the writing about the code.**
Every substantive commit for a month updated this file, and the two immediately
prior had not, so it described a permalink architecture that no longer existed
and a `picksSettled` that had already been proven wrong. §9 still nominated a
next step three milestones stale, and still listed a kicker-pricing problem
closed a week earlier. §8 credited a `ValueSource` interface and a DynastyProcess
fallback, neither of which was ever built.

The two findings worth remembering:

**The favicon was the Vite logo.** Two pull requests argued about the *path* to
`vite.svg` — one asserting it 404'd, one proving it never had, each writing a
paragraph into this document about the importance of checking claims — and
neither opened the file. It had been the stock purple triangle since the
scaffold. The product now has its own mark: two arrows passing, which is the
whole thesis in a glyph legible at 16px. It is **interim** and labelled as such
in the file — it exists because shipping someone else's logo is worse than
shipping a plain one, not because the brand question has been answered. That
belongs to the design system work (#15). `og:image` was missing entirely for the
same reason nobody noticed the icon; the link previews that permalinks exist to
produce were shipping as text in a box. `public/og.png` is generated by
`npm run og`, which rasterises the same glyph without a dependency, a font, or a
headless browser — the composition is two polygons on a gradient, so a PNG
encoder over `zlib` is the entire cost.

**An outage of FantasyCalc took the whole app down while the values sat in
IndexedDB.** `cached()` discarded an expired entry the moment a refresh failed,
so a source being briefly unreachable cost the user the league render rather than
a few hours of freshness. Player values gate everything, so this was the one true
single point of failure in a design that otherwise degrades well — pick values
already fell back to a warning and kept going. A failed refresh now serves the
last good copy. That is not a substitute for a second value source, which is
still the real answer and still absent.

The rest: three exported symbols nobody imported, a `res.json()` that could throw
past the error type built to make failures legible, a `typeof null === 'object'`
guard, a tablist that announced arrow-key navigation it did not implement, and
one constant reachable by two import paths. Tests went to the four modules that
had none and deserved them most — `summarize`, which carries two historical bugs
in its docstring and had never been tested directly; the FantasyCalc mapping and
its shared-divisor invariant; `parseLeagueId`, the only thing standing between a
stranger's paste and a fetch; and `cached` itself.

**What the trade does to your season.** *(2026-08-03, closes #13)*

Every other number this app produces is a valuation. This one is a consequence.
"+312 starting lineup" is a quantity a manager has to interpret; "34% to 51%" is
not, and it is the first thing here that answers *does this help me* in the units
the question was asked in.

It also became possible only recently. The issue was written expecting
`starterValue` as the per-roster strength input, and until #8 that number was a
dynasty ranking — simulating a season off it would have been asking which roster
is worth most in 2029 and reporting the answer as this year's playoff odds.
Win-now value is the input this needs, and it landed two features ago.

**Sleeper does not publish a schedule.** It answers per week with a row per
roster carrying a `matchup_id`, and two rows sharing one *is* a fixture, so a
season has to be reassembled by grouping — one request per week, fanned out
together rather than walked. Anything that does not resolve to a clean pair is
dropped: a null `matchup_id` is a roster with no game, and a group of one is the
bye an odd number of teams produces. Inventing an opponent would put a game in
the simulation that nobody plays.

It arrives through `LeagueProvider`, as an *optional* method. A platform that
cannot supply a schedule loses this feature and nothing else, which is a better
bargain than a required method some future provider has to satisfy by lying —
and #11 inherits the seam either way. The schedule is its own query for the same
reason: it costs a request per week, and no roster, value or trade calculation
should wait on it.

**Two constants carry the model**, and the ratio between them is the whole
argument: 7 fantasy points per standard deviation of lineup strength, against a
28-point weekly spread. That makes a team a full SD above average win about 57%
of the time — the right order, because strong fantasy teams win comfortably more
often than they lose and nothing like always. Understating the noise would be the
more dangerous error: it would make the odds look decisive, and a confident wrong
number is worse than an honest vague one.

Strength enters as a z-score against the team's own league rather than converted
to points. `starterValue` is a sum of league-adjusted values whose units depend
on the value source and the lineup settings, so an exchange rate to fantasy
points would be invented. What is meaningful is where a roster sits among the
rosters it actually plays.

**The seeding was wrong in a way that looked right.** Each iteration was keyed on
`seed + i`, so seeds 1 and 2 share every stream but one and produce odds
differing by at most a single iteration — usually not at all. A test asserting
that the seed changes the answer is what caught it; iteration seeds are mixed
now, not added. Seeding per iteration rather than one stream across the run also
means nothing can depend on the order teams or fixtures are visited in, which is
its own test.

**Before and after both substitute.** The obvious version leaves the "before" run
on the strengths that arrived from `RosterSummary` and only replaces lineups in
the "after" — but those two numbers come from different code paths, and any day
they disagreed the difference would surface as a swing in the odds attributed to
a trade that had not caused it. Taking both ends from the same `evaluateTrade`
result makes the delta mean exactly one thing.

Checked against a realistic 12-team league at week 8: a 6-1 team with the best
roster reads 98.9%, a 2-5 team with the worst reads 1.7%, the bubble sits between
55% and 62%, and a trade worth 150 of lineup strength moves a bubble team from
28.9% to 39.1%. The odds sum to exactly 6.000 against six places, which is now a
test — off-by-one seeding or a double-counted team breaks it and nothing else
would notice.

**It runs in a worker**, which 62ms per simulation makes look unnecessary until
you count: the panel needs two runs and re-runs them on every checkbox tick, and
the phone a trade actually gets argued on is several times slower than the
machine that was measured. Replies are correlated by id, because odds for a trade
the user has already edited past are worse than no odds at all.

**The two constants are now measured, not assumed.** *(2026-08-03)*

Shipping them hardcoded left this as the one place in the app still reasoning
from a generic league rather than the one in front of it — precisely what the
README criticises every other calculator for. Sleeper's matchup rows already
carry `points` for completed weeks, so the schedule was fetching the evidence and
throwing it away.

`weeklySD` is pooled *within* team: each roster's variance about its own average,
averaged. That distinction is the measurement. The spread of all scores in the
league mixes how much a team bounces week to week with how much teams differ from
one another, and only the first is the noise the simulation needs. `pointsPerSD`
is the slope of average points on lineup strength in standard units, which is
exactly the question the constant asks.

The pairing is imperfect and worth saying so: strength is the best lineup a
roster could field *today*, while the points are what it scored weeks ago with
whatever it started, possibly with players it has since traded away.

**A threshold was the wrong tool, and measuring showed it.** The first version
refused any estimate below four weeks and accepted it wholesale above. Run against
a synthetic season with known parameters, the raw slope swung between 2.5 and 11.5
over four to six weeks against a true 9 — and 2.5 reports a strong roster as a
coin flip, which is worse than the assumption it replaced. A cutoff has both
failures at once: it refuses good evidence at three weeks and swallows bad
evidence at four.

Shrinking toward the assumption in proportion to the evidence fixes it, with a
half-life of six weeks. Averaged over 200 synthetic seasons, mean absolute error
in `pointsPerSD` falls from 2.00 with the flat assumption to 1.55 at three weeks
and 1.28 at thirteen, while `weeklySD` recovers 25.8 against a true 26. Better
than either the raw measurement or the flat assumption at every sample size, and
no longer a cliff.

Only the two parameters that matter are shrunk. The baseline sets the level and
nothing depends on it, so it is taken as measured — there is no wrong answer to
shrink away from. A negative slope floors at zero, because over a handful of weeks
"the weaker rosters scored more" is noise rather than a discovery, and it is then
blended up from there: measuring no relationship is not proof there is none.

The panel says which basis it used. Odds carry more authority than they have
earned, and the difference between a number tuned to your league and one assumed
from a typical one belongs where the user can find it.

---

### What comes next

Not here. The ordered backlog is [`ROADMAP.md`](ROADMAP.md), tracked as issues
under [#19](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/19) —
multi-platform providers, playoff odds for a proposed trade, the start/sit
optimizer, and the design-system work, in dependency order rather than
preference order.

Keeping a second list here is what produced the drift described at the top of
this section, so this heading deliberately holds no items.

**Phases 0–2 delivered the original project goal.** Everything past that is upside.

---

## 6. Existing Code — Current State

*This section describes the scaffold as found on 2026-07-25, before Phase 0. It
is kept as a record of what was rescued; every row has since been actioned.*

Remote: `kfsalem/Dynasty-Trade-Calculator` (**was empty — 0 commits**).
Working copies: `C:\GitHub Projects\` on Windows, `~/Documents/Github Projects/`
on macOS.

| File | State | Action |
|---|---|---|
| `src/types/index.ts` | **Good** — 59 lines, solid domain model | **Keep and extend** |
| `src/App.tsx` | Stock Vite counter demo | Replace |
| `src/components/*.tsx` (×3) | **Empty files (0 bytes)** | Write |
| `src/data/players.ts` | **Empty (0 bytes)** | Delete — superseded by live APIs |
| `src/utils/tradeCalculator.ts` | **Empty (0 bytes)** | Becomes `engine/` |
| `README.md` | Stock Vite template | Rewrite |
| Tooling | Vite 7, React 19, TS 5.8, Tailwind 4, ESLint 9 | Current — keep |

The existing `types/index.ts` is genuinely good and survives largely intact. Needed additions:

- `League`, `LeagueSettings`, `Roster`, `DraftPick`, `Transaction`
- `Position` must gain `'SUPERFLEX' | 'FLEX'` handling for lineup slots
- `Player` gains a `platformIds` map (`sleeperId`, `mflId`, …) for cross-platform resolution
- `TradeAnalysis` gains VORS deltas and per-side contention impact

`src/data/players.ts` should go. Static player data would be stale within a week; the whole design rests on live sources.

---

## 7. Decisions & Open Questions

**Decided 2026-07-25:**

1. **Audience — public.** Anyone with a league ID, no login. Onboarding must therefore assume a stranger who has never seen the app: the league-ID entry path needs to be obvious and forgiving (accept a raw ID, a Sleeper URL, or a username → league picker).
2. **No accounts, no backend.** localStorage holds league ID, "my team," and saved scenarios. This is reassessed only if cross-device sync is genuinely wanted.

**Decided since:**

3. **Superflex — handled, and it falls out of the model rather than being special-cased.** `numQbs` is read from Sleeper's `roster_positions` at import, and `SUPER_FLEX` is a first-class lineup slot in `FLEX_ELIGIBILITY`. Nothing downstream tests for superflex: twenty quarterbacks having to start raises the replacement level on its own, which is the whole argument for deriving starter counts from real lineups. This was carried as an open question long after it stopped being one.

**Still open:**

4. **How much history?** Sleeper exposes full transaction history. Worth mining for "who trades with whom / who overpays," but it is a scale-out nicety rather than anything the thesis needs.

---

## 8. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Abandoned again** | **Highest** | Tiny phases, each ending in something shippable. |
| FantasyCalc is unofficial and could change or close | Medium | Zod fails loudly at the boundary; `cached()` serves the last good copy when a refresh fails, so an outage costs freshness rather than the app. **No second source for player values** — see below |
| Sleeper rate limits / 5 MB blob | Low | 24h IndexedDB cache, well under 1000/min |
| Value-scale mismatch between sources | Medium | Normalize to a common basis before any comparison — never mix raw numbers |
| Trade suggestions nobody accepts | Medium | Require *both* sides to gain; always show "why they say yes" |
| Scope creep | Medium | Phases 0–2 are the original goal. Ship those before touching anything else. |

**On that FantasyCalc row.** It read, until 2026-08-03, "`ValueSource` interface;
DynastyProcess as a live fallback; Zod fails loudly at the boundary." Two of those
three were fiction. There is no `ValueSource` interface anywhere in the repo, and
DynastyProcess supplies pick values and an id crosswalk — never player values, so
it could not stand in for FantasyCalc if it wanted to.

A risk register describing a safety net nobody built is worse than one that
leaves the box empty, because the empty box gets filled. What exists now is the
cache fallback: a failed refresh serves the last good copy rather than throwing,
which converts an outage from a dead app into stale numbers.

That covers a bad ten minutes for a returning user, and nothing else — a first
visit during an outage has nothing to serve, and shape drift fails loudly at the
Zod boundary, which is correct and also terminal. A genuine second source is
still the right answer and is tracked as
[#43](https://github.com/kfsalem/Dynasty-Trade-Calculator/issues/43), where the
hard part is named: two markets have to land on one scale before either can be
compared, and the win-now split depends on that scale holding.

## 9. Where the product stands

The thesis is shipped. The app imports a league, values every roster against its
real lineup settings on both a dynasty and a win-now scale, evaluates a trade,
analyses your team, proposes offers both sides accept, and hands the result over
as a link you can paste into a group chat.

**This section deliberately does not name the next task.** It used to, and it was
wrong within a week — still proposing Phase 5 and saved scenarios while three
milestones of activity-based valuation shipped past it, and still listing an
unpriced-kickers problem that had already been fixed. A document updated by hand
cannot track a queue; the queue is [`ROADMAP.md`](ROADMAP.md) and the issues it
maps to, and those move on their own.

What is worth recording here is the standing context a plan does not carry:

- The model is verified against a real league (`1336802780030988288`, "The
  Eternal Rebuild") rather than only synthetic fixtures, and that habit is what
  has surfaced most of the corrections in the running record above. A finding
  from a real roster outranks a passing test.
- That league is **1QB, not superflex**, and superflex swings quarterback values
  hard. Both formats work; a check on one is not a check on both.
- Kickers and defences are excluded from the maths and kept on the roster
  (closes #10) — the earlier note here, that they silently contribute zero to a
  lineup slot, describes behaviour that no longer exists.
