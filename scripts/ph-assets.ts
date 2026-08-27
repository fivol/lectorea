import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { PROFILE_KEY, PROFILE_VERSION, ProfileSchema } from '../shared/schema.js';
import { ensureDir, paths } from './lib/config.js';

/**
 * The pictures a Product Hunt listing is made of: six gallery slides at
 * 1270×760 and a 240×240 thumbnail, shot off the English site itself.
 *
 * Three things make this a script rather than an afternoon in a graphics
 * editor, and each of them is a mistake it stops somebody making.
 *
 * **English.** Every screenshot in `docs/images` is of the Russian interface,
 * because that is the language the documentation is read in. Product Hunt is
 * read in English, and a gallery of Russian screenshots tells an English
 * reader the site is not for them before they have read the tagline. The
 * English site is a different address — `/en/` — so the fix is to shoot that
 * one.
 *
 * **A profile with something in it.** The screens worth showing are the ones
 * that know who is looking: a path with seven of twelve courses behind it, a
 * streak, something to carry on with. A clean browser has none of that, and a
 * launch gallery of empty states is a gallery of an empty product. So the
 * profile is written into `localStorage` before the page loads — the same key
 * the site itself writes, built out of real playlists from the catalogue.
 *
 * **A caption per slide.** The strip is scrolled without the description being
 * read, so each picture has to say its one sentence by itself. The captions
 * are laid over the live page just before the capture, in the site's own type.
 *
 * Built, not committed: `.launch/` is ignored the way `.tiles/` and `.stats/`
 * are, and the inputs are all in the repository.
 *
 * Rendered by whatever Chrome is on the machine and driven over its debugging
 * protocol, the way `og-cards.ts` draws the link cards — one browser, seven
 * pictures. A local command; CI never runs it.
 *
 * ```bash
 * pnpm ph:assets                      # the live site
 * PH_BASE=http://localhost:5173 pnpm ph:assets   # a dev server
 * ```
 *
 * Every other field of the submission form: [docs/product-hunt.md](../docs/product-hunt.md).
 */

const WIDTH = 1270;
const HEIGHT = 760;
const PHONE = { width: 402, height: 760 };
const THUMB = 240;

/** The dark palette from `src/index.css` — the one the site opens on. */
const SEA = '#0c2431';
const INK = '#eaf3f8';

const BASE = (process.env.PH_BASE ?? 'https://lectorea.org').replace(/\/+$/, '');
const OUT = path.join(paths.root, '.launch');

/** The course the gallery follows, and the goal the seeded profile is aiming at. */
const GOAL = 'deep-learning';
/** How much of the path to that goal is already behind the imagined reader. */
const DONE_SHARE = 0.6;

type Shot = {
  /** File name, and what the slide is. */
  name: string;
  /** Address under the English site. */
  page: string;
  /** The one sentence the slide has to say on its own. */
  caption: string;
  /** Run in the page once it has settled — opens a panel, presses a button. */
  prepare?: string;
  /** A phone-shaped capture, set into the landscape slide afterwards. */
  phone?: boolean;
};

/**
 * The running order. It is an argument, not a tour: the map answers "what is
 * this", the columns answer "how is it ordered", the course answers "what do I
 * get when I open one", and the path is the thing nothing else does. The
 * profile and the phone are the two questions a reader asks last — does it
 * remember me, and does it work where I actually watch.
 *
 * The first slide is also the social preview — what a link to the launch
 * unfolds into on X — so it carries the map, which is the one picture that is
 * recognisably this site and nothing else.
 */
const SHOTS: Shot[] = [
  {
    name: 'map',
    page: '/en/',
    caption: '39 fields of knowledge, drawn as a map',
    // The seeded profile puts the resume bar at the foot of the map, and at
    // 1270 the window is nine pixels short of the width that would have put it
    // in the corner instead — so it lands exactly where the caption does and
    // comes out half-swallowed. On the one slide that is also the social
    // preview, that reads as a broken render rather than as a feature. Climb
    // from the bar's own label to the sticky band it rides and drop the band.
    prepare: `document.querySelectorAll('.sticky.bottom-0').forEach(
      (band) => band.style.setProperty('display', 'none')
    )`,
  },
  {
    name: 'columns',
    page: '/en/fields/cs',
    caption: 'Every column is a level: what has to come before this',
  },
  {
    name: 'course',
    page: `/en/courses/${GOAL}`,
    caption: 'What it needs, what it opens up, and every recording',
  },
  {
    name: 'path',
    page: `/en/courses/${GOAL}`,
    caption: 'Make it a goal: the whole path, in order, with the hours',
    // Open the path, then bring its list up: unfolded, it starts below the
    // fold of the panel, and a slide of the row that opens it says nothing.
    prepare: `(() => {
      const row = [...document.querySelectorAll('button')]
        .find((button) => /^Path:/.test((button.textContent || '').trim()));
      row?.click();
      setTimeout(() => row?.scrollIntoView({ block: 'start' }), 400);
    })()`,
  },
  {
    name: 'profile',
    page: '/en/',
    caption: 'Hours, streak, and where you left off — in your browser',
    prepare: `document.querySelector('button[aria-label="Profile"]')?.click()`,
  },
  {
    name: 'phone',
    page: '/en/',
    caption: 'Redrawn for a phone, and it installs as an app',
    phone: true,
  },
];

const CHROMES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function findChrome(): string {
  const found = [process.env.CHROME_PATH, ...CHROMES].find(
    (candidate) => candidate && fs.existsSync(candidate)
  );
  if (!found) {
    console.error(
      '✗ no Chrome found — install it, or point CHROME_PATH at one.\n' +
        '  It is only needed to draw the launch pictures; nothing else uses it.'
    );
    process.exit(1);
  }
  return found;
}

/* ─────────────────────────  The profile that is seeded  ────────────────── */

type BuiltCourse = { id: string; deps: string[]; playlistCount: number };
type BuiltPlaylist = {
  id: string;
  courseId: string;
  title: string;
  lang: string;
  fullCourse?: boolean;
  rating?: number;
  videos?: Array<{ id: string; seconds?: number } | string>;
};

function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function videoIds(playlist: BuiltPlaylist): string[] {
  return (playlist.videos ?? []).map((video) => (typeof video === 'string' ? video : video.id));
}

/** The best English full-course recording of a course, which is what a reader would pick. */
function bestPlaylist(courseId: string): BuiltPlaylist | null {
  const file = path.join(paths.outData, 'playlists', `${courseId}.json`);
  if (!fs.existsSync(file)) return null;
  const all = readJson<BuiltPlaylist[]>(file).filter((entry) => entry.lang === 'en');
  const full = all.filter((entry) => entry.fullCourse);
  return (full.length ? full : all).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0] ?? null;
}

/** Everything the goal stands on, deepest first — the path the site would draw. */
function pathTo(goal: string, courses: Map<string, BuiltCourse>): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const walk = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const dep of courses.get(id)?.deps ?? []) walk(dep);
    order.push(id);
  };
  walk(goal);
  return order.filter((id) => id !== goal);
}

function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() - offset);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A reader six weeks into a route towards deep learning.
 *
 * Written against the real catalogue rather than invented: the playlists are
 * the ones the site would actually rank first, so the profile shows titles a
 * visitor can go and find. What is invented is only the studying itself —
 * which courses are behind them, and on which days.
 */
function seededProfile(): string {
  const { courses } = readJson<{ courses: BuiltCourse[] }>(
    path.join(paths.outData, 'courses.json')
  );
  const byId = new Map(courses.map((course) => [course.id, course]));
  const route = pathTo(GOAL, byId);
  const done = route.slice(0, Math.max(1, Math.round(route.length * DONE_SHARE)));
  const current = route[done.length] ?? GOAL;

  const now = new Date().toISOString();
  const profile: Record<string, unknown> = {
    version: PROFILE_VERSION,
    updatedAt: now,
    courses: {} as Record<string, unknown>,
    playlists: {} as Record<string, unknown>,
    videos: {} as Record<string, unknown>,
    recent: [] as unknown[],
    days: [] as unknown[],
    settings: { lang: 'en', playlistLangs: ['en'], theme: 'dark' },
  };
  const marks = profile.courses as Record<string, unknown>;
  const playlists = profile.playlists as Record<string, unknown>;
  const videos = profile.videos as Record<string, unknown>;
  const recent = profile.recent as unknown[];

  done.forEach((courseId, index) => {
    marks[courseId] = { status: 'done', favorite: false, manual: false, at: day(30 - index) };
    const playlist = bestPlaylist(courseId);
    if (!playlist) return;
    playlists[playlist.id] = {
      watched: true,
      favorite: false,
      courseId,
      at: day(30 - index),
    };
  });

  // The one being studied now: half its lectures ticked, and a place to
  // resume — which is what «Продолжить» on the front page reads.
  marks[current] = { status: 'in_progress', favorite: false, manual: false, at: day(1) };
  const playlist = bestPlaylist(current);
  if (playlist) {
    const ids = videoIds(playlist);
    const half = ids.slice(0, Math.max(1, Math.floor(ids.length / 2)));
    for (const id of half) videos[id] = { done: true };
    const next = ids[half.length];
    if (next) videos[next] = { done: false, sec: 812 };
    playlists[playlist.id] = {
      watched: false,
      favorite: true,
      courseId: current,
      lastVideoId: next ?? half[half.length - 1],
      at: day(0),
    };
    recent.push({ id: playlist.id, courseId: current, title: playlist.title, at: day(0) });
  }

  // The goal itself: a favourite, which is what makes the path a path.
  marks[GOAL] = { status: null, favorite: true, manual: false, at: day(12) };
  const goalPlaylist = bestPlaylist(GOAL);
  if (goalPlaylist) {
    playlists[goalPlaylist.id] = { watched: false, favorite: true, courseId: GOAL, at: day(6) };
    recent.push({ id: goalPlaylist.id, courseId: GOAL, title: goalPlaylist.title, at: day(6) });
  }

  // Six weeks of days, studied on most of them and on every one of the last
  // six — a streak is a number a reader checks against their own week.
  const days: Array<{ day: string; sec: number; lectures: number }> = [];
  for (let offset = 41; offset >= 0; offset -= 1) {
    if (offset > 5 && offset % 3 === 0) continue;
    days.push({
      day: day(offset),
      sec: 1800 + ((offset * 37) % 2400),
      lectures: 1 + (offset % 3),
    });
  }
  profile.days = days;

  /*
   * Parsed with the site's own schema before it is written anywhere.
   *
   * A profile the schema rejects is not a visible error: `readProfile` reads
   * it as corrupt and replaces it with an empty one, so the gallery comes out
   * a set of empty states that look deliberate. The first run of this script
   * wrote `in-progress` where the enum says `in_progress` and produced exactly
   * that. Failing here costs a stack trace; failing there costs a launch.
   */
  return JSON.stringify(ProfileSchema.parse(profile));
}

/* ─────────────────────────  Chrome, over its protocol  ─────────────────── */

type Cdp = {
  send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  close: () => void;
};

/**
 * Which port the browser took. Asked for as zero and read back from the
 * profile directory: a number chosen in advance is a number something else on
 * the machine may already hold, and the failure that produces is a timeout
 * with nothing to say.
 */
async function port(profile: string, deadline: number): Promise<number> {
  const file = path.join(profile, 'DevToolsActivePort');
  for (;;) {
    if (fs.existsSync(file)) {
      const first = fs.readFileSync(file, 'utf8').split('\n')[0]?.trim();
      if (first && Number(first) > 0) return Number(first);
    }
    if (Date.now() > deadline) throw new Error('Chrome never opened its debugging port');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function connect(url: string): Promise<Cdp> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error(`cannot reach ${url}`)), { once: true });
  });

  let id = 0;
  const waiting = new Map<
    number,
    { ok: (value: Record<string, unknown>) => void; fail: (error: Error) => void }
  >();
  socket.addEventListener('message', (event: MessageEvent) => {
    const message = JSON.parse(String(event.data)) as {
      id?: number;
      result?: Record<string, unknown>;
      error?: { message: string };
    };
    if (message.id === undefined) return;
    const pending = waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id);
    if (message.error) pending.fail(new Error(message.error.message));
    else pending.ok(message.result ?? {});
  });

  return {
    send: (method, params = {}) =>
      new Promise((ok, fail) => {
        const next = ++id;
        waiting.set(next, { ok, fail });
        socket.send(JSON.stringify({ id: next, method, params }));
      }),
    close: () => socket.close(),
  };
}

async function evaluate<T>(cdp: Cdp, expression: string): Promise<T | undefined> {
  const answer = (await cdp.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })) as { result?: { value?: T } };
  return answer.result?.value;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ──────────────────────────────  The slides  ───────────────────────────── */

/**
 * The caption, laid over the page in the site's own type.
 *
 * A band above the screenshot would cost 140 pixels of interface on every
 * slide, and the strip is scrolled for the interface. So the words sit on the
 * picture, over a scrim that is heaviest under them and gone by halfway up.
 */
function captionScript(caption: string): string {
  return `(() => {
    document.getElementById('ph-caption')?.remove();
    const layer = document.createElement('div');
    layer.id = 'ph-caption';
    layer.innerHTML = \`
      <div style="position:fixed;inset:0;z-index:2147483647;pointer-events:none;
        background:linear-gradient(0deg, rgba(6,18,25,0.96) 0%, rgba(6,18,25,0.84) 13%, rgba(6,18,25,0.2) 32%, rgba(6,18,25,0) 48%)"></div>
      <div style="position:fixed;left:64px;right:250px;bottom:52px;z-index:2147483647;pointer-events:none;
        font-family:Onest,system-ui,sans-serif;font-weight:500;font-size:36px;line-height:1.24;
        letter-spacing:-0.01em;color:${INK}">${caption}</div>
      <div style="position:fixed;right:60px;bottom:56px;z-index:2147483647;pointer-events:none;
        font-family:Unbounded,Onest,system-ui,sans-serif;font-weight:700;font-size:24px;
        letter-spacing:-0.01em;color:rgba(234,243,248,0.72)">lectorea.org</div>\`;
    document.body.appendChild(layer);
    return true;
  })()`;
}

/** A phone-shaped capture set into the landscape slide, on the site's own sea. */
function phoneSlideHtml(shot: string, caption: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8" /><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; background: ${SEA}; overflow: hidden;
         font-family: Onest, system-ui, sans-serif; }
  .wrap { position: relative; width: 100%; height: 100%;
          display: flex; align-items: center; justify-content: center; gap: 90px; padding: 0 96px; }
  .phone { height: 664px; border-radius: 34px; border: 1px solid rgba(234,243,248,0.16);
           box-shadow: 0 40px 90px rgba(0,0,0,0.55); }
  .words { max-width: 470px; }
  .line { font-size: 42px; font-weight: 500; line-height: 1.22; letter-spacing: -0.01em; color: ${INK}; }
  .host { position: absolute; right: 64px; bottom: 48px; font-weight: 700; font-size: 24px;
          color: rgba(234,243,248,0.6); }
</style></head>
<body><div class="wrap">
  <img class="phone" src="data:image/png;base64,${shot}" />
  <div class="words"><div class="line">${caption}</div></div>
  <div class="host">lectorea.org</div>
</div></body></html>`;
}

function thumbHtml(): string {
  const icon = fs.readFileSync(path.join(paths.publicDir, 'pwa-512.png')).toString('base64');
  return `<!doctype html>
<html><head><meta charset="utf-8" /><style>
  * { margin: 0; padding: 0; }
  body { width: ${THUMB}px; height: ${THUMB}px; background: ${SEA}; overflow: hidden; }
  img { width: ${THUMB}px; height: ${THUMB}px; display: block; }
</style></head>
<body><img src="data:image/png;base64,${icon}" /></body></html>`;
}

/* ────────────────────────────────  Main  ───────────────────────────────── */

async function main(): Promise<void> {
  if (!fs.existsSync(path.join(paths.outData, 'courses.json'))) {
    console.error('✗ no public/data — run `pnpm data:build` first; the profile is seeded from it.');
    process.exit(1);
  }

  ensureDir(OUT);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lectorea-ph-'));
  const profileDir = path.join(work, 'chrome');
  const seeded = seededProfile();

  let browser: ChildProcess | null = null;
  let cdp: Cdp | null = null;

  try {
    browser = spawn(
      findChrome(),
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        '--allow-file-access-from-files',
        '--remote-debugging-port=0',
        `--user-data-dir=${profileDir}`,
        `--window-size=${WIDTH},${HEIGHT}`,
        'about:blank',
      ],
      { stdio: 'ignore' }
    );

    const bound = await port(profileDir, Date.now() + 20_000);
    const targets = (await (await fetch(`http://127.0.0.1:${bound}/json/list`)).json()) as Array<{
      type: string;
      webSocketDebuggerUrl: string;
    }>;
    const target = targets.find((entry) => entry.type === 'page');
    if (!target) throw new Error('Chrome opened no page to shoot in');
    cdp = await connect(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');

    /*
     * Written before the app is, on every navigation.
     *
     * Two things a clean browser gets wrong for a launch picture: it has never
     * studied anything, and it is owed the "what is what here" card that opens
     * over the columns on a first visit. Both are one localStorage key.
     */
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try {
        localStorage.setItem(${JSON.stringify(PROFILE_KEY)}, ${JSON.stringify(seeded)});
        localStorage.setItem('lectorea.legend.seen.v1', '1');
      } catch {}`,
    });

    for (const [index, shot] of SHOTS.entries()) {
      const file = path.join(OUT, `${String(index + 1).padStart(2, '0')}-${shot.name}.png`);
      const size = shot.phone ? PHONE : { width: WIDTH, height: HEIGHT };

      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: size.width,
        height: size.height,
        // Twice the size, then down again: type on a screenshot renders soft
        // at 1×, and the captions are half the picture.
        deviceScaleFactor: 2,
        mobile: Boolean(shot.phone),
      });
      await cdp.send('Page.navigate', { url: `${BASE}${shot.page}` });
      await settle(cdp);
      if (shot.prepare) {
        await evaluate(cdp, shot.prepare);
        await wait(900);
      }
      if (!shot.phone) await evaluate(cdp, captionScript(shot.caption));

      const shotData = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as {
        data: string;
      };

      if (shot.phone) {
        const page = path.join(work, 'phone.html');
        fs.writeFileSync(page, phoneSlideHtml(shotData.data, shot.caption), 'utf8');
        await cdp.send('Emulation.setDeviceMetricsOverride', {
          width: WIDTH,
          height: HEIGHT,
          deviceScaleFactor: 2,
          mobile: false,
        });
        await cdp.send('Page.navigate', { url: `file://${page}` });
        await settle(cdp);
        const composed = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as {
          data: string;
        };
        write(file, composed.data, WIDTH, HEIGHT);
      } else {
        write(file, shotData.data, WIDTH, HEIGHT);
      }
      report(file, `${WIDTH}×${HEIGHT}`);
    }

    const thumbFile = path.join(work, 'thumb.html');
    fs.writeFileSync(thumbFile, thumbHtml(), 'utf8');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: THUMB,
      height: THUMB,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: `file://${thumbFile}` });
    await settle(cdp);
    const thumb = (await cdp.send('Page.captureScreenshot', { format: 'png' })) as { data: string };
    const thumbOut = path.join(OUT, 'thumbnail.png');
    write(thumbOut, thumb.data, THUMB, THUMB);
    report(thumbOut, `${THUMB}×${THUMB}`);
  } finally {
    cdp?.close();
    browser?.kill();
    // Chrome is still flushing its profile directory when it is killed, and a
    // temp directory that outlives the run is not worth failing over.
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch {
      // Left for the operating system to sweep up.
    }
  }
}

/**
 * Waits for the page to be worth photographing.
 *
 * The catalogue arrives as JSON after the bundle does, and the fonts after
 * that: capture too early and the picture is a loading line set in whatever
 * the machine offers for sans-serif, which does not look like an error to
 * anyone reviewing it.
 */
async function settle(cdp: Cdp): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const ready = await evaluate<boolean>(
      cdp,
      `document.fonts.status === 'loaded' && document.readyState === 'complete'
        && !document.body.innerText.includes('Loading')`
    );
    if (ready) break;
    await wait(150);
  }
  // The map draws itself in with a transition; a capture during it is a map
  // half faded in.
  await wait(900);
}

function write(file: string, base64: string, width: number, height: number): void {
  fs.writeFileSync(file, Buffer.from(base64, 'base64'));
  downscale(file, width, height);
}

/** Back to size, with whatever the machine has. Neither tool is required. */
function downscale(file: string, width: number, height: number): void {
  for (const [command, args] of [
    ['magick', [file, '-resize', `${width}x${height}`, '-strip', file]],
    ['sips', ['-Z', String(Math.max(width, height)), file]],
  ] as Array<[string, string[]]>) {
    try {
      execFileSync(command, args, { stdio: 'pipe' });
      return;
    } catch {
      // Try the next one; a 2× picture is oversized, not broken.
    }
  }
  console.warn('! neither magick nor sips is here — the pictures stay at 2×');
}

/** Product Hunt refuses anything over 3 MB, so the weight is part of the result. */
function report(file: string, size: string): void {
  const kb = Math.round(fs.statSync(file).size / 1024);
  const over = kb > 3 * 1024 ? '  ← over Product Hunt’s 3 MB limit' : '';
  console.log(`✓ ${path.relative(paths.root, file)} — ${size}, ${kb} KB${over}`);
}

main().catch((error: unknown) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
