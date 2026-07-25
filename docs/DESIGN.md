# Dynasty Utility — Design Document

**Status:** Draft v1
**Last updated:** 2026-07-25
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

### Phase 2 — Trade calculator
- FantasyCalc values wired to real league settings (superflex, PPR, team count)
- DynastyProcess pick values, including traded picks from Sleeper
- Two-sided trade builder, raw value + VORS
- **Ship:** the original goal, now league-aware — already better than KTC for your league

### Phase 3 — Team analysis
- Strengths/weaknesses vs. league median
- Contention quadrant, age curves
- "Focus this year" summary
- **Ship:** the "know my team" half of the vision

### Phase 4 — Trade suggestions
- Surplus/need matching across the league
- Ranked packages with "why they say yes"
- **Ship:** the feature that makes it worth showing strangers

### Phase 5 — Scale out
- MFL + Fleaflicker providers
- Real accounts (Supabase) *if and only if* cross-device sync is actually wanted
- Saved trades, alerts

**Phases 0–2 deliver the original project goal.** Everything past that is upside.

---

## 6. Existing Code — Current State

Local: `C:\GitHub Projects\Dynasty-Trade-Calculator` · Remote: `kfsalem/Dynasty-Trade-Calculator` (**empty — 0 commits**)

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

**Phase 0.** The current repo has zero commits — every file on disk is untracked and exists in exactly one place. That is the most pressing problem in this document, and it is roughly an hour of work to fix.
