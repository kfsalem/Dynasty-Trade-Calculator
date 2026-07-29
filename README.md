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

Live: **https://kfsalem.github.io/Dynasty-Trade-Calculator/**

The trade calculator reports two numbers per side. **Net value** is what every
other calculator shows. **Starting lineup** is the change in the best lineup
that side can field — and it is the one that matters. Winning a trade on raw
value while your starters get worse is common, and it is the whole point.

## Values are league-specific

Every asset carries two numbers: the **market** value your league mates will
quote, and what it is actually worth **in your league**.

The difference is replacement level. In a 10-team single-QB league every manager
already starts a top-10 quarterback, and the next one is sitting on waivers — so
losing yours costs almost nothing, whatever the market says. Running backs are
the opposite: the supply of true 15–20 touch backs runs out not far past the
number who have to start, so an elite back keeps most of his value. On a real
10-team league the best running back kept 81% of his market value and the best
quarterback 49%.

None of this is hardcoded per position. Starter counts are read from the lineups
the league actually fields, so a superflex league raises quarterbacks back on
its own — twenty of them have to start.

A player below replacement level keeps a small share of his market value rather
than dropping to nothing. He is not startable this week, but an aging starter or
an unproven rookie is still a real asset, and flattening the whole tail onto zero
made the app unable to tell any of them apart.

Rookie picks get the same treatment. An NFL class yields roughly 10–15 offensive
players who matter in their first two years, so pick value falls off a cliff
after about pick 15 and late picks are lottery tickets. The curve reads *absolute
pick number*, never round, because the supply of NFL talent does not care how
many teams are in your league — which is why a third-rounder is worth more in a
10-team league than in a 14-team one. Draft slots are projected from the
standings, so a bottom team's first is worth several times the champion's, and
this year's class disappears once your league has actually drafted.

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

See [`docs/DESIGN.md`](docs/DESIGN.md) for the full architecture and roadmap.

## How it works

No backend, no accounts, no API keys. Every data source is public and CORS-enabled, so the whole app runs client-side as a static site.

| Source | Provides |
|---|---|
| [Sleeper API](https://docs.sleeper.com/) | Leagues, rosters, settings, traded picks, transactions |
| [FantasyCalc](https://fantasycalc.com/) | Player values, parameterized by dynasty/superflex/PPR/team count |
| [DynastyProcess](https://github.com/dynastyprocess/data) | Draft pick values (FantasyCalc has none) |

FantasyCalc also supplies cross-platform player IDs (`sleeperId`, `mflId`, `espnId`, `fleaflickerId`), which is what makes supporting platforms beyond Sleeper tractable.

## Development

Requires Node 20.19+ (Vite 7).

```bash
npm install
npm run dev      # dev server
npm run build    # typecheck + production build
npm run lint
```

## Stack

Vite 7 · React 19 · TypeScript 5.8 · Tailwind 4

Tailwind 4 is configured CSS-first via `@theme` in `src/index.css` — there is no `tailwind.config.js`, and the Vite plugin replaces PostCSS entirely.
