import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { BuiltDomain } from '../shared/schema.js';
import { paths } from './lib/config.js';

/**
 * The card a shared link unfolds into — `public/og.png`, 1200×630.
 *
 * Everything else about the site is generated on every build; this is not.
 * It is a picture, it changes when somebody decides it should, and it is
 * committed like any other asset. What the script does is make that decision
 * repeatable: the map it draws is the real one — `public/map.svg` with the
 * territories filled from `domains.json` in the app's own dark palette — so a
 * new continent or a recoloured field of knowledge is one `pnpm og:build` away
 * rather than an afternoon in a graphics editor.
 *
 * Rendered by whatever Chrome is on the machine, because the alternative is a
 * rasteriser in the dependencies for one PNG a year. That makes this a local
 * command, not a build step; CI never runs it and never needs to.
 */

const WIDTH = 1200;
const HEIGHT = 630;
const OUT = path.join(paths.publicDir, 'og.png');

/** The dark map, from `src/index.css` — the same one the site opens on. */
const SEA = '#0c2431';
const LAND = '#17323f';
const COAST = 'rgb(230 243 249 / 0.42)';
const BORDER = 'rgb(230 243 249 / 0.5)';
const WASH = 0.82;
const INK = '#eaf3f8';

const CHROMES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function chrome(): string {
  const found = [process.env.CHROME_PATH, ...CHROMES].find(
    (candidate) => candidate && fs.existsSync(candidate)
  );
  if (!found) {
    console.error(
      '✗ no Chrome found — install it, or point CHROME_PATH at one.\n' +
        '  It is only needed to redraw the card; nothing else uses it.'
    );
    process.exit(1);
  }
  return found;
}

/**
 * The map with its colours put back on.
 *
 * `map.svg` is geometry alone — the app paints it at runtime from the domain
 * list and its own CSS variables, and neither of those exists in a file opened
 * by Chrome. So the same two sources are read here and written into the SVG as
 * a stylesheet: one rule per territory, and the coastlines underneath them.
 */
function paintedMap(): string {
  const svg = fs.readFileSync(paths.mapSvg, 'utf8');
  const domains = JSON.parse(
    fs.readFileSync(path.join(paths.outData, 'domains.json'), 'utf8')
  ) as BuiltDomain[];

  const rules = domains
    .map(
      (domain) =>
        `#${domain.shapeId}{fill:${domain.color};fill-opacity:${WASH};stroke:${BORDER};stroke-width:1.1;stroke-linejoin:round}`
    )
    .join('\n');

  return svg.replace(
    /<svg([^>]*)>/,
    `<svg$1>\n<style>
      .coastline{fill:${LAND};stroke:${COAST};stroke-width:2.5;stroke-linejoin:round}
      ${rules}
    </style>`
  );
}

/**
 * The two faces the site is set in, fetched and written into the page as
 * base64.
 *
 * A `<link>` to Google Fonts is what the site itself uses and what this
 * started with — and headless Chrome quietly ignored it, so the first card
 * came out in whatever the system offers for `sans-serif`. Nothing said so:
 * a wrong font is not an error, it is a picture that looks a little off.
 * Embedding them removes the question, and the words are the whole design
 * here.
 */
function fontCss(): string {
  const api =
    'https://fonts.googleapis.com/css2?family=Unbounded:wght@700&family=Onest:wght@500&display=block';
  const css = download(api).toString('utf8');
  const files = [...new Set([...css.matchAll(/url\((https:[^)]+\.woff2)\)/g)].map((m) => m[1]))];
  const inline = new Map<string, string>();

  for (const file of files) {
    inline.set(file, `data:font/woff2;base64,${download(file).toString('base64')}`);
  }

  return css.replace(/url\((https:[^)]+\.woff2)\)/g, (whole, file: string) =>
    inline.has(file) ? `url(${inline.get(file)})` : whole
  );
}

/**
 * Google's font API answers by user agent: ask as a browser and it hands back
 * woff2, ask as anything else and it hands back ttf — four times the weight for
 * the same glyphs, in a format written into a page for no reason.
 */
function download(url: string): Buffer {
  return execFileSync(
    'curl',
    [
      '-sSL',
      '--max-time',
      '30',
      '-A',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      url,
    ],
    { maxBuffer: 32 * 1024 * 1024 }
  );
}

function html(fonts: string): string {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<style>
${fonts}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: ${SEA}; }
  .frame { position: relative; width: 100%; height: 100%; }
  /* The whole world does not fit next to a wordmark, and shrinking it until it
     does leaves a postage stamp in a sea. So the map is pushed off to the
     right at its own scale and allowed to bleed off that edge — what is left
     on screen is the half a reader recognises, and the other half of the card
     is sea for the words to sit on. */
  .frame svg { position: absolute; top: 0; left: 31%; width: 76%; height: 100%; }
  /* Text over a map is text over noise. The scrim is heaviest where the words
     are and gone by the far corner, so the continents still read as a map. */
  .scrim {
    position: absolute; inset: 0;
    background:
      linear-gradient(96deg, rgba(6,18,25,0.92) 0%, rgba(6,18,25,0.86) 28%, rgba(6,18,25,0.25) 52%, rgba(6,18,25,0) 72%),
      linear-gradient(0deg, rgba(6,18,25,0.6) 0%, rgba(6,18,25,0) 42%);
  }
  .text {
    position: absolute; left: 76px; bottom: 84px; width: 700px;
    font-family: Onest, system-ui, sans-serif; color: ${INK};
  }
  .mark {
    font-family: Unbounded, Onest, system-ui, sans-serif; font-weight: 700;
    font-size: 96px; letter-spacing: -0.02em; line-height: 1;
    margin-bottom: 26px;
  }
  .line { font-size: 34px; font-weight: 500; line-height: 1.32; color: rgb(234 243 248 / 0.88); }
  .host {
    position: absolute; right: 76px; bottom: 92px;
    font-family: Onest, system-ui, sans-serif; font-size: 25px; font-weight: 500;
    color: rgb(234 243 248 / 0.62); letter-spacing: 0.04em;
  }
</style>
</head>
<body>
  <div class="frame">
    ${paintedMap().replace('preserveAspectRatio="xMidYMid meet"', 'preserveAspectRatio="xMidYMid slice"')}
    <div class="scrim"></div>
    <div class="text">
      <div class="mark">Lectorea</div>
      <div class="line">Университетские лекции с YouTube,<br />выстроенные в порядке изучения</div>
    </div>
    <div class="host">lectorea.org</div>
  </div>
</body>
</html>`;
}

function main(): void {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lectorea-og-'));
  const page = path.join(work, 'card.html');
  const shot = path.join(work, 'card.png');
  fs.writeFileSync(page, html(fontCss()), 'utf8');

  try {
    execFileSync(
      chrome(),
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--default-background-color=00000000',
        // Twice the size, then down again: the wordmark is the whole picture,
        // and at 1× Chrome renders its edges soft enough to see.
        '--force-device-scale-factor=2',
        // Long enough for the fonts to arrive and be laid out; the flag runs
        // the page's clock forward rather than actually waiting.
        '--virtual-time-budget=8000',
        `--window-size=${WIDTH},${HEIGHT}`,
        `--screenshot=${shot}`,
        `file://${page}`,
      ],
      { stdio: 'pipe' }
    );

    if (!fs.existsSync(shot)) throw new Error('Chrome produced no screenshot');
    downscale(shot);
    fs.copyFileSync(shot, OUT);
    const kb = Math.round(fs.statSync(OUT).size / 1024);
    console.log(`✓ ${path.relative(paths.root, OUT)} — ${WIDTH}×${HEIGHT}, ${kb} KB`);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Back to 1200×630, with whatever the machine has. Neither tool is required. */
function downscale(file: string): void {
  for (const [command, args] of [
    ['magick', [file, '-resize', `${WIDTH}x${HEIGHT}`, '-strip', file]],
    ['sips', ['-Z', String(WIDTH), file]],
  ] as Array<[string, string[]]>) {
    try {
      execFileSync(command, args, { stdio: 'pipe' });
      return;
    } catch {
      // Try the next one; a 2× card is oversized, not broken.
    }
  }
  console.warn('! neither magick nor sips is here — the card stays at 2×');
}

main();
