# Skills

Agent skills available in this repo. One is ours; the rest are vendored
third-party, unmodified, with their licences retained.

## Precedence

**`design-system` is authoritative for this project.** It encodes decisions that
were measured rather than chosen — most importantly a position palette validated
against colour-vision deficiency. The general design skills below know nothing
about this app; where they disagree with `design-system`, `design-system` wins.

Use the general skills for what `design-system` does not cover: inventing a
layout for a new surface, copy, motion, critique. Do not use them to relitigate
tokens, the position palette, density, or the accessibility rules.

## Installed

| skill | source | licence | what it is |
|---|---|---|---|
| `design-system` | ours | — | This project's tokens, palette, density and a11y rules. See `docs/DESIGN-SYSTEM.md`. |
| `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/frontend-design) | Apache-2.0 | Aesthetic direction for new UI. Best for greenfield surfaces — e.g. the onboarding screen in #17. |
| `webapp-testing` | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/webapp-testing) | Apache-2.0 | Playwright driving a **local** app: viewports, interaction states, screenshots, console logs. Serves #18 and #16. |
| `web-artifacts-builder` | [anthropics/skills](https://github.com/anthropics/skills/tree/main/skills/web-artifacts-builder) | Apache-2.0 | Builds standalone claude.ai artifacts. **See the scope note below.** |

Vendored from `anthropics/skills@f17010c` on 2026-08-08, unmodified. To update,
re-copy from upstream rather than editing in place — a locally edited copy
silently diverges and stops being updatable.

## Scope note: `web-artifacts-builder`

**This skill does not apply to the Dynasty Utility app.**

It builds standalone claude.ai artifacts: `scripts/init-artifact.sh` scaffolds a
throwaway project and `scripts/bundle-artifact.sh` collapses it into a single
HTML file. This app is a Vite + React site deployed to GitHub Pages by
`.github/workflows/deploy.yml`, and bundling it into one HTML file would destroy
the build.

It is installed for building artifacts *alongside* the project — a shareable
mockup, a one-off visualisation, a prototype to look at before committing to
`src/`. Never point it at `src/`.

## Not vendored: `impeccable`

[pbakaus/impeccable](https://github.com/pbakaus/impeccable) (Apache-2.0) is
installed as a **plugin**, not vendored here. It is ~3.2 MB across 147 files,
mostly executable `.mjs` — an anti-pattern detector and a live-browser harness
with its own `npx` entry point — and the author ships a marketplace manifest for
exactly this purpose. Copying it in would bloat the repo and freeze it at one
version.

```
/plugin marketplace add pbakaus/impeccable
/plugin install impeccable@impeccable
```

It provides `/impeccable audit`, `/impeccable critique`, `/impeccable polish`
and about twenty more. Its product mode is aimed at dashboards, which is what
this is.
