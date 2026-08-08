# Design System

The direction Milestone 5 executes against. Written for #53, before #15–#18, so
that four issues encode one set of decisions rather than four guesses.

Audited against the live app on 2026-08-08. Every colour claim here was produced
by running the validator, not by looking at swatches — see
[Validation](#validation) for the commands and their output.

---

## 1. Register

**Broadcast.** Saturated position colour, oversized numerals, filled bars. This
should read as a fantasy football product, not a spreadsheet.

The discipline that keeps it from becoming noise:

> **Loud with type and scale. Disciplined with hue.**

Weight, size and fill are free — a value can be 32px and bold, a bar can be
solid, a header can be a filled block. Hue is not free: every colour in the data
layer means something specific, and the meanings are fixed below. A broadcast
that colours everything has no way left to say *this one matters*.

The app's job is to explain a number the user did not expect. Energy is welcome;
ambiguity is not.

## 2. Layout and density

**Compact type, wide container.**

| | value | note |
|---|---|---|
| Container | `max-w-6xl` (1152px) | up from `max-w-4xl` (896px) |
| Body/data text | 13px (`text-sm`) | already the dominant scale — 56 uses |
| Meta/secondary | 12px (`text-xs`) | 27 uses |
| Row padding | 8px vertical | tight; a 17-row roster should fit |

**Why the container changes.** At a 1440px viewport the app renders 896px of
content and leaves 544px empty — and inside that 896px the trade calculator
truncates player names to `Ja'Marr …` and `Amon-R…`. The name is the single most
important thing in the row. Worse, the 390px mobile layout shows those same
labels *in full*, because it drops the SNAPS/USAGE columns and stacks to one
column. The desktop view is currently the degraded one.

The density is right. The width is the defect.

## 3. Type

**Inter, self-hosted.** It is loaded today via `@import url(fonts.googleapis.com)`
at the top of `src/index.css`, which is a render-blocking request to a third
party on a site that is otherwise entirely static and self-hosted. Self-host the
weights actually used (400/500/600/700) and drop the `@import`.

Tabular figures are mandatory anywhere numbers stack in a column — every value
column, every table. `font-variant-numeric: tabular-nums`. Digits that shift
width between rows make a column of numbers unreadable, and this app is mostly
columns of numbers.

Scale:

| role | size | weight |
|---|---|---|
| `display` — hero numerals, the broadcast moment | 30–36px | 700 |
| `title` | 20px | 700 |
| `heading` | 16px | 600 |
| `body` / data | 13px | 400/500 |
| `meta` | 12px | 400 |
| `label` — chips, column heads | 11px | 600, uppercase, tracked |

## 4. Colour

### 4.1 Semantic layer

Today's tokens name colours, not roles: `--color-fantasy-green`,
`--color-fantasy-red`. A role survives a palette change; a colour name does not.
Rename to what they mean:

| token | role |
|---|---|
| `--color-positive` | a gain — value up, trade in your favour |
| `--color-negative` | a loss |
| `--color-caution` | a warning, an injury designation |
| `--color-accent` | interactive: links, focus, selected tab |
| `--color-ink` / `-muted` / `-subtle` | text, three levels |
| `--color-surface` / `-raised` / `-page` | backgrounds |
| `--color-line` | decorative hairlines and dividers (no contrast floor) |
| `--color-control` | the visible boundary of an input/select/checkbox — must clear 3:1 |

**Status colours are reserved.** `positive` / `negative` / `caution` never
double as a category or a series colour, and they never appear alone — a status
always carries a label or an icon beside it.

### 4.2 Position palette — validated

Positions are a categorical scale: identity, not magnitude. Fixed order, never
cycled.

| position | light | dark |
|---|---|---|
| QB | `#0ea5e9` sky-500 | `#0284c7` sky-600 |
| RB | `#10b981` emerald-500 | `#059669` emerald-600 |
| WR | `#f59e0b` amber-500 | `#d97706` amber-600 |
| TE | `#8b5cf6` violet-500 | `#7c3aed` violet-600 |
| K / DEF | `--color-subtle` (grey) | `--color-subtle` |

**Only QB changes.** RB, WR and TE keep the exact values they have today.

**Why QB had to move.** The current QB blue (`#3b82f6`) and TE violet
(`#8b5cf6`) are **ΔE 1.3 apart under deuteranopia** — indistinguishable for
red-green colourblind users, who are roughly 1 in 12 men. They are ΔE 12.0 apart
for *normal* vision, which is below the validator's hard floor of 15: full-colour
readers struggle with the pair too. This is a live accessibility defect in the
shipped app, and it is visible wherever QB and TE chips sit near each other.

Moving QB to sky has a second benefit: QB no longer shares a hue family with
`--color-accent`, so a position chip stops looking like something you can click.

**K and DEF are not a category.** They are grey because they are excluded from
the maths (#10) — an absence, not a fifth series. Grey fails the categorical
chroma floor by design, and belongs outside the categorical palette rather than
inside it as a failing member.

### 4.3 Two rules the validation obliges

The palette passes, with two warnings. Each converts into a rule that is not
optional:

1. **Every coloured mark carries a text label.** In light mode sky, emerald and
   amber all fall below 3:1 against the surface, which the validator permits
   only with "visible labels or a table view." The position chips (`QB`, `RB`,
   `WR`, `TE`) already do this — the rule is that they may never be dropped in
   favour of colour alone.
2. **Stacked segments are separated by a 2px surface gap.** In dark mode
   amber↔emerald is ΔE 7.9, inside the 6–8 band that is legal *only* with
   secondary encoding. The roster team-strength bar currently butts its four
   segments directly against each other; a 2px gap in the surface colour is what
   makes that legal, and it looks better besides.

### 4.4 Charts

For #16, use the **`dataviz` skill's method** — see [§7](#7-claude-skills).
Parameters it needs from this system:

- **Categorical order:** QB, RB, WR, TE as above.
- **Sequential:** one hue, light→dark. Use the sky ramp.
- **Diverging:** emerald ↔ red with a *neutral grey* midpoint, never a hue at the
  middle. This is the "strengths and weaknesses" bar, which is diverging around
  the league median and currently reads green/grey/red — the shape is right.
- **Surfaces for validation:** `#ffffff` light, `#16181d` dark.

**One axis, always.** Never a dual-axis chart. The dynasty and win-now scales are
the standing temptation here and they are two charts or two bars, never two
y-axes on one plot.

## 5. Light and dark

**Co-equal.** Every token carries both values from the start, and dark is
**selected**, not computed — its own steps from the same ramps, validated against
the dark surface. An automatic inversion produces washed-out charts and illegible
status colours.

| | light | dark |
|---|---|---|
| page | `#f9fafb` | `#0f1115` |
| surface | `#ffffff` | `#16181d` |
| raised | `#ffffff` + border | `#1f242b` |

Honour `prefers-color-scheme`, plus a manual toggle that persists to
localStorage — the same place the league id and claimed team already live, per
`DESIGN.md` §7 decision 2.

The app currently contains **zero** `dark:` variants, and `.card` hardcodes
`bg-white`. There is nothing to retrofit; there is everything to add.

## 6. Accessibility

WCAG AA in both themes, and this is a realistic bar rather than an aspiration —
the app already implements a real tablist with roving `tabIndex`, arrow/Home/End
keys, `role="alert"` on errors and `aria-label` on the loading state. The
behaviour is ahead of the colour.

- Text contrast ≥ 4.5:1; large text and UI ≥ 3:1.
- **Never colour alone.** Position is a chip with letters. Gain/loss carries a
  sign or an arrow, not just green/red. Status carries a word.
- Visible focus ring on every interactive element, in both themes.
- Touch targets ≥ 44px (#18).
- Respect `prefers-reduced-motion` — the transitions #17 adds must be opt-out.

## 7. Claude skills

`.claude/skills/design-system/SKILL.md` carries the enforceable subset of this
document: the tokens, the two obliged rules, and the do-not list. It is checked
in, so it applies to anyone working in the repo rather than living in one
person's memory. **It is authoritative** — see `.claude/skills/README.md` for
the full roster and precedence order.

Three general design skills are vendored alongside it from
[anthropics/skills](https://github.com/anthropics/skills) (Apache-2.0):
`frontend-design` for aesthetic direction on new surfaces, `webapp-testing` for
Playwright viewport and interaction checks, and `web-artifacts-builder` for
standalone artifacts built *beside* the project rather than inside it.
[Impeccable](https://github.com/pbakaus/impeccable) is installed as a plugin.

**Where the general skills stop.** They know nothing about this app. The
position palette here is validated, not chosen — restyling QB back to blue on
aesthetic grounds reintroduces a measured colourblindness failure. The register
is settled. Use the general skills for layout ideation, copy, motion and
critique; not to relitigate §4.

**Charts do not get a bespoke skill.** Claude Code ships a `dataviz` skill whose
method is design-system-agnostic and whose non-negotiables already match what
#16 asks for — one axis, categorical hues in fixed order, legend plus selective
direct labels, sequential single-hue, diverging with a neutral midpoint, dark
mode selected rather than flipped. It also ships
`scripts/validate_palette.js`, which is what produced every colour decision
above. Feed it this system's parameters (§4.4); do not reimplement it.

## 8. Decisions on the audit

Findings from the 2026-08-08 audit, and what happens to each.

| finding | decision |
|---|---|
| `--color-fantasy-orange`, `--color-fantasy-blue` declared, **0 uses** — Tailwind 4 tree-shakes them, so they resolve to empty string at runtime | delete |
| `--color-fantasy-blue` is byte-identical to `--color-primary-500` (`#3b82f6`) | moot once deleted |
| `.player-card` declared, **0 uses**; near-duplicate of `.card` | delete |
| `.card` uses `shadow-lg` + `rounded-xl` + `p-6`; components use `rounded-lg` + `p-4` | one card. Borders and a small radius over heavy shadow |
| `@heroicons/react` **and** `lucide-react` both in `package.json`, **neither imported anywhere in `src/`** | remove both from dependencies; add one back when something needs an icon |
| Inter via Google Fonts `@import` | self-host, drop the `@import` |
| 51 distinct raw colour utilities, dominated by `text-gray-500` (45) and `text-gray-400` (37) | replace with `--color-muted` / `--color-subtle` |
| `--color-primary-*` is Tailwind blue verbatim | keep the scale, rename to `accent` |
| zero `dark:` variants | §5 |

**A note on #15's premise.** #15 says `POSITION_STYLES` is "the only shared token
set." That has not been true for some time: `src/index.css` has an `@theme` block
and four component classes. The real situation is worse than none — a vocabulary
that is *half* adopted, with three dead entries and 51 raw utilities alongside
it. Starting from "there are no tokens" would produce the wrong plan.

## Validation

Run from the `dataviz` skill directory. Node 20.12+ required.

```
node scripts/validate_palette.js "#0ea5e9,#10b981,#f59e0b,#8b5cf6" \
  --mode light --pairs all --surface "#ffffff"
node scripts/validate_palette.js "#0284c7,#059669,#d97706,#7c3aed" \
  --mode dark  --pairs all --surface "#16181d"
```

Both report ALL CHECKS PASS, with the two warnings §4.3 turns into rules.
`--pairs all` rather than the default `adjacent`, because the roster
team-strength bar puts all four positions in one bar and the chips appear
together in lists — every pair is adjacent somewhere.

For the record, the palette this replaces:

```
node scripts/validate_palette.js "#3b82f6,#10b981,#f59e0b,#8b5cf6" \
  --mode light --pairs all
  [FAIL] CVD separation      #8b5cf6↔#3b82f6 ΔE 1.3 (deutan)
  [FAIL] Normal-vision floor #8b5cf6↔#3b82f6 ΔE 12.0 — below 15
```

**Re-run the validator before changing any colour.** Do not reason about ΔE.

Text and UI contrast has its own gate, which reads the tokens straight out of
`src/index.css` so it cannot drift from what ships:

```
npm run check:contrast
```

It fails the build on any text token below 4.5:1 against either surface, or any
control border or focus ring below 3:1. Both run in CI.
