# Dynasty Utility

A dynasty fantasy football companion that knows **your league**, not just generic player values.

Most trade calculators are roster-blind. They tell you two players are worth the same and stop there. This one imports your actual league — your lineup slots, your scoring, your eleven league mates — and answers the question you actually have:

> This trade is even on raw value, but it's bad for you. You're already three deep at RB and you'd be starting a replacement-level TE. Team 4 is desperate at RB and has surplus TE. Offer them this instead, and here's why they say yes.

## Status

Early. The scaffold builds and deploys; features are being built in order.

- [ ] **League import** — paste a Sleeper league ID, see every roster
- [ ] **Trade calculator** — league-aware values, including draft picks
- [ ] **Team analysis** — strengths, weaknesses, contention window
- [ ] **Trade suggestions** — ranked offers, and why the other manager accepts

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
