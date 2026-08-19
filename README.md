# Dynasty Utility

A dynasty fantasy football companion that knows **your league**, not just generic player values.

Most trade calculators are roster-blind. They tell you two players are worth the same and stop there. This one imports your actual league — your lineup slots, your scoring, your eleven league mates — and answers the question you actually have:

> This trade is even on raw value, but it's bad for you. You're already three deep at RB and you'd be starting a replacement-level TE. Team 4 is desperate at RB and has surplus TE. Offer them this instead, and here's why they say yes.

## Status

The core product is complete. Sleeper leagues are fully supported; other
platforms are not yet.

- [x] **League import** — paste a Sleeper league ID, see every roster
- [x] **Trade calculator** — league-aware values, players and draft picks
- [x] **Team analysis** — strengths, weaknesses, contention window, surplus
- [x] **Trade suggestions** — ranked offers, and why the other manager accepts
- [x] **Weekly lineup** — the lineup you have set against the one you could field

Live: **https://kfsalem.github.io/Dynasty-Trade-Calculator/**

The lineup panel is the one part of this that has a deadline. It reads the
lineup your platform has on file, rebuilds the best legal one from the same
roster, and reports only the slots where the two disagree — an empty slot, a
starter who is out this week, a man on your bench who is simply better. It is
ranked on win-now value corrected for role, not on weekly projections: there are
no matchups in it, and no bye weeks, and it says so rather than implying a
precision it does not have.

The trade calculator reports two numbers per side. **Net value** is what every
other calculator shows. **Starting lineup** is the change in the best lineup
that side can field — and it is the one that matters. Winning a trade on raw
value while your starters get worse is common, and it is the whole point.

## Values are league-specific

Every asset carries two numbers: the **market** value your league mates will
quote, and what it is actually worth **in your league**.

The difference is replacement level. In a 10-team single-QB league every manager
already starts a top-10 quarterback, and the next one is sitting on waivers — so
losing yours costs far less than the market says. Running backs are the
opposite: the supply of true 15–20 touch backs runs out not far past the number
who have to start, so an elite back keeps most of his value. On a real 10-team
league the best running back keeps 82% of his market value and the best
quarterback 66%.

None of this is hardcoded per position. Starter counts are read from the lineups
the league actually fields, so a superflex league raises quarterbacks back on
its own — twenty of them have to start.

The adjustment is `market² / (market + replacement)`, which is the same thing as
subtracting replacement level *scaled by how far clear of it a player is*. Far
above replacement it is plain subtraction. Near it the charge shrinks with the
surplus it comes out of, so it can never overtake it.

That distinction is the whole model. Subtracting a flat replacement level is a
points-space operation, and a dynasty value is a price — so straight subtraction
put a starting NFL running back 34x behind an elite one who is 4.4x his market
price, and made the league's best roster read 3.9x its worst against a market
gap of 1.8x. A player below replacement is not startable this week, but an aging
starter or an unproven rookie is still a real asset.

Rookie picks are priced by *absolute pick number*, never by round, because the
supply of NFL talent does not care how many teams are in your league. A class
yields roughly 10–15 offensive players who matter in their first two years, so
value falls off a cliff and late picks are lottery tickets — but that cliff comes
out of the source, which already drops 28x between the first pick and the
twentieth. An earlier version imposed a second cliff on top of it and priced a
second-rounder at a sixth of a waiver-wire running back.

Reading the pick number also gets league size right for free: a 10-team 3.01 is
the 21st pick and a 14-team 3.01 is the 29th, so the same label is worth three
times more in the smaller league. Draft slots come from the league's own
published order once it is set, so a pick is priced as the 1.09 it actually is
rather than as a generic first; for seasons nobody has drafted yet they are
projected from roster strength and labelled as projections. Either way a bottom
team's first is worth several times the champion's, and this year's class
disappears once your league has actually drafted.

Trades are still *balanced* on market value, because that is the number the
other manager will check. Whether a trade helps is judged on the league-adjusted
one.

Claim your team with your Sleeper username to get personalized analysis: your
contention window, your positional strengths and weaknesses against the league,
and which of your bench players other teams would actually start.

**Trade ideas** searches the whole league for offers that leave both teams
better off, and ships the reason the other manager accepts alongside each one.
"Better off" is deliberately not the same measure for both sides: a team with a
closing window is scored almost entirely on what a trade does to its starting
lineup this year, and a team in the danger zone almost entirely on where it
leaves them in three. Requiring both to gain *starting-lineup strength* would
rule out the most common dynasty trade there is — a rebuilder sending a veteran
to a contender for picks — because picks never start.

See [`docs/DESIGN.md`](docs/DESIGN.md) for the architecture and the reasoning
behind every model decision, and [`docs/ROADMAP.md`](docs/ROADMAP.md) for what is
planned next.

## How it works

No backend, no accounts, no API keys. Every data source is public, so the whole app runs client-side as a static site.

| Source | Provides | Fetched |
|---|---|---|
| [Sleeper API](https://docs.sleeper.com/) | Leagues, rosters, settings, traded picks, transactions | In the browser |
| [FantasyCalc](https://fantasycalc.com/) | Player values, parameterized by dynasty/superflex/PPR/team count | In the browser |
| [DynastyProcess](https://github.com/dynastyprocess/data) | Draft pick values (FantasyCalc has none), player ID crosswalk | Browser / build |
| [nflverse](https://github.com/nflverse/nflverse-data) | Weekly snaps, target share, air yards, WOPR, depth charts | Build |

FantasyCalc also supplies cross-platform player IDs (`sleeperId`, `mflId`, `espnId`, `fleaflickerId`), which is what makes supporting platforms beyond Sleeper tractable.

nflverse is the one source a browser cannot reach. It publishes as GitHub release
assets, which send no CORS header, and its depth chart file is 53 MB. `npm run
ingest` fetches and reduces it in CI instead, shipping a few hundred KB of
Sleeper-keyed JSON as static assets — so the app stays backend-free. See
[`docs/DATA.md`](docs/DATA.md).

## Development

Requires Node `^20.19 || >=22.12` (Vite 7). `.nvmrc` pins 22, and CI reads that
same file, so local and CI cannot drift apart. With `nvm` or `fnm`:

```bash
nvm use     # or: fnm use
```

The requirement is enforced rather than documented: `engines` in `package.json`
plus `engine-strict` in `.npmrc` means a wrong version fails at `npm install`
with the version it wanted, instead of surfacing later as
`TypeError: crypto.hash is not a function` when Vite starts.

```bash
npm install
npm run dev        # dev server
npm run typecheck  # tsc -b across all three projects
npm run build      # typecheck + production build
npm run lint
npm run test
npm run ingest     # refresh public/data from nflverse
npm run og         # regenerate public/og.png, the link-preview card
```

Use `npm run typecheck`, not `tsc --noEmit`. The root `tsconfig.json` is
`files: []` plus project references, so `tsc --noEmit` resolves nothing and
exits 0 on a codebase that does not compile. Only `tsc -b` walks the
references.

`npm test` runs two suites in one command: logic in Node, and anything that
mounts a component in jsdom.

## Stack

Vite 7 · React 19 · TypeScript 5.8 · Tailwind 4

Tailwind 4 is configured CSS-first via `@theme` in `src/index.css` — there is no `tailwind.config.js`, and the Vite plugin replaces PostCSS entirely.
