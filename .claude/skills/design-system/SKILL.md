---
name: design-system
description: THIS PROJECT'S design system — tokens, position colours, density, light/dark rules. Authoritative for Dynasty Utility and wins over any general design skill. Load BEFORE styling or restyling any component, adding or changing a colour, picking a Tailwind utility for text/background/border, building a chart or bar, adding dark-mode support, or writing anything in src/index.css or src/lib/format.ts. Triggers on "style", "restyle", "colour/color", "palette", "theme", "dark mode", "token", "spacing", "typography", "chart", "make it look".
---

# Design system

Full rationale: `docs/DESIGN-SYSTEM.md`. This file is the enforceable subset —
what to do, and what never to do.

## Precedence

**This file wins.** Other design skills are installed in `.claude/skills/` —
`frontend-design` and `impeccable` are general-purpose and know nothing about
this app. Where they disagree with this file, this file governs, for two
reasons:

- The palette here is **validated**, not chosen by taste. Changing a position
  colour on aesthetic grounds reintroduces a colourblindness failure that was
  measured and fixed. See §4.2 of the brief.
- The register was chosen by the project owner and recorded in
  `docs/DESIGN-SYSTEM.md`. A general skill that urges a distinctive identity is
  right in general and moot here — the identity is settled.

Use the general skills where this file is silent: inventing a layout for a new
surface, copywriting, motion, critique. Do not use them to relitigate tokens,
the position palette, density, or the accessibility rules.

## The one-line register

**Loud with type and scale. Disciplined with hue.**

Weight, size and fill are free. Hue is not: every colour in the data layer has a
fixed meaning, listed below. If you are reaching for a colour to make something
look nicer, use weight or size instead.

## Tokens — use these, never raw utilities

Never write `text-gray-500`, `bg-white`, `border-gray-200`, or any raw
`{bg,text,border}-{hue}-{step}` utility in a component. Use the semantic token.

| token | role |
|---|---|
| `--color-ink` / `-muted` / `-subtle` | text, three levels |
| `--color-surface` / `-raised` / `-page` | backgrounds |
| `--color-line` | hairlines and dividers |
| `--color-control` | input/select/checkbox boundary (3:1 — darker than it looks like it should be) |
| `--color-accent` | interactive: links, focus, selected tab |
| `--color-positive` / `-negative` / `-caution` | status only |
| `--color-skeleton` / `-sheen` | loading placeholders; the sheen is the lighter of the two in both themes |

Status colours are **reserved**: never a category, never a series, never
decoration.

## Position colours — fixed, validated, do not improvise

| position | light | dark |
|---|---|---|
| QB | `#0ea5e9` sky-500 | `#0284c7` sky-600 |
| RB | `#10b981` emerald-500 | `#059669` emerald-600 |
| WR | `#f59e0b` amber-500 | `#d97706` amber-600 |
| TE | `#8b5cf6` violet-500 | `#7c3aed` violet-600 |
| K / DEF | `--color-subtle` | `--color-subtle` |

Fixed order QB → RB → WR → TE. Never cycled, never reassigned by rank or by
filter state. K/DEF are grey because they are excluded from the maths (#10) —
they are an absence, not a fifth colour.

**QB is sky, not blue.** Blue-500 and violet-500 are ΔE 1.3 apart under
deuteranopia — indistinguishable for red-green colourblind users. Do not "fix"
QB back to blue.

## Two rules that are not optional

The palette passes validation *conditionally*. These are the conditions.

1. **Every coloured mark carries a text label.** Position chips show `QB`, `RB`,
   `WR`, `TE`. Never drop the letters and rely on colour — in light mode these
   colours sit below 3:1 against the surface and the label is what makes them
   legal.
2. **Stacked segments get a 2px gap in the surface colour.** Amber↔emerald is
   ΔE 7.9 in dark mode, which is legal only with secondary encoding. This
   applies to the roster team-strength bar and every stacked bar after it.

## Layout

- Container `max-w-6xl` (1152px). Not `max-w-4xl` — it truncates player names on
  a 1440px screen.
- Data text 13px, meta 12px.
- **Density is keyed to the pointer, never to the width.** Row padding is
  `py-3` by default and `fine:py-1.5` on a precise pointer. `fine:` is a custom
  variant in `src/index.css`. Do not write `sm:` for this — a landscape tablet
  is 1024px wide and still thumb-operated, so a width rule gives the device that
  most needs 44px targets the compact layout.
- Anything tappable inherits the comfortable size by default. Check a new
  control at 375px before assuming it does.
- **Tabular figures** on every column of numbers: add the `tabular` class,
  defined once in `src/index.css`.

## Light and dark

Every token needs both values. Dark is **selected**, not computed — never an
automatic inversion, never `filter: invert`. Honour `prefers-color-scheme` plus
the manual toggle.

Surfaces: light page `#f9fafb` / surface `#ffffff`; dark page `#0f1115` /
surface `#16181d`.

## Motion

Three animations exist, defined in `src/index.css`. **Do not add a fourth
without deleting one, and do not add a motion library.**

| class | use it for |
|---|---|
| `.skeleton` | content that has not arrived — never a spinner |
| `.rise-in` | a panel appearing because the user did something |
| `.flash-change` | a figure that moved while the user was looking at it |

- Drive `.flash-change` with `useChanged` (`src/hooks/useChanged.ts`). It never
  fires on first render — an arrival is not a change, and a panel that lights up
  end to end on mount teaches people to ignore the highlight.
- Flash the thing that **crosses a boundary**, not everything that recomputes.
  One tick moves every number on the verdict panel; the fairness *rating* moving
  is the event.
- The wash is `accent-soft`. Never a status colour — the figure carries its own
  sign, and status is reserved.
- Add `-mx-1 px-1` to a flashed element so the wash has room and the text does
  not shift.
- Every animation must degrade correctly under `prefers-reduced-motion`, which
  the base layer switches off globally. Never re-enable it locally.

## Charts

Load the built-in **`dataviz`** skill. Do not hand-roll chart colour, and do not
write a bespoke chart skill — `dataviz` is design-system-agnostic and takes this
system's values as parameters:

- categorical order: QB, RB, WR, TE (above)
- sequential: single hue, the sky ramp, light→dark
- diverging: emerald ↔ red, **neutral grey midpoint**, never a hue in the middle
- surfaces: `#ffffff` light, `#16181d` dark

**One axis. Never a dual-axis chart.** Dynasty and win-now are the standing
temptation — they are two bars or two charts, never two y-scales on one plot.

## Accessibility — non-negotiable

- WCAG AA both themes: text ≥ 4.5:1, large text and UI ≥ 3:1.
- **Never colour alone.** Gain/loss carries a sign or arrow. Status carries a
  word. Position carries its letters.
- Visible focus ring on every interactive element, both themes. A scrolling
  strip (`overflow-x-auto`) clips an outset ring — inset it there instead.
- Touch targets ≥ 44px on a coarse pointer; see the density rule above. Chart
  marks are the documented exception at `MARK.HIT` 24px, because a dense scatter
  cannot give every dot 44px without the hit areas overlapping.
- Grid and flex children default to `min-width: auto` and will push the page
  sideways rather than let their contents wrap. `min-w-0` on the column is the
  fix, and the cause of every horizontal-scroll bug found in #18.
- Respect `prefers-reduced-motion`.

The app already has a real tablist with roving `tabIndex` and arrow-key
navigation. Do not regress that when restyling — if you declare a role,
implement its keyboard contract.

## Before changing any colour

Text and UI contrast — run from the repo, reads `src/index.css` directly:

```
npm run check:contrast
```

Position colours — run from the `dataviz` skill directory:

```
node scripts/validate_palette.js "<hex,hex,…>" --mode light --pairs all --surface "#ffffff"
node scripts/validate_palette.js "<hex,hex,…>" --mode dark  --pairs all --surface "#16181d"
```

**Run them. Do not reason about ΔE.** Both are in CI; neither is advisory.

## Do not

- Add a colour utility that is not a token.
- Reuse a status colour as a category.
- Add a second icon library. (Both `@heroicons/react` and `lucide-react` were
  dependencies with zero imports; if you need icons, pick one and use it.)
- Re-add the Google Fonts `@import`. Inter is self-hosted.
- Recreate `.player-card`, or add a second card style.
- Use `shadow-lg` as the default card treatment — borders and a small radius.
