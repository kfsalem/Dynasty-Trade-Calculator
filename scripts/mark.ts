import { deflateSync } from 'node:zlib';

/**
 * The product mark and a dependency-free PNG encoder, shared by the images
 * generated from it: `og.png` (`scripts/og.ts`) and the home-screen icons
 * (`scripts/icons.ts`, #171).
 *
 * Hand-rolled for the reason `og.ts` gives: rasterising the SVG would need a
 * native image dependency, and the mark is two polygons on a square.
 */

export type RGB = [number, number, number];
export type Point = [number, number];

/** The action azure, `--color-action` and the mark's tile. */
export const ACTION: RGB = [0x25, 0x63, 0xeb];
export const WHITE: RGB = [0xff, 0xff, 0xff];

/**
 * The Equalace mark, in its own 64-unit space: a football whose laces form an
 * equals sign, tilted to the familiar angle.
 *
 * Kept identical to `public/favicon.svg` and the header's `BrandMark` in
 * `src/App.tsx` on purpose. Those draw it from SVG paths; this traces the same
 * paths, so the tab icon, the header, the home-screen icons and the link card
 * are one mark. Change one and change all four.
 *
 *   ball:  M7 32 C7 24 18 17 32 17 C46 17 57 24 57 32
 *          C57 40 46 47 32 47 C18 47 7 40 7 32 Z
 *   laces: M23 29H41 M23 35H41, stroke 3.6, round caps
 *   tilt:  rotate(-35 32 32)
 */
const TILT = (-35 * Math.PI) / 180;
const CENTRE = 32;

type Cubic = [Point, Point, Point, Point];
const BALL_CURVES: Cubic[] = [
  [[7, 32], [7, 24], [18, 17], [32, 17]],
  [[32, 17], [46, 17], [57, 24], [57, 32]],
  [[57, 32], [57, 40], [46, 47], [32, 47]],
  [[32, 47], [18, 47], [7, 40], [7, 32]],
];

/** The ball's outline as a polygon: each curve traced in 48 straight steps. */
export const BALL: Point[] = BALL_CURVES.flatMap(([p0, p1, p2, p3]) =>
  Array.from({ length: 48 }, (_, i): Point => {
    const t = i / 48;
    const u = 1 - t;
    const a = u * u * u;
    const b = 3 * u * u * t;
    const c = 3 * u * t * t;
    const d = t * t * t;
    return [
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ];
  }),
);

/** The two lace bars, as segments with their stroke's half-width. */
const LACES: [Point, Point][] = [
  [[23, 29], [41, 29]],
  [[23, 35], [41, 35]],
];
const LACE_HALF_WIDTH = 1.8;

/** Distance from a point to a segment: inside a round-capped stroke when within the half-width. */
function nearSegment(x: number, y: number, [[ax, ay], [bx, by]]: [Point, Point]): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= LACE_HALF_WIDTH;
}

/**
 * Whether a point in the mark's 64-unit space is white: on the ball and off
 * the laces, which are cut out of it and show the tile behind.
 */
export function onMark(x: number, y: number): boolean {
  // Undo the tilt: rotate the sample point back by the same angle.
  const cos = Math.cos(-TILT);
  const sin = Math.sin(-TILT);
  const px = CENTRE + (x - CENTRE) * cos - (y - CENTRE) * sin;
  const py = CENTRE + (x - CENTRE) * sin + (y - CENTRE) * cos;
  return inside(BALL, px, py) && !LACES.some((lace) => nearSegment(px, py, lace));
}

/** Ray casting. These polygons are simple and closed, which is all it needs. */
export function inside(polygon: Point[], x: number, y: number): boolean {
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
 * Coverage of a shape at one pixel, 0-1, sampled on a 4x4 grid: the arrowheads
 * are diagonal, and a single in/out test leaves them visibly jagged.
 *
 * `hit` is asked in pixel space; the caller maps to the shape's own space.
 */
export function coverage(
  px: number,
  py: number,
  hit: (x: number, y: number) => boolean,
): number {
  const STEPS = 4;
  let hits = 0;
  for (let sy = 0; sy < STEPS; sy++) {
    for (let sx = 0; sx < STEPS; sx++) {
      if (hit(px + (sx + 0.5) / STEPS, py + (sy + 0.5) / STEPS)) hits++;
    }
  }
  return hits / (STEPS * STEPS);
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

/**
 * Encode raw scanlines as a PNG. `raw` is one filter byte (0) per row followed
 * by the row's pixels, three bytes each for RGB or four for RGBA.
 */
export function png(raw: Buffer, width: number, height: number, alpha = false): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = alpha ? 6 : 2; // colour type: truecolour, with or without alpha
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
