import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { paths } from './lib/config.js';
import { downscale, hasMagick, shoot } from './lib/chrome.js';

/**
 * Every icon the site ships, rendered from `public/favicon.svg`.
 *
 * `index.html` has always said that the SVG is the source the rest are cut
 * from. Nothing enforced it: the .ico, the three PWA sizes and the touch icon
 * were made once by hand, and the next person to change the mark would have
 * had to find all five and match them by eye. This is that sentence turned
 * into a command.
 *
 * Two shapes come out of the one file:
 *
 * **The plate** — the rounded tile, corners transparent. That is what a
 * browser tab, a bookmark and the Product Hunt thumbnail want, because they
 * put it on a background of their own.
 *
 * **The bleed** — the same mark with the plate dropped and the ground painted
 * to the edge, the mark shrunk to sit inside the mask its platform will cut.
 * Android clips a maskable icon to a circle of 80% of the width and will crop
 * anything outside it; iOS rounds the corners itself and shows whatever is
 * behind a transparent one. The two want different amounts of room, so they
 * get different scales. The plate rects are found by `data-tile` — the
 * convention is documented in the SVG.
 *
 * ```bash
 * pnpm icons:build
 * ```
 *
 * Rendered by whatever Chrome is on the machine (`lib/chrome.ts`), which makes
 * this a local command; CI never runs it and never needs to, because the
 * results are committed like any other asset.
 */

/** The mark inside the plate, corners transparent. */
const PLATE: Array<[number, string]> = [
  [512, 'pwa-512.png'],
  [192, 'pwa-192.png'],
];

/**
 * Full-bleed, with the share of the tile the mark is allowed to fill.
 *
 * 0.8 is the Android safe zone with room to spare — the mark's furthest corner
 * sits at 27.7 of the 64 grid, so 0.8 puts it at 22.2 against the 25.6 the
 * mask leaves. iOS crops nothing but the corners, so its icon can be fuller.
 */
const BLEED: Array<[number, number, string]> = [
  [512, 0.8, 'pwa-maskable-512.png'],
  [180, 0.9, 'apple-touch-icon.png'],
];

/** What the .ico carries. 16 is the tab, 32 the bookmark bar, 48 the shortcut. */
const ICO = [16, 32, 48];

/** Big enough that every size below is a downscale rather than a re-render. */
const MASTER = 1024;

const SOURCE = path.join(paths.publicDir, 'favicon.svg');

/**
 * The page a master is rendered from: one SVG, blown up to `MASTER`, on
 * nothing. Chrome is told the page has no background, so the plate's rounded
 * corners come out transparent instead of white.
 */
function page(svg: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8" /><style>
  * { margin: 0; padding: 0; }
  html, body { width: ${MASTER}px; height: ${MASTER}px; background: transparent; }
  svg { width: ${MASTER}px; height: ${MASTER}px; display: block; }
</style></head>
<body>${svg}</body></html>`;
}

/**
 * The mark without its plate, on a ground of the plate's own colour, shrunk to
 * `fill` of the tile.
 *
 * The scale is written as three transforms rather than one because the mark is
 * drawn around the centre of a 64 grid and `scale()` is about the origin:
 * carry the centre to 0, scale, carry it back.
 */
function bleed(svg: string, fill: number): string {
  const ground = /<rect[^>]*data-tile="ground"[^>]*fill="([^"]+)"/.exec(svg)?.[1];
  if (!ground) {
    console.error('✗ favicon.svg has no <rect data-tile="ground"> to take the colour from.');
    process.exit(1);
  }
  const body = svg
    .replace(/<rect[^>]*data-tile="[^"]*"[^>]*\/>/g, '')
    .replace(/<svg([^>]*)>/, '<svg$1>');
  const open = /<svg[^>]*>/.exec(body)![0];
  const inner = body.slice(open.length, body.lastIndexOf('</svg>'));
  return `${open}
<rect width="64" height="64" fill="${ground}" />
<g transform="translate(32 32) scale(${fill}) translate(-32 -32)">${inner}</g>
</svg>`;
}

function main(): void {
  if (!fs.existsSync(SOURCE)) {
    console.error(`✗ ${path.relative(paths.root, SOURCE)} is missing — it is the source of all of these.`);
    process.exit(1);
  }
  const svg = fs.readFileSync(SOURCE, 'utf8');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lectorea-icons-'));
  const written: string[] = [];

  try {
    const plate = path.join(work, 'plate.png');
    shoot(page(svg), plate, { width: MASTER, height: MASTER, scale: 1 });

    for (const [size, name] of PLATE) {
      const out = path.join(paths.publicDir, name);
      downscale(plate, size, size, out);
      written.push(name);
    }

    for (const [size, fill, name] of BLEED) {
      const master = path.join(work, `bleed-${fill}.png`);
      if (!fs.existsSync(master)) {
        shoot(page(bleed(svg, fill)), master, { width: MASTER, height: MASTER, scale: 1 });
      }
      const out = path.join(paths.publicDir, name);
      downscale(master, size, size, out);
      written.push(name);
    }

    // The .ico is the one output magick alone can write. Without it the tab
    // keeps the icon it had, which is wrong but not broken — say so and go on.
    if (hasMagick()) {
      const layers = ICO.map((size) => {
        const file = path.join(work, `ico-${size}.png`);
        downscale(plate, size, size, file);
        return file;
      });
      const ico = path.join(paths.publicDir, 'favicon.ico');
      execFileSync('magick', [...layers, ico], { stdio: 'pipe' });
      written.push('favicon.ico');
    } else {
      console.warn('! no magick — favicon.ico is unchanged and no longer matches the SVG');
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  for (const name of written) {
    const kb = Math.round(fs.statSync(path.join(paths.publicDir, name)).size / 1024);
    console.log(`✓ public/${name} — ${kb} KB`);
  }
  console.log('\n  The Product Hunt thumbnail is cut from pwa-512.png — `pnpm ph:assets`.');
}

main();
