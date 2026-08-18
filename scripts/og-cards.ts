import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { BuiltCourse, BuiltDomain } from '../shared/schema.js';
import { UI_LANGS, type UiLang } from '../shared/schema.js';
import { pluralForm } from '../shared/plural.js';
import { ensureDir, env, ROOT } from './lib/config.js';

/**
 * The card a shared link unfolds into, one per course and per field of
 * knowledge, in both languages.
 *
 * `public/og.png` is the картинка for the site as a whole and stays what it is.
 * This is the other half: a link to a course pasted into a chat used to unfold
 * into the same map as a link to the front page, which tells the reader nothing
 * about what was actually shared. A card with the course's name on it is the
 * difference between "somebody sent a link to Lectorea" and "somebody sent me
 * the analysis course".
 *
 * Two things about how it is made are deliberate.
 *
 * **One Chrome, five hundred pictures.** The obvious shape — `--screenshot`
 * once per card, the way `og-image.ts` does it for the one card it draws — is
 * seven seconds of process start each, which is an hour for a catalogue this
 * size. So the browser is started once and driven over its own debugging
 * protocol: the page is loaded and the fonts are laid out a single time, and
 * each card is a text substitution and a capture, some sixty milliseconds
 * apiece.
 *
 * **Built, not committed.** The site card is a picture somebody decided on and
 * is checked in; these are a function of the catalogue, which changes every
 * night. Five hundred PNGs in the repository would be five hundred rewritten
 * on every title fix, and stale the day after. They are made during `pnpm
 * build` and live only in `dist/`.
 *
 * If there is no Chrome on the machine this says so and stops, without failing
 * the build: `prerender.ts` uses a card when it finds one and the site card
 * when it does not, so a build without a browser is a build with worse link
 * previews and nothing else wrong.
 */

const WIDTH = 1200;
const HEIGHT = 630;

const DIST = path.join(ROOT, 'dist');
const DATA = path.join(DIST, 'data');
const OUT = path.join(DIST, 'og');

/** The dark palette from `src/index.css` — the one the site opens on. */
const SEA = '#0c2431';
const INK = '#eaf3f8';

const CHROMES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function findChrome(): string | null {
  return (
    [process.env.CHROME_PATH, ...CHROMES].find(
      (candidate) => candidate && fs.existsSync(candidate)
    ) ?? null
  );
}

/* ───────────────────────────────  Sources  ─────────────────────────────── */

function read<T>(file: string): T {
  return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8')) as T;
}

const DEFAULT_LANG = env.defaultLang as UiLang;
const LANGS: UiLang[] = [
  DEFAULT_LANG,
  ...UI_LANGS.map((entry) => entry.id).filter((id) => id !== DEFAULT_LANG),
];

/* ────────────────────────────────  The page  ───────────────────────────── */

/**
 * The faces, from `src/fonts` rather than from Google.
 *
 * Headless Chrome ignores a `<link>` to a stylesheet it cannot reach, and a
 * missing font is not an error — it is a picture that looks a little off, in
 * whatever the machine offers for `sans-serif`. Since the site started serving
 * its own fonts there is nothing to fetch: the files are on disk, and the card
 * is set in exactly what the site is set in.
 */
function fontCss(): string {
  const dir = path.join(ROOT, 'src/fonts');
  const faces: string[] = [];
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.woff2'))) {
    const match = /^(.+)-(\d+)-(latin|cyrillic)\.woff2$/.exec(file);
    // Only the two plain alphabets: a card is a title and a line of numbers,
    // and the extended subsets are for prose this picture never carries.
    if (!match) continue;
    const family = match[1] === 'jetbrains-mono' ? 'JetBrains Mono' : match[1] === 'onest' ? 'Onest' : 'Unbounded';
    faces.push(
      `@font-face{font-family:'${family}';font-style:normal;font-weight:${match[2]};` +
        `font-display:block;src:url('file://${path.join(dir, file)}') format('woff2');}`
    );
  }
  return faces.join('\n');
}

/**
 * One page, reused for every card.
 *
 * Everything that changes between cards is set from `setCard` below, so the
 * document is parsed and the fonts laid out once for the whole run.
 */
function cardHtml(): string {
  return `<!doctype html>
<html lang="${DEFAULT_LANG}">
<head>
<meta charset="utf-8" />
<style>
${fontCss()}
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: ${SEA}; }
  .card { position: relative; width: 100%; height: 100%; padding: 72px 76px; display: flex; flex-direction: column; }
  /* The field's own colour, thrown across the corner as light rather than
     printed as a block: the palette is the one thing a reader recognises
     before they have read a word, and a flat panel of it would fight the
     title instead of placing it. */
  .glow {
    position: absolute; inset: 0;
    background: radial-gradient(1100px 620px at 88% -12%, var(--accent) 0%, transparent 62%);
    opacity: 0.42;
  }
  .rule { position: absolute; left: 0; top: 0; bottom: 0; width: 10px; background: var(--accent); }
  .head { position: relative; display: flex; align-items: baseline; gap: 18px; }
  .mark { font-family: Unbounded, sans-serif; font-weight: 700; font-size: 34px; letter-spacing: -0.02em; color: ${INK}; }
  .field {
    font-family: 'JetBrains Mono', monospace; font-weight: 500; font-size: 21px;
    text-transform: uppercase; letter-spacing: 0.16em; color: var(--accent);
  }
  .body { position: relative; flex: 1; display: flex; align-items: center; }
  .title {
    font-family: Unbounded, sans-serif; font-weight: 700; color: ${INK};
    font-size: 82px; line-height: 1.12; letter-spacing: -0.02em;
    /* Four lines is the point at which a title stops being read and starts
       being a paragraph; setCard below steps the size down until it fits. */
    max-height: 380px; overflow: hidden;
  }
  .foot { position: relative; display: flex; justify-content: space-between; align-items: baseline; }
  .facts { font-family: Onest, sans-serif; font-weight: 500; font-size: 28px; color: rgb(234 243 248 / 0.82); }
  .host { font-family: Onest, sans-serif; font-weight: 500; font-size: 24px; letter-spacing: 0.04em; color: rgb(234 243 248 / 0.58); }
</style>
</head>
<body>
  <div class="card" id="card">
    <div class="glow"></div>
    <div class="rule"></div>
    <div class="head"><div class="mark">Lectorea</div><div class="field" id="field"></div></div>
    <div class="body"><div class="title" id="title"></div></div>
    <div class="foot"><div class="facts" id="facts"></div><div class="host">lectorea.org</div></div>
  </div>
<script>
  function setCard(data) {
    document.documentElement.lang = data.lang;
    document.getElementById('card').style.setProperty('--accent', data.accent);
    document.getElementById('field').textContent = data.field;
    document.getElementById('facts').textContent = data.facts;
    const title = document.getElementById('title');
    title.textContent = data.title;
    // Long names are the rule in a catalogue of courses, not the exception —
    // «Уравнения математической физики» is four words of Unbounded. Step down
    // until it fits rather than truncating: a cut title is worse than a small
    // one, and the whole job of this picture is to say which course it is.
    for (const size of [82, 72, 62, 54, 46, 40]) {
      title.style.fontSize = size + 'px';
      if (title.scrollHeight <= title.clientHeight) break;
    }
    return true;
  }
</script>
</body>
</html>`;
}

/* ─────────────────────────  Chrome, over its protocol  ─────────────────── */

type Cdp = {
  send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  close: () => void;
};

/**
 * Which port the browser actually took.
 *
 * Asked for as zero and read back from the profile directory rather than
 * chosen here: a number picked in advance is a number something else on the
 * machine may already hold — another run of this script, a debugger, a dev
 * server — and the failure that produces is a timeout with nothing to say. The
 * browser writes the port it bound to into `DevToolsActivePort` as soon as it
 * has one.
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
  const waiting = new Map<number, { ok: (value: Record<string, unknown>) => void; fail: (error: Error) => void }>();
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

/* ────────────────────────────────  Main  ───────────────────────────────── */

async function main(): Promise<void> {
  if (!fs.existsSync(DATA)) {
    console.warn('! no dist/data — the catalogue has to be built before its cards');
    return;
  }
  const chrome = findChrome();
  if (!chrome) {
    console.warn(
      '! no Chrome here, so no per-course link cards — every page will share the site card.\n' +
        '  Install one, or point CHROME_PATH at it. Nothing else in the build depends on it.'
    );
    return;
  }

  const { courses: allCourses } = read<{ courses: BuiltCourse[] }>('courses.json');
  const courses = allCourses.filter((course) => !course.hidden);
  const domains = read<BuiltDomain[]>('domains.json');
  const domainById = new Map(domains.map((domain) => [domain.id, domain]));
  const fields = domains.filter((domain) => domain.courseCount);
  if (!courses.length) {
    console.warn('! the catalogue in this build has no courses — no cards to draw');
    return;
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'lectorea-cards-'));
  const page = path.join(work, 'card.html');
  fs.writeFileSync(page, cardHtml(), 'utf8');

  const profile = path.join(work, 'profile');
  let browser: ChildProcess | null = null;
  let cdp: Cdp | null = null;
  let drawn = 0;
  let bytes = 0;

  try {
    browser = spawn(
      chrome,
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--no-first-run',
        '--no-default-browser-check',
        // The page and the fonts are all on disk, and one file may not read
        // another without this.
        '--allow-file-access-from-files',
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        `--window-size=${WIDTH},${HEIGHT}`,
        'about:blank',
      ],
      { stdio: 'ignore' }
    );

    const bound = await port(profile, Date.now() + 20_000);
    const targets = (await (await fetch(`http://127.0.0.1:${bound}/json/list`)).json()) as Array<{
      type: string;
      webSocketDebuggerUrl: string;
    }>;
    const target = targets.find((entry) => entry.type === 'page');
    if (!target) throw new Error('Chrome opened no page to draw in');
    cdp = await connect(target.webSocketDebuggerUrl);

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: `file://${page}` });

    // The fonts are the picture; capturing before they are laid out gives a
    // card set in whatever the machine offers for sans-serif, and nothing about
    // it looks like an error.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const state = (await cdp.send('Runtime.evaluate', {
        expression: 'document.fonts.status === "loaded" && !!document.getElementById("title")',
        returnByValue: true,
      })) as { result?: { value?: boolean } };
      if (state.result?.value) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    for (const lang of LANGS) {
      const dict = read<Record<string, string>>(`i18n/${lang}.json`);
      const tr = (key: string, params: Record<string, string> = {}): string =>
        (dict[key] ?? '').replace(/\{(\w+)\}/g, (whole, name: string) => params[name] ?? whole);
      const count = (n: number, noun: string): string =>
        `${n} ${dict[`ui.plural.${noun}.${pluralForm(n, lang)}`] ?? noun}`;

      const cards: Array<{ file: string; data: Record<string, string> }> = [
        ...courses.map((course) => {
          const domain = course.domains.map((id) => domainById.get(id)).find(Boolean);
          const hours = Math.max(1, Math.round(course.hours));
          return {
            file: `${lang}/courses/${course.id}.jpg`,
            data: {
              lang,
              accent: domain?.color ?? '#4c8eda',
              field: domain ? dict[`domain.${domain.id}.title`] ?? '' : '',
              title: dict[`course.${course.id}.title`] ?? course.id,
              facts: course.playlistCount
                ? tr('seo.course.facts', {
                    recordings: count(course.playlistCount, 'recording'),
                    hours: count(hours, 'hour'),
                  })
                : tr('seo.course.empty'),
            },
          };
        }),
        ...fields.map((domain) => ({
          file: `${lang}/fields/${domain.id}.jpg`,
          data: {
            lang,
            accent: domain.color,
            field: dict['seo.heading.fields'] ?? '',
            title: dict[`domain.${domain.id}.title`] ?? domain.id,
            facts: tr('seo.field.order', { courses: count(domain.courseCount, 'course') }),
          },
        })),
      ];

      for (const card of cards) {
        await cdp.send('Runtime.evaluate', {
          expression: `setCard(${JSON.stringify(card.data)})`,
          returnByValue: true,
        });
        const shot = (await cdp.send('Page.captureScreenshot', {
          // JPEG, not PNG. The card is mostly a soft wash of the field's
          // colour, which is the one thing PNG cannot compress — 528 of them
          // came to 55 MB, against 8 for the same pictures as JPEG, and every
          // scraper that reads `og:image` reads both. Quality 82 is above the
          // point where large text starts to ring.
          format: 'jpeg',
          quality: 82,
          captureBeyondViewport: false,
        })) as { data?: string };
        if (!shot.data) throw new Error(`Chrome returned no picture for ${card.file}`);
        const file = path.join(OUT, card.file);
        ensureDir(path.dirname(file));
        const png = Buffer.from(shot.data, 'base64');
        fs.writeFileSync(file, png);
        drawn += 1;
        bytes += png.length;
      }
    }

    console.log(
      `✓ ${drawn} link cards in ${LANGS.length} languages — ${Math.round(bytes / 1024 / 1024)} MB in dist/og`
    );
  } catch (cause) {
    // A build without cards is a build with worse link previews, which is not
    // a reason to publish nothing at all.
    console.warn(`! link cards not drawn: ${(cause as Error).message}`);
  } finally {
    cdp?.close();
    if (browser) {
      // Killed *and waited for*: the browser is still flushing its profile
      // directory when the signal lands, and removing the directory out from
      // under it fails with EACCES — after every card has already been drawn,
      // which would fail a build that had in fact succeeded.
      const stopped = new Promise<void>((resolve) => browser?.once('exit', () => resolve()));
      browser.kill();
      await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    }
    try {
      fs.rmSync(work, { recursive: true, force: true });
    } catch {
      // A temporary directory the system will clear on its own is not a reason
      // to report a failed build.
    }
  }
}

await main();
