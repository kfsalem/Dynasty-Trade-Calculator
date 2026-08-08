/**
 * Contrast gate for the design tokens.
 *
 * Reads the tokens out of `src/index.css` rather than taking a copy, so this
 * cannot quietly drift from what actually ships — the failure mode a
 * hand-maintained duplicate always eventually reaches.
 *
 * Checks, per theme:
 *   - text tokens clear WCAG AA (4.5:1) against both `surface` and `page`
 *   - the control border and focus ring clear WCAG 1.4.11 (3:1)
 *
 * Position colours are NOT checked here. They are a categorical scale, and the
 * thing that matters for them is colour-vision-deficiency separation rather
 * than contrast — that is the dataviz skill's `validate_palette.js`, and the
 * two warnings it returns are discharged by rules in the design system, not by
 * changing the colours. See docs/DESIGN-SYSTEM.md §4.3.
 *
 * Exits non-zero on any failure, so CI catches a bad colour.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '..', 'src', 'index.css');

/** Text tokens, and the AA threshold each must clear against a background. */
const TEXT_TOKENS = [
  'ink',
  'muted',
  'subtle',
  'accent',
  'positive',
  'negative',
  'caution',
] as const;

/** Non-text tokens: UI boundaries under WCAG 1.4.11. */
const UI_TOKENS = ['control', 'accent'] as const;

/**
 * Text drawn on a filled background rather than on the page.
 *
 * Worth its own check because the obvious value is wrong in one theme: the
 * dark-mode accent is a light blue, and white on it is 2.17:1.
 */
const ON_FILL: Array<[fg: string, bg: string]> = [['on-accent', 'accent']];

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

type Tokens = Record<string, string>;

function parseTokens(css: string): { light: Tokens; dark: Tokens } {
  const light: Tokens = {};
  const dark: Tokens = {};

  // `@theme { ... }` carries light; `.dark { ... }` overrides for dark. Both
  // are flat lists of `--color-<name>: <hex>;`.
  const themeBlock = css.match(/@theme\s*\{([\s\S]*?)\n\}/);
  const darkBlock = css.match(/\.dark\s*\{([\s\S]*?)\n {2}\}/);
  if (!themeBlock) throw new Error('no @theme block found in src/index.css');
  if (!darkBlock) throw new Error('no .dark block found in src/index.css');

  const read = (body: string, into: Tokens) => {
    for (const [, name, value] of body.matchAll(
      /--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g,
    )) {
      into[name] = value.toLowerCase();
    }
  };

  read(themeBlock[1], light);
  read(darkBlock[1], dark);

  // Dark inherits anything it does not override.
  return { light, dark: { ...light, ...dark } };
}

const channel = (hex: string, i: number) =>
  parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;

const linearize = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function luminance(hex: string): number {
  const [r, g, b] = [0, 1, 2].map((i) => linearize(channel(hex, i)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

interface Failure {
  theme: string;
  token: string;
  against: string;
  ratio: number;
  need: number;
}

function checkTheme(theme: string, tokens: Tokens, failures: Failure[]): void {
  const backgrounds = ['surface', 'page'] as const;
  console.log(`\n${theme}`);

  for (const token of TEXT_TOKENS) {
    for (const bg of backgrounds) {
      const fg = tokens[token];
      const back = tokens[bg];
      if (!fg || !back) throw new Error(`missing token: ${token} or ${bg} in ${theme}`);
      const ratio = contrast(fg, back);
      const ok = ratio >= AA_TEXT;
      if (!ok) failures.push({ theme, token, against: bg, ratio, need: AA_TEXT });
      console.log(
        `  ${ok ? 'pass' : 'FAIL'}  ${token.padEnd(9)} on ${bg.padEnd(8)} ${ratio
          .toFixed(2)
          .padStart(6)}:1  (AA text ${AA_TEXT})`,
      );
    }
  }

  for (const [fg, bg] of ON_FILL) {
    const ratio = contrast(tokens[fg], tokens[bg]);
    const ok = ratio >= AA_TEXT;
    if (!ok) failures.push({ theme, token: fg, against: bg, ratio, need: AA_TEXT });
    console.log(
      `  ${ok ? 'pass' : 'FAIL'}  ${fg.padEnd(9)} on ${bg.padEnd(8)} ${ratio
        .toFixed(2)
        .padStart(6)}:1  (AA text ${AA_TEXT})`,
    );
  }

  for (const token of UI_TOKENS) {
    const fg = tokens[token];
    const back = tokens.surface;
    const ratio = contrast(fg, back);
    const ok = ratio >= AA_NON_TEXT;
    if (!ok) failures.push({ theme, token, against: 'surface', ratio, need: AA_NON_TEXT });
    console.log(
      `  ${ok ? 'pass' : 'FAIL'}  ${token.padEnd(9)} on surface  ${ratio
        .toFixed(2)
        .padStart(6)}:1  (UI ${AA_NON_TEXT})`,
    );
  }
}

const css = readFileSync(cssPath, 'utf8');
const { light, dark } = parseTokens(css);

if (Object.keys(light).length === 0) {
  console.error('parsed zero tokens — the CSS shape changed, fix this script');
  process.exit(2);
}

const failures: Failure[] = [];
checkTheme('light', light, failures);
checkTheme('dark', dark, failures);

if (failures.length > 0) {
  console.error(`\n${failures.length} contrast failure(s):`);
  for (const f of failures) {
    console.error(
      `  ${f.theme} ${f.token} on ${f.against}: ${f.ratio.toFixed(2)}:1, need ${f.need}`,
    );
  }
  console.error('\nPick a different value; do not lower the threshold.');
  process.exit(1);
}

console.log(
  `\nAll contrast checks pass (${
    TEXT_TOKENS.length * 2 + ON_FILL.length + UI_TOKENS.length
  } per theme).`,
);
