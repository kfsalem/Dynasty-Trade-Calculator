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

/** The action azure, `--color-action` and the favicon's square. */
export const ACTION: RGB = [0x25, 0x63, 0xeb];
export const WHITE: RGB = [0xff, 0xff, 0xff];

/**
 * The favicon glyph, in its own 64-unit space.
 *
 * Kept identical to `public/favicon.svg` on purpose — the tab icon, the link
 * card and the home-screen icon should be the same mark, and hand-copied sets
 * of coordinates would drift the first time any of them is touched.
 */
export const ARROWS: Point[][] = [
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
 * `toShape` maps a sample point in pixel space to the shape's own space.
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
