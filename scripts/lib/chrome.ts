import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Whatever Chrome is on this machine, used as a renderer.
 *
 * Three scripts draw pictures — the link card, the launch gallery, the icon
 * set — and none of them is worth a rasteriser in the dependencies. Chrome is
 * already installed on the machine of anybody who can look at the result, so
 * it does the drawing and CI never runs any of them.
 *
 * This module is the part they share. `og-image.ts` and `icons.ts` use it;
 * `ph-assets.ts` drives the same browser over its debugging protocol instead,
 * because it has to click things, and keeps its own copy of the search.
 */

const CHROMES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

/** The browser, or a message saying what to install and why it is wanted. */
export function findChrome(why = 'draw this picture'): string {
  const found = [process.env.CHROME_PATH, ...CHROMES].find(
    (candidate) => candidate && fs.existsSync(candidate)
  );
  if (!found) {
    console.error(
      `✗ no Chrome found — install it, or point CHROME_PATH at one.\n` +
        `  It is only needed to ${why}; nothing else uses it.`
    );
    process.exit(1);
  }
  return found;
}

/**
 * One page of HTML, rendered to a PNG of exactly `width`×`height` device
 * pixels — `scale` times that many real ones, so edges and type come out
 * sharp and `downscale` puts them back.
 *
 * `--virtual-time-budget` runs the page's clock forward rather than actually
 * waiting: fonts arrive, layout settles, and the shot is taken at what the
 * page would look like eight seconds in, in about a second of real time.
 */
export function shoot(
  html: string,
  out: string,
  { width, height, scale = 2 }: { width: number; height: number; scale?: number }
): void {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lectorea-shot-'));
  const page = path.join(work, 'page.html');
  fs.writeFileSync(page, html, 'utf8');
  try {
    execFileSync(
      findChrome(),
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--default-background-color=00000000',
        `--force-device-scale-factor=${scale}`,
        '--virtual-time-budget=8000',
        `--window-size=${width},${height}`,
        `--screenshot=${out}`,
        `file://${page}`,
      ],
      { stdio: 'pipe' }
    );
    if (!fs.existsSync(out)) throw new Error('Chrome produced no screenshot');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/**
 * `file` down to `width`×`height`, in place or into `out`, with whatever the
 * machine has. Neither tool is required: an oversized picture is oversized,
 * not broken.
 */
export function downscale(file: string, width: number, height = width, out = file): boolean {
  for (const [command, args] of [
    ['magick', [file, '-resize', `${width}x${height}`, '-strip', out]],
    ['sips', ['-Z', String(Math.max(width, height)), file, '--out', out]],
  ] as Array<[string, string[]]>) {
    try {
      execFileSync(command, args, { stdio: 'pipe' });
      return true;
    } catch {
      // Try the next one.
    }
  }
  console.warn(`! neither magick nor sips is here — ${path.basename(out)} stays at full size`);
  return false;
}

/** True if ImageMagick is on the machine; only the .ico actually needs it. */
export function hasMagick(): boolean {
  try {
    execFileSync('magick', ['-version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
