import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
const MARK: RGB = [0xff, 0xff, 0xff];

type RGB = [number, number, number];
type Point = [number, number];

/**
 * The favicon glyph, in its own 64-unit space.
 *
 * Kept identical to `public/favicon.svg` on purpose — the tab icon and the
 * link card should be the same mark, and two hand-copied sets of coordinates
 * would drift the first time either is touched.
 */
const ARROWS: Point[][] = [
  // Pointing right.
  [
    [12, 20],
    [38, 20],
    [38, 14],
    [52, 24],
    [38, 34],
    [38, 28],
    [12, 28],
  ],
  // Pointing left, below it.
  [
    [52, 36],
    [26, 36],
    [26, 30],
    [12, 40],
    [26, 50],
    [26, 44],
    [52, 44],
  ],
];

// The glyph's drawn content is centred on (32, 32) in glyph space, so placing
// it is one scale and one offset.
const SCALE = 8.4;
const OFFSET_X = WIDTH / 2 - 32 * SCALE;
const OFFSET_Y = HEIGHT / 2 - 32 * SCALE;

/** Ray casting. These polygons are simple and closed, which is all it needs. */
function inside(polygon: Point[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      hit = !hit;
    }
  }
  return hit;
}

/**
 * Coverage of the mark at one pixel, 0-1.
 *
 * Sampled on a 4x4 grid rather than tested once at the centre: the arrowheads
 * are diagonal, and a hard in/out test leaves them visibly jagged at the size
 * a card is actually displayed.
 */
function coverage(px: number, py: number): number {
  const STEPS = 4;
  let hits = 0;
  for (let sy = 0; sy < STEPS; sy++) {
    for (let sx = 0; sx < STEPS; sx++) {
      const x = (px + (sx + 0.5) / STEPS - OFFSET_X) / SCALE;
      const y = (py + (sy + 0.5) / STEPS - OFFSET_Y) / SCALE;
      if (ARROWS.some((arrow) => inside(arrow, x, y))) hits++;
    }
  }
  return hits / (STEPS * STEPS);
}

function render(): Buffer {
  // One filter byte per row, then RGB triples.
  const stride = WIDTH * 3 + 1;
  const raw = Buffer.alloc(stride * HEIGHT);

  for (let y = 0; y < HEIGHT; y++) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // filter: none
    const t = y / (HEIGHT - 1);

    for (let x = 0; x < WIDTH; x++) {
      const alpha = coverage(x, y);
      const i = rowStart + 1 + x * 3;
      for (let c = 0; c < 3; c++) {
        const background = TOP[c] + (BOTTOM[c] - TOP[c]) * t;
        raw[i + c] = Math.round(background + (MARK[c] - background) * alpha);
      }
    }
  }

  return raw;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(raw: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(WIDTH, 0);
  ihdr.writeUInt32BE(HEIGHT, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = fileURLToPath(new URL('../public/og.png', import.meta.url));
const file = png(render());
writeFileSync(out, file);
console.log(`og.png  ${WIDTH}x${HEIGHT}  ${(file.length / 1024).toFixed(1)} KB`);
