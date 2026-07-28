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

Sequence: **Sleeper → MFL → Fleaflicker → (ESPN/Yahoo only if demand justifies a backend).**

---

## 3. Architecture

### 3.1 The headline decision: no backend for v1

Every data source is keyless, public, and CORS-enabled. **The entire v1 runs as a static client-side app.**

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

Two scores per team:

- **Now score** — projected 2026 starting lineup strength
- **Future score** — age-adjusted value at a 2–3 year horizon

Plot as a quadrant:

| | Strong now | Weak now |
|---|---|---|
| **Young** | Juggernaut — press the advantage | Rebuilding on schedule — stay patient |
| **Old** | Window closing — go all-in *now* | **Danger zone** — tear down immediately |

This drives "what should I focus on this year," and it drives trade suggestions: contenders buy win-now, rebuilders sell for picks. A trade is far likelier to be accepted when the two teams sit in opposite quadrants.

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
2. Find complementary pairs — your surplus ↔ their need, and their surplus ↔ your need
3. Generate candidate packages (players and picks) within a value tolerance (~±5–8%)
4. Score by: value balance × **your** VORS gain × **their** VORS gain × contention-window fit
5. Rank, and prune to a handful of genuinely plausible offers

**Ship the "why they say yes" explanation alongside every suggestion.** A suggestion the other manager instantly rejects is worthless. Showing *their* upside in *their* terms is the feature people will actually come back for — and no major calculator does it.

Guard against the obvious failure mode: suggestions that are lopsided in your favor. If the engine only optimizes your side, it produces offers nobody accepts. Require both sides to gain.

---

## 5. Roadmap

Sized deliberately small. This project was abandoned once; **momentum is the real risk**, so every phase ends in something visible and shippable.

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
  actually fields — `leagueValue = max(0, market - replacement(position))`
- **Realistic rookie pick values**: projected draft slot from the standings,
  plus a hard cliff after roughly pick 15 and near-zero third-rounders
- **Anti-tanking**: no contention window weights the present below 0.35, and the
  danger-zone advice no longer says "tear down aggressively"
- Every value now carries both a `marketValue` and a league-adjusted `value`
- 16 new tests (111 total); verified on the real league

**Four findings:**

1. **Nothing is hand-tuned per position, and it did not need to be.** The
   starter counts come from real best lineups, so scarcity falls out on its own.
   On the real league: QB 10 starters, RB 27, WR 32, TE 11 — the ten FLEX slots
   resolved to roughly 7 RB, 2 WR, 1 TE, which is precisely why running back
   scarcity bites hardest. Elite backs keep 82% of market value, receivers 78%,
   tight ends 73%, and the best quarterback alive keeps 50%. The five largest
   drops in the league are all quarterbacks. Change the lineup settings to
   superflex and quarterbacks recover automatically, because twenty of them
   would have to start.

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

**Cost:** league-wide suggestions fell from 36 to 18. That is the intended
direction — quarterback-for-quarterback filler no longer clears the bar — but
it is a real reduction in variety, driven by how few assets carry meaningful
value once replacement is subtracted.

### Phase 5 — Scale out
- MFL + Fleaflicker providers
- Real accounts (Supabase) *if and only if* cross-device sync is actually wanted
- Saved trades, alerts

**Phases 0–2 deliver the original project goal.** Everything past that is upside.

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

**Still open:**

3. **Superflex?** Your league's format sets the default `numQbs`, and superflex radically changes QB values (compare Josh Allen at `numQbs=2` vs `numQbs=1`). Read from Sleeper's `roster_positions` at import — but worth confirming the app handles a `SUPER_FLEX` slot correctly in Phase 1.
4. **How much history?** Sleeper exposes full transaction history. Worth mining for "who trades with whom / who overpays," but it's a Phase 5 nicety.

---

## 8. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Abandoned again** | **Highest** | Tiny phases, each ending in something shippable. Phase 0 today. |
| FantasyCalc is unofficial and could change or close | Medium | `ValueSource` interface; DynastyProcess as a live fallback; Zod fails loudly at the boundary |
| Sleeper rate limits / 5 MB blob | Low | 24h IndexedDB cache, well under 1000/min |
| Value-scale mismatch between sources | Medium | Normalize to a common basis before any comparison — never mix raw numbers |
| Trade suggestions nobody accepts | Medium | Require *both* sides to gain; always show "why they say yes" |
| Scope creep | Medium | Phases 0–2 are the original goal. Ship those before touching anything else. |

---

## 9. Immediate Next Step

**Phase 5.** Phases 0–4 are shipped: the app imports a league, values every roster against its real lineup settings, evaluates a trade, analyses your team, and proposes offers both sides accept. That is the whole product thesis.

Everything from here is scale-out rather than new ground, so the next step is a choice rather than an obligation:

- **MFL provider** — the `LeagueProvider` seam has never been exercised by a second platform. Until it is, "not limited to Sleeper" is a claim, not a fact.
- **Saved scenarios** — localStorage already holds the league id and claimed team; saved trades are the obvious third thing, and need no backend.
- **Accounts (Supabase)** — only if cross-device sync is genuinely wanted.

Phase 4 has now been verified against the real league (`1336802780030988288`, "The Eternal Rebuild"), which is what surfaced findings 4 and 5 above. Two smaller things that run showed, neither urgent:

- **10.2% of rostered players are unpriced** (18 of 176) — almost entirely kickers and defenses, which start in this league but have no dynasty market. They count as 0, which is right for trade value but means a lineup slot silently contributes nothing.
- The league is **1QB, not superflex**, and the earlier synthetic check was superflex. Both work; worth keeping a 1QB league in mind when reasoning about QB values.
