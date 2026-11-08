import type { PostLines } from './postText';

/**
 * The weekly post (#169) as a PNG, drawn on a canvas in the browser.
 *
 * #169 asked first whether this could be done at acceptable quality without
 * a new dependency, and it can. `scripts/og.ts` rasterises by hand because it
 * runs on a CI runner with no fonts. A browser has the app's own fonts and a
 * text renderer, so this is the platform's canvas with no library.
 *
 * - **Colours are the app's tokens**, read from the page at the moment of
 *   drawing, so the image comes out in whichever theme the reader is using.
 *   No colour is written here.
 * - **Fonts are awaited.** A canvas draws with whatever is loaded at that
 *   instant and silently falls back otherwise, so the display face and Inter
 *   are loaded explicitly first.
 * - **1080 wide**, the size every chat app shows without upscaling. The height
 *   follows the league: one row per team.
 */

const WIDTH = 1080;
const PAD = 72;

interface Palette {
  surface: string;
  ink: string;
  muted: string;
  subtle: string;
  line: string;
  display: string;
  sans: string;
}

function palette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    // System colours as the fallback: the page's own background and text,
    // should the stylesheet somehow not be there.
    surface: token('--color-surface', 'Canvas'),
    ink: token('--color-ink', 'CanvasText'),
    muted: token('--color-muted', 'CanvasText'),
    subtle: token('--color-subtle', 'GrayText'),
    line: token('--color-line', 'GrayText'),
    display: token('--font-display', 'system-ui, sans-serif'),
    sans: token('--font-sans', 'system-ui, sans-serif'),
  };
}

async function loadFonts(p: Palette): Promise<void> {
  if (!document.fonts?.load) return;
  try {
    await Promise.all([
      document.fonts.load(`800 56px ${p.display}`),
      document.fonts.load(`700 28px ${p.display}`),
      document.fonts.load(`500 28px ${p.sans}`),
      document.fonts.load(`700 20px ${p.sans}`),
    ]);
  } catch {
    // A font that will not load is drawn in the fallback, which still reads.
  }
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > max) {
      out.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) out.push(line);
  return out;
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, h / 2);
  else ctx.rect(x, y, w, h);
  ctx.fill();
}

/** Lays the post out from the top; draws only when `draw` is set. Returns the height. */
function layout(ctx: CanvasRenderingContext2D, lines: PostLines, url: string, p: Palette, draw: boolean) {
  const text = (s: string, x: number, y: number, font: string, colour: string, align: CanvasTextAlign = 'left') => {
    ctx.font = font;
    if (!draw) return;
    ctx.fillStyle = colour;
    ctx.textAlign = align;
    ctx.fillText(s, x, y);
  };
  const right = WIDTH - PAD;
  let y = PAD;

  ctx.textBaseline = 'alphabetic';
  ctx.font = `800 56px ${p.display}`;
  y += 56;
  text(fit(ctx, lines.title, right - PAD), PAD, y, ctx.font, p.ink);
  y += 44;
  text(lines.subtitle, PAD, y, `600 28px ${p.sans}`, p.muted);

  y += 64;
  ctx.font = `600 22px ${p.sans}`;
  for (const l of wrap(ctx, lines.rankingsNote, right - PAD)) {
    text(l, PAD, y, ctx.font, p.subtle);
    y += 32;
  }
  y += 8;

  const rankX = PAD + 36;
  const nameX = PAD + 60;
  const recordX = PAD + 520;
  const barX = PAD + 640;
  const barW = right - 84 - barX;
  for (const row of lines.rankings) {
    y += 52;
    text(String(row.rank), rankX, y, `700 26px ${p.sans}`, p.subtle, 'right');
    ctx.font = `600 30px ${p.sans}`;
    text(fit(ctx, row.name, recordX - nameX - 24), nameX, y, ctx.font, p.ink);
    text(row.record, recordX, y, `500 26px ${p.sans}`, p.muted);
    if (draw) {
      ctx.fillStyle = p.line;
      bar(ctx, barX, y - 16, barW, 12);
      ctx.fillStyle = p.muted;
      bar(ctx, barX, y - 16, Math.max(12, (barW * Math.max(0, Math.min(100, row.index))) / 100), 12);
    }
    text(String(row.index), right, y, `700 28px ${p.display}`, p.ink, 'right');
  }

  y += 48;
  if (draw) {
    ctx.fillStyle = p.line;
    ctx.fillRect(PAD, y, right - PAD, 2);
  }
  y += 20;

  for (const item of lines.items) {
    y += 40;
    text(item.label.toUpperCase(), PAD, y, `700 20px ${p.sans}`, p.subtle);
    ctx.font = `500 28px ${p.sans}`;
    for (const l of wrap(ctx, item.text, right - PAD)) {
      y += 40;
      text(l, PAD, y, ctx.font, p.ink);
    }
    y += 8;
  }

  y += 40;
  if (draw) {
    ctx.fillStyle = p.line;
    ctx.fillRect(PAD, y, right - PAD, 2);
  }
  y += 52;
  text('Equalace', PAD, y, `800 28px ${p.display}`, p.ink);
  ctx.font = `500 22px ${p.sans}`;
  text(fit(ctx, url.replace(/^https?:\/\//, ''), right - PAD - 200), right, y, ctx.font, p.subtle, 'right');

  return y + PAD;
}

export async function postImage(lines: PostLines, url: string): Promise<Blob> {
  const p = palette();
  await loadFonts(p);
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = 10;
  const measure = canvas.getContext('2d');
  if (!measure) throw new Error('This browser cannot draw images.');
  const height = Math.ceil(layout(measure, lines, url, p, false));

  // Resizing a canvas resets its context, so the drawing pass starts clean.
  canvas.height = height;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.fillStyle = p.surface;
  ctx.fillRect(0, 0, WIDTH, height);
  layout(ctx, lines, url, p, true);

  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('The image could not be made.'))), 'image/png'),
  );
}
