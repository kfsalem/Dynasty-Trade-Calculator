import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WHITE, coverage, onMark as onMarkSpace, png, type RGB } from './mark';

/**
 * Generate `public/og.png`, the card image for a shared trade link.
 *
 * Why this exists at all: a trade gets pasted into a league group chat, and the
 * unfurled card is the first thing anyone sees. `index.html` has carried the
 * text half of that since permalinks shipped, but never an image — and a
 * `summary` card with no image is just the text again, in a box.
 *
 * Why a PNG rather than the SVG that already exists: no major scraper renders
 * SVG. Facebook, Slack, iMessage, Discord and X all skip it, so an SVG
 * `og:image` is indistinguishable from having none.
 *
 * Why hand-rolled: rasterising the SVG would mean a native image dependency
 * (sharp, resvg) and, if any text were involved, a font installed on the CI
 * runner. This composition is two polygons on a gradient, which is a page of
 * arithmetic and no dependencies at all — and it cannot break on a runner that
 * happens to lack a font. There is no text in the image for exactly that
 * reason: `og:title` and `og:description` carry the words, and they are already
 * right.
 */

const WIDTH = 1200;
const HEIGHT = 630;

/** primary-600 → primary-800, the same blues as `index.css`. */
const TOP: RGB = [0x25, 0x63, 0xeb];
const BOTTOM: RGB = [0x1e, 0x40, 0xaf];
const MARK = WHITE;

// The glyph's drawn content is centred on (32, 32) in glyph space, so placing
// it is one scale and one offset. The glyph itself lives in `scripts/mark.ts`,
// shared with the home-screen icons.
const SCALE = 8.4;
const OFFSET_X = WIDTH / 2 - 32 * SCALE;
const OFFSET_Y = HEIGHT / 2 - 32 * SCALE;

const onMark = (x: number, y: number) =>
  onMarkSpace((x - OFFSET_X) / SCALE, (y - OFFSET_Y) / SCALE);

function render(): Buffer {
  // One filter byte per row, then RGB triples.
  const stride = WIDTH * 3 + 1;
  const raw = Buffer.alloc(stride * HEIGHT);

  for (let y = 0; y < HEIGHT; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: none
    const t = y / (HEIGHT - 1);

    for (let x = 0; x < WIDTH; x++) {
      const alpha = coverage(x, y, onMark);
      const i = rowStart + 1 + x * 3;
      for (let c = 0; c < 3; c++) {
        const background = TOP[c] + (BOTTOM[c] - TOP[c]) * t;
        raw[i + c] = Math.round(background + (MARK[c] - background) * alpha);
      }
    }
  }

  return raw;
}

const out = fileURLToPath(new URL('../public/og.png', import.meta.url));
const file = png(render(), WIDTH, HEIGHT);
writeFileSync(out, file);
console.log(`og.png  ${WIDTH}x${HEIGHT}  ${(file.length / 1024).toFixed(1)} KB`);
