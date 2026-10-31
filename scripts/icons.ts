import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ACTION, WHITE, coverage, onMark as onMarkSpace, png } from './mark';

/**
 * Generate the home-screen icons (#171), from the same mark as the favicon:
 * the Equalace football, whose laces form an equals sign.
 *
 * Run with `npm run icons` and commit the output, as `og.png` is.
 *
 * Three shapes, because three platforms crop differently:
 *
 * - **`icon-192.png`, `icon-512.png`**: the favicon itself, a rounded square
 *   on transparency. Shown as-is where a browser does not crop.
 * - **`icon-maskable-512.png`**: full-bleed azure with the mark inside the
 *   central 80% safe zone, for Android, which cuts its own shape (circle,
 *   squircle) out of the square and would otherwise clip the arrows.
 * - **`apple-touch-icon.png`** (180): full-bleed and square. iOS rounds the
 *   corners itself, and draws a transparent corner as black.
 */

/** The favicon's corner radius, as a share of its side: `rx="14"` of 64. */
const CORNER = 14 / 64;

/** Inside a rounded square of side `size` with corner radius `r`. */
function inRoundedSquare(x: number, y: number, size: number, r: number): boolean {
  if (x < 0 || y < 0 || x > size || y > size) return false;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/**
 * One icon. `glyph` is the side, in pixels, the mark's 64-unit space is drawn
 * at, centred; `rounded` cuts the favicon's corners to transparency.
 */
function icon(size: number, glyph: number, rounded: boolean): Buffer {
  const scale = glyph / 64;
  const offset = (size - glyph) / 2;
  const onMark = (x: number, y: number) => onMarkSpace((x - offset) / scale, (y - offset) / scale);
  const onSquare = (x: number, y: number) => inRoundedSquare(x, y, size, size * CORNER);

  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const mark = coverage(x, y, onMark);
      const i = y * stride + 1 + x * 4;
      for (let c = 0; c < 3; c++) {
        raw[i + c] = Math.round(ACTION[c] + (WHITE[c] - ACTION[c]) * mark);
      }
      raw[i + 3] = rounded ? Math.round(255 * coverage(x, y, onSquare)) : 255;
    }
  }
  return png(raw, size, size, true);
}

const ICONS: [file: string, size: number, glyph: number, rounded: boolean][] = [
  // The favicon at full size: the ball spans 7-57 of 64, as it does there.
  ['icon-192.png', 192, 192, true],
  ['icon-512.png', 512, 512, true],
  // Drawn at 80%, so the tilted ball stays inside the circle Android may crop
  // the tile to.
  ['icon-maskable-512.png', 512, 512 * 0.8, false],
  ['apple-touch-icon.png', 180, 180, false],
];

for (const [file, size, glyph, rounded] of ICONS) {
  const out = fileURLToPath(new URL(`../public/${file}`, import.meta.url));
  const data = icon(size, glyph, rounded);
  writeFileSync(out, data);
  console.log(`${file}  ${size}x${size}  ${(data.length / 1024).toFixed(1)} KB`);
}
