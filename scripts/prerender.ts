import fs from 'node:fs';
import path from 'node:path';
import type { BuiltCourse, BuiltDomain, BuiltPlaylist, Meta } from '../shared/schema.js';
import { UI_LANGS, type UiLang } from '../shared/schema.js';
import { pluralForm } from '../shared/plural.js';
import { ensureDir, env, ROOT } from './lib/config.js';

/**
 * A static page per course, per field of knowledge and per language, made
 * after the bundle.
 *
 * Everything here exists because Pages serves files and the catalogue is one
 * file. A path it has never heard of — `/courses/calculus-1` — is answered with
 * `404.html`, and answered with the status to match: the app appears, the
 * reader sees the course, and a crawler sees `HTTP 404` and leaves. That is the
 * whole reason nothing below `/` was ever indexed.
 *
 * So every URL the catalogue offers gets a real file at that path, built from
 * the bundle's own `index.html` — same hashed script, same styles, so the app
 * boots exactly as it does anywhere else. What differs is the head: the title,
 * the description and the card of *that* course rather than of the catalogue,
 * and a `<noscript>` copy of what the page says, which is what a crawler that
 * runs no JavaScript is left with. The sitemap, robots.txt and llms.txt come
 * from the same pass, since the list of URLs is already in hand.
 *
 * Twice over, because the interface speaks two languages and a language needs
 * an address: Russian at the root, English under `/en/`, each declaring the
 * other with `hreflang`. See docs/hosting.md.
 */

const DIST = path.join(ROOT, 'dist');
const DATA = path.join(DIST, 'data');

/* ──────────────────────────  Which site this is  ───────────────────────── */

const repo = process.env.VITE_REPO ?? 'fivol/lectorea';
const owner = repo.split('/')[0];
const base = process.env.BASE_PATH || `/${repo.split('/')[1]}/`;

/**
 * The address every absolute URL on the page names — the canonical link, the
 * card image, every entry in the sitemap. A guess would be worse than nothing:
 * a fork announcing lectorea.org as its own canonical hands its pages to a site
 * that never asked for them, so the origin follows the same signal as the base
 * path — the root means the domain, a subdirectory means somebody's fork.
 */
const origin =
  process.env.SITE_ORIGIN ?? (base === '/' ? 'https://lectorea.org' : `https://${owner}.github.io`);

/**
 * A fork is this catalogue at a second address, and two addresses with one
 * catalogue between them compete in search until one of them is chosen for the
 * reader. The original is the one with the domain, so a copy asks to be left
 * out — in robots.txt for the crawler that reads it first, and in a `noindex`
 * for the one that arrives by a link instead.
 */
const isMirror = base !== '/';

/* ────────────────────────────  The languages  ──────────────────────────── */

/**
 * Every language lives in a directory named after it — `/ru/…`, `/en/…` — and
 * none of them at the root.
 *
 * The root was the catalogue's own language for a while, which is the cheaper
 * arrangement and the wrong one: it makes one language the exception to every
 * rule about addresses, so a link is `/courses/x` or `/en/courses/x` depending
 * on which, and every function that builds one has to know which. Symmetry is
 * worth the redirect at the door.
 *
 * The root keeps a page at each of those addresses all the same — a small one
 * that decides which language the reader wants and sends them there. See
 * `redirectPage`.
 */
const DEFAULT_LANG = env.defaultLang as UiLang;
const LANGS: UiLang[] = [
  DEFAULT_LANG,
  ...UI_LANGS.map((entry) => entry.id).filter((id) => id !== DEFAULT_LANG),
];

/** `ru/`, `en/` — the directory a language's pages live in. */
function langBase(lang: UiLang): string {
  return `${lang}/`;
}

/**
 * The same path with no language on it — where the redirector lives, and what
 * `x-default` names: the address for a reader whose language we cannot guess,
 * which is exactly the one that guesses.
 */
function rootHref(pathname = ''): string {
  return `${origin}${base}${pathname}`;
}

/** An absolute URL for a path inside the site: `href('en', 'courses')`. */
function href(lang: UiLang, pathname = ''): string {
  return `${origin}${base}${langBase(lang)}${pathname}`;
}

/** The same, as a link the page itself can carry — no host, so a fork works. */
function local(lang: UiLang, pathname = ''): string {
  return `${base}${langBase(lang)}${pathname}`;
}

/**
 * What every page says to a crawler, in the two versions there are.
 *
 * `max-image-preview:large` is the half worth explaining. Google shows a
 * thumbnail the size of a favicon next to a result unless the page says
 * otherwise, and this catalogue draws a 1200×630 card for every course and
 * every field of knowledge — the one thing a result of ours has that a list of
 * YouTube links does not. Without this line those cards are never shown at
 * their size, and a page is not eligible for Discover at all.
 */
const ROBOTS = {
  in: 'index, follow, max-image-preview:large',
  out: 'noindex, follow',
};

/** What `og:locale` calls each of them. */
const LOCALE: Record<string, string> = { ru: 'ru_RU', en: 'en_US' };

/* ───────────────────────────────  Sources  ─────────────────────────────── */

function read<T>(file: string): T {
  const full = path.join(DATA, file);
  if (!fs.existsSync(full)) {
    console.error(
      `✗ ${path.relative(ROOT, full)} is missing — the catalogue has to be built before its pages.`
    );
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(full, 'utf8')) as T;
}

const { courses: allCourses } = read<{ courses: BuiltCourse[] }>('courses.json');
const domains = read<BuiltDomain[]>('domains.json');
const meta = read<Meta>('meta.json');
const dicts = new Map<UiLang, Record<string, string>>(
  LANGS.map((lang) => [lang, read<Record<string, string>>(`i18n/${lang}.json`)])
);

/** Hidden courses are dropped before the app draws anything — so is their page. */
const courses = allCourses.filter((course) => !course.hidden);
const byId = new Map(courses.map((course) => [course.id, course]));
const domainById = new Map(domains.map((domain) => [domain.id, domain]));

/** What each course opens up: the other side of `deps`, which the data omits. */
const opens = new Map<string, string[]>();
for (const course of courses) {
  for (const dep of course.deps) {
    if (!byId.has(dep)) continue;
    opens.set(dep, [...(opens.get(dep) ?? []), course.id]);
  }
}

/**
 * The fields of knowledge that get a page. An empty one has nothing to put on
 * it and nothing to rank for — it would be a title, a sentence and no list.
 */
const fieldsWithCourses = domains.filter((domain) => domain.courseCount);

/** Universities by id — what «msu» is called when it has to be read out. */
const providers = read<Record<string, { title?: string }>>('providers.json');

/**
 * The recordings of one course, in the order the build ranked them.
 *
 * Opened per course rather than all at once: the whole set is some six thousand
 * entries across 225 files and a page uses six of them. A course whose file is
 * missing — a checkout with no crawl cache, which is a supported way to build
 * the site — is a page without that section, not a build that stops.
 */
function recordingsOf(id: string): BuiltPlaylist[] {
  const file = path.join(DATA, 'playlists', `${id}.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')) as BuiltPlaylist[];
}

/** How many of them a page names. Enough to show the range, short of a listing. */
const RECORDINGS_SHOWN = 6;

const lastmod = meta.builtAt.slice(0, 10);

/**
 * A build can legitimately have no catalogue in it — a checkout with no
 * `cache.db`, documented as enough to work on the interface — and it can have
 * none by accident, as when CI restores a crawl cache that a failed run left
 * empty. Either way the prose must not count out loud: «0 курсов в 39 областях
 * знаний» is a sentence nobody should be able to publish by not noticing.
 */
const empty = courses.length === 0;

/* ──────────────────────────────  Rendering  ────────────────────────────── */

type Page = {
  /** Which language it is written in — the head and every link follow it. */
  lang: UiLang;
  /** Where the file goes inside dist — and, minus `.html`, what Pages serves it at. */
  file: string;
  /**
   * The path it is reached by inside its own language, empty for the front
   * page. Language-free on purpose: it is also the key that pairs a page with
   * its translation, which is what `hreflang` and the sitemap are built from.
   */
  pathname: string;
  title: string;
  description: string;
  /**
   * Whether the page may name itself the canonical one. A file that serves many
   * views — `/courses` also answers `?provider=…` — must not, or every filtered
   * view is declared a duplicate of the bare column screen before the app has
   * had a chance to say otherwise. Those set it from the browser.
   */
  canonical: boolean;
  jsonLd?: unknown[];
  /** What a crawler that runs no JavaScript is given in place of the app. */
  body?: string;
  noindex?: boolean;
  /** A page that exists in one language only — the 404, which Pages serves once. */
  untranslated?: boolean;
};

const template = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * `</script>` inside a JSON string would close the tag it is written in, and
 * the rest of the page with it. Escaping the angle bracket is the standard
 * defence and leaves the JSON itself valid.
 */
function jsonLdScript(value: unknown): string {
  const json = JSON.stringify(value).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">${json}</script>`;
}

/**
 * The picture a shared link unfolds into: this page's own, if one was drawn.
 *
 * `scripts/og-cards.ts` writes a card per course and per field, in both
 * languages, during the same build — but it needs a Chrome, and a machine
 * without one is a supported way to build the site. So the file is looked for
 * rather than assumed, and a page with no card of its own falls back to the
 * card for the site. Nothing announces a picture that is not there.
 */
function card(page: Pick<Page, 'lang' | 'pathname' | 'title'>): {
  url: string;
  type: string;
  alt: string;
} | null {
  if (!page.pathname) return null;
  const file = `og/${page.lang}/${page.pathname}.jpg`;
  if (!fs.existsSync(path.join(DIST, file))) return null;
  return { url: rootHref(file), type: 'image/jpeg', alt: page.title };
}

function render(page: Page): string {
  const url = href(page.lang, page.pathname);
  const picture = card(page);
  const head = [
    `<title>${escapeHtml(page.title)}</title>`,
    `<meta name="description" content="${escapeHtml(page.description)}" />`,
    `<meta property="og:title" content="${escapeHtml(page.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    // Absolute by requirement: a card is fetched by a scraper that has only the
    // tag to go on, and a path relative to the site means nothing to it.
    `<meta property="og:image" content="${picture ? picture.url : rootHref('og.png')}" />`,
    `<meta property="og:image:type" content="${picture ? picture.type : 'image/png'}" />`,
    `<meta property="og:image:alt" content="${escapeHtml(
      picture ? picture.alt : 'Lectorea'
    )}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:locale" content="${LOCALE[page.lang] ?? page.lang}" />`,
  ];
  if (page.canonical) head.push(`<link rel="canonical" href="${url}" />`);

  /*
   * The same page in the other language, named in both directions.
   *
   * Without this the two trees are two sites saying the same thing, which is
   * the duplicate every catalogue with a translation trips over: search picks
   * one of them per query and the other never appears. `x-default` is the one
   * to serve somebody whose language we do not have — the catalogue's own, and
   * the address people already link to.
   */
  if (!page.untranslated) {
    for (const lang of LANGS) {
      head.push(`<link rel="alternate" hreflang="${lang}" href="${href(lang, page.pathname)}" />`);
    }
    head.push(`<link rel="alternate" hreflang="x-default" href="${rootHref(page.pathname)}" />`);
  }

  head.push(`<meta name="robots" content="${ROBOTS[page.noindex || isMirror ? 'out' : 'in']}" />`);
  for (const entry of page.jsonLd ?? []) head.push(jsonLdScript(entry));

  /*
   * The same door script the root pages carry, in every page of the app too.
   *
   * On a real page it returns on its first line — the path already names a
   * language. It is here for `404.html`, which is one file answering every
   * address nobody claimed: served for `/courses/typo` it has to send the
   * reader somewhere with a language on it, and served for `/ru/courses/typo`
   * it must not. Only the path can tell those apart, and only at the moment it
   * is read.
   */
  head.push(`<script>${chooseLanguage()}</script>`);

  const html = template
    // Dropped rather than rewritten in place: the template writes some of these
    // across several lines and some on one, and a page that quietly kept the
    // catalogue's description because a regex missed it would look right.
    .replace(/[ \t]*<title>[\s\S]*?<\/title>\n/, '')
    .replace(/[ \t]*<meta\s+name="description"[\s\S]*?\/>\n/, '')
    .replace(/[ \t]*<meta\s+property="og:title"[\s\S]*?\/>\n/, '')
    .replace(/[ \t]*<meta\s+property="og:description"[\s\S]*?\/>\n/, '')
    .replace(/[ \t]*<meta\s+property="og:image"[\s\S]*?\/>\n/, '')
    // The template's alt text describes the map, which is the wrong caption for
    // a card with a course name on it — and a wrong alt is worse than none.
    .replace(/[ \t]*<meta\s+property="og:image:alt"[\s\S]*?\/>\n/, '')
    // The one attribute outside the head that says what language this is, and
    // the first thing a screen reader and a translation prompt both read.
    .replace(/<html lang="[^"]*"/, `<html lang="${page.lang}"`)
    .replace('</head>', `\n    ${head.join('\n    ')}\n  </head>`);

  if (!page.body) return html;
  return html.replace(
    '<div id="root"></div>',
    `<div id="root"></div>\n    <noscript>\n${page.body}\n    </noscript>`
  );
}

/**
 * The same page, asked for with a slash on the end.
 *
 * `/courses/calculus-1/` is not a path this site has a file for, so Pages
 * answers it with `404.html` and the 404 status to match — and a link that
 * picked up a trailing slash on its way through somebody's CMS is a dead link
 * and an address search will not keep.
 *
 * Written as the whole page rather than as a redirect to it, on purpose. Which
 * of `courses.html` and `courses/index.html` a static host prefers for the bare
 * `/courses` is its business and not documented anywhere we control, and a
 * redirect that turned out to be the file *both* addresses resolve to would be
 * a page redirecting to itself. The same bytes under both names cannot fail
 * that way, and they carry a canonical link naming the slashless address, which
 * is what a crawler consolidates the pair on.
 */
function writeSlashVariant(page: Page): void {
  // The front page and 404 have no path of their own: `/` is already the slash
  // form, and nothing should be reachable at `404.html/`.
  if (!page.pathname) return;
  const file = path.join(DIST, page.file.replace(/\.html$/, '/index.html'));
  ensureDir(path.dirname(file));
  // `canonical` is forced on even where the page itself declines it: the
  // slashed twin exists to point at the other one, which is the one thing it
  // is always right about.
  fs.writeFileSync(file, render({ ...page, canonical: true }), 'utf8');
}

function write(page: Page): void {
  const file = path.join(DIST, page.file);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, render(page), 'utf8');
  writeSlashVariant(page);
}

/* ────────────────────────  One language's pages  ───────────────────────── */

/** Search results cut a description at about 160 characters — so cut it here. */
function clip(text: string, limit = 160): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[,.;:—-]$/, '')}…`;
}

function hoursOf(course: BuiltCourse): number {
  return Math.max(1, Math.round(course.hours));
}

/**
 * Every page of the catalogue, written in one language.
 *
 * A closure rather than a pile of functions each taking a `lang`: the
 * dictionary, the titles and the counting words are all the same argument, and
 * threading it through fourteen call sites is how one of them ends up in the
 * wrong language on a page nobody who works here ever opens.
 */
function pagesIn(lang: UiLang) {
  const dict = dicts.get(lang) ?? {};

  /**
   * A string from the dictionary, filled in — the same keys the app names a
   * page with once it has booted. Two wordings for one page would be two
   * answers to "what is this", and the one a crawler keeps is not the one it
   * read first.
   */
  const tr = (key: string, params: Record<string, string> = {}, fallback = ''): string => {
    const t = dict[key];
    if (!t) return fallback;
    return t.replace(/\{(\w+)\}/g, (whole, name: string) => params[name] ?? whole);
  };

  /** «225 курсов», «22 курса», «1 курс» — the count and its noun, in agreement. */
  const count = (n: number, noun: string): string =>
    `${n} ${tr(`ui.plural.${noun}.${pluralForm(n, lang)}`, {}, noun)}`;

  const courseTitle = (id: string): string => dict[`course.${id}.title`] ?? id;
  const domainTitle = (id: string): string => dict[`domain.${id}.title`] ?? id;

  const linksTo = (ids: string[]): string =>
    ids
      .map(
        (id) =>
          `        <li><a href="${local(lang, `courses/${id}`)}">${escapeHtml(courseTitle(id))}</a></li>`
      )
      .join('\n');

  const mapLink = `<p><a href="${local(lang)}">${escapeHtml(tr('seo.link.map', {}, 'Lectorea'))}</a></p>`;

  /**
   * The names a course is known by besides its own.
   *
   * The build already writes them into the dictionary for the card — «ТФКП»,
   * «теорвер», «линал» — and they are the exact words a student types into a
   * search box, because they are what the subject is called on a timetable
   * rather than in a syllabus. Nothing else on the page carries them, so a
   * search for the name half the country uses reaches a catalogue that has the
   * course under a different one.
   */
  const aliasesOf = (id: string): string[] =>
    (dict[`course.${id}.aliases`] ?? '')
      .split('·')
      .map((name) => name.trim())
      .filter(Boolean);

  function coursePage(course: BuiltCourse): Page {
    const title = courseTitle(course.id);
    const own = dict[`course.${course.id}.desc`] ?? '';
    const deps = course.deps.filter((id) => byId.has(id));
    const next = opens.get(course.id) ?? [];
    const fields = course.domains.filter((id) => domainById.has(id));
    const aliases = aliasesOf(course.id);

    /*
     * The recordings, which are the half of this page nothing outside the app
     * could see. Everything above them is the catalogue's own prose — the same
     * three sentences in the same shape on 225 pages — while this is what the
     * page is actually for and the only part of it that is unlike every other:
     * which universities lecture on the subject, under what titles, at what
     * length. It is also the shape of the question people ask, which is never
     * «математический анализ» on its own but «матанализ МГУ лекции».
     *
     * Named by the university rather than by the channel where one is known:
     * «Teach-in» is a fact about YouTube, «МГУ» is the fact somebody searched
     * for. Six of them, and only the ones that know whose they are — a row that
     * says «— , 12 лекций» is worse than a row that is not there.
     *
     * This page's own language first, and the catalogue's ranking within it.
     * Rating alone put six English playlists on the Russian page of half the
     * mathematics in the catalogue, which is the one language in which naming
     * them buys nothing: the page exists to be found by «ТФКП лекции МГУ», and
     * a reader who wanted the English ones is already on the English page.
     */
    const recordings = recordingsOf(course.id)
      .slice()
      .sort((a, b) => Number(b.lang === lang) - Number(a.lang === lang))
      .map((playlist) => ({
        by: providers[playlist.providerId ?? '']?.title ?? playlist.channelTitle ?? '',
        title: playlist.title ?? '',
        lectures: playlist.videoCount ?? 0,
      }))
      .filter((entry) => entry.by && entry.title)
      .slice(0, RECORDINGS_SHOWN);
    const facts = course.playlistCount
      ? tr('seo.course.facts', {
          recordings: count(course.playlistCount, 'recording'),
          hours: count(hoursOf(course), 'hour'),
        })
      : '';

    const description = clip(
      [own || tr('seo.course.descFallback', { title }), facts,
        deps.length ? tr('seo.course.needs', { list: deps.slice(0, 3).map(courseTitle).join(', ') }) : '',
      ]
        .filter(Boolean)
        .join('. ')
    );

    const jsonLd: unknown[] = [
      {
        '@context': 'https://schema.org',
        '@type': 'Course',
        name: title,
        ...(aliases.length ? { alternateName: aliases } : {}),
        description: own || description,
        url: href(lang, `courses/${course.id}`),
        inLanguage: lang,
        isAccessibleForFree: true,
        // The catalogue, not the university: one entry gathers the recordings of
        // several, and naming any one of them the provider of the course would be
        // a claim about the other twenty.
        provider: { '@type': 'Organization', name: 'Lectorea', url: href(lang) },
        ...(deps.length ? { coursePrerequisites: deps.map(courseTitle) } : {}),
        ...(fields.length ? { about: fields.map((id) => domainTitle(id)) } : {}),
        ...(dict[`ui.stage.${course.stage}`]
          ? { educationalLevel: dict[`ui.stage.${course.stage}`] }
          : {}),
        ...(course.playlistCount
          ? {
              timeRequired: `PT${hoursOf(course)}H`,
              hasCourseInstance: {
                '@type': 'CourseInstance',
                courseMode: 'online',
                courseWorkload: `PT${hoursOf(course)}H`,
              },
              offers: {
                '@type': 'Offer',
                price: 0,
                priceCurrency: 'RUB',
                category: 'Free',
                availability: 'https://schema.org/InStock',
              },
            }
          : {}),
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: tr('seo.breadcrumb.root'), item: href(lang) },
          ...(fields.length
            ? [
                {
                  '@type': 'ListItem',
                  position: 2,
                  name: domainTitle(fields[0]),
                  item: href(lang, `fields/${fields[0]}`),
                },
              ]
            : []),
          {
            '@type': 'ListItem',
            position: fields.length ? 3 : 2,
            name: title,
            item: href(lang, `courses/${course.id}`),
          },
        ],
      },
    ];

    const sections = [
      `      <h1>${escapeHtml(title)}</h1>`,
      own ? `      <p>${escapeHtml(own)}</p>` : '',
      aliases.length
        ? `      <p>${escapeHtml(tr('seo.course.aliases', { list: aliases.join(', ') }))}</p>`
        : '',
      `      <p>${escapeHtml(facts || tr('seo.course.empty'))}</p>`,
      recordings.length
        ? `      <h2>${escapeHtml(tr('seo.heading.recordings'))}</h2>\n      <ul>\n${recordings
            .map(
              (entry) =>
                `        <li>${escapeHtml(entry.by)} — ${escapeHtml(entry.title)}${
                  entry.lectures ? `, ${escapeHtml(count(entry.lectures, 'lecture'))}` : ''
                }</li>`
            )
            .join('\n')}\n      </ul>`
        : '',
      deps.length
        ? `      <h2>${escapeHtml(tr('seo.heading.needs'))}</h2>\n      <ul>\n${linksTo(deps)}\n      </ul>`
        : '',
      next.length
        ? `      <h2>${escapeHtml(tr('seo.heading.opens'))}</h2>\n      <ul>\n${linksTo(next)}\n      </ul>`
        : '',
      fields.length
        ? `      <h2>${escapeHtml(tr('seo.heading.field'))}</h2>\n      <ul>\n${fields
            .map(
              (id) =>
                `        <li><a href="${local(lang, `fields/${id}`)}">${escapeHtml(domainTitle(id))}</a></li>`
            )
            .join('\n')}\n      </ul>`
        : '',
      `      ${mapLink}`,
    ].filter(Boolean);

    return {
      lang,
      file: `${langBase(lang)}courses/${course.id}.html`,
      pathname: `courses/${course.id}`,
      title: tr(
        course.playlistCount ? 'seo.course.title' : 'seo.course.titlePlain',
        { title },
        `${title} | Lectorea`
      ),
      description,
      canonical: true,
      jsonLd,
      body: `      <article>\n${sections.join('\n')}\n      </article>`,
    };
  }

  /**
   * One field of knowledge, as a page rather than as a filter.
   *
   * The catalogue has always been able to show a field — `/courses?domain=math`
   * — but a static host serves one file per *path* and cannot vary on a query
   * string, so all thirty-nine of them were `courses.html`: the same bytes, the
   * same title, the same list of every course in the catalogue, until the
   * bundle had run and rewritten the head. A crawler that indexes what it is
   * served had thirty-nine copies of one page and no reason to keep any of them.
   *
   * A field is also the shape of the question people actually ask — «курсы по
   * математике», «видеолекции по физике» — and the texts to answer it with are
   * already written, in `domain.<id>.title` and `domain.<id>.desc`.
   */
  function fieldPage(domain: BuiltDomain): Page {
    const title = domainTitle(domain.id);
    const own = dict[`domain.${domain.id}.desc`] ?? '';
    const items = courses.filter((course) => course.domains.includes(domain.id));
    // The columns, kept as columns: a field is read left to right, and the list
    // a crawler is given should say the same thing the screen does.
    const ordered = [...items].sort(
      (a, b) => a.level - b.level || courseTitle(a.id).localeCompare(courseTitle(b.id), lang)
    );
    const courseCount = count(items.length, 'course');

    const description = clip(
      [own || tr('seo.field.descFallback', { title }),
        items.length ? tr('seo.field.order', { courses: courseCount }) : '',
      ]
        .filter(Boolean)
        .join('. ')
    );

    return {
      lang,
      file: `${langBase(lang)}fields/${domain.id}.html`,
      pathname: `fields/${domain.id}`,
      title: tr('seo.domain.title', { title }, `${title} | Lectorea`),
      description,
      canonical: true,
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: title,
          description: own || description,
          url: href(lang, `fields/${domain.id}`),
          inLanguage: lang,
          isPartOf: { '@type': 'WebSite', name: 'Lectorea', url: href(lang) },
          // The courses themselves, in the order they are meant to be taken. An
          // `ItemList` is the one way a list page can say what is *on* it rather
          // than only what it is called.
          mainEntity: {
            '@type': 'ItemList',
            numberOfItems: ordered.length,
            itemListElement: ordered.map((course, index) => ({
              '@type': 'ListItem',
              position: index + 1,
              name: courseTitle(course.id),
              url: href(lang, `courses/${course.id}`),
            })),
          },
        },
        {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: tr('seo.breadcrumb.root'), item: href(lang) },
            {
              '@type': 'ListItem',
              position: 2,
              name: title,
              item: href(lang, `fields/${domain.id}`),
            },
          ],
        },
      ],
      body: `      <article>\n${[
        `        <h1>${escapeHtml(title)}</h1>`,
        own ? `        <p>${escapeHtml(own)}</p>` : '',
        items.length
          ? `        <p>${escapeHtml(
              tr('seo.field.facts', {
                courses: courseCount,
                recordings: count(domain.playlistCount, 'recording'),
                hours: count(Math.max(1, Math.round(domain.hours)), 'hour'),
              })
            )}</p>`
          : `        <p>${escapeHtml(tr('seo.field.empty'))}</p>`,
        ordered.length
          ? `        <h2>${escapeHtml(tr('seo.heading.fieldCourses'))}</h2>\n        <ul>\n${linksTo(
              ordered.map((course) => course.id)
            )}\n        </ul>`
          : '',
        `        ${mapLink}`,
      ]
        .filter(Boolean)
        .join('\n')}\n      </article>`,
    };
  }

  function coursesPage(): Page {
    const description = clip(
      empty
        ? tr('seo.courses.descEmpty')
        : tr('seo.courses.desc', {
            courses: count(courses.length, 'course'),
            fields: count(fieldsWithCourses.length, 'field'),
          })
    );

    const body = [
      `      <h1>${escapeHtml(tr('seo.heading.courses', {}, 'Lectorea'))}</h1>`,
      `      <p>${escapeHtml(description)}</p>`,
      ...fieldsWithCourses.map((domain) => {
        const items = courses.filter((course) => course.domains.includes(domain.id));
        return `      <h2><a href="${local(lang, `fields/${domain.id}`)}">${escapeHtml(
          domainTitle(domain.id)
        )}</a></h2>\n      <ul>\n${linksTo(items.map((course) => course.id))}\n      </ul>`;
      }),
    ];

    return {
      lang,
      file: `${langBase(lang)}courses.html`,
      pathname: 'courses',
      title: tr('seo.courses.title', {}, 'Lectorea'),
      description,
      // One file answers `/courses` and every filtered view of it.
      canonical: false,
      /*
       * Kept as a file and out of search, which is not a contradiction.
       *
       * `/courses` with nothing set is the one view of the catalogue that
       * answers no question — 225 cards across nine columns of every subject at
       * once — and the app sends a reader who lands on it back to the map. An
       * address that redirects must not also be offered as a result: that is a
       * search result which does not go where it said. `follow` because the
       * list below is still 225 links, and this file is also what serves the
       * filtered views — `/courses?provider=…` is a slice somebody asked for
       * and stays.
       */
      noindex: true,
      body: `      <article>\n${body.join('\n')}\n      </article>`,
    };
  }

  /**
   * The desk — a file that exists so the address answers with 200 rather than
   * with the 404 page Pages hands every path it has no file for.
   *
   * Out of search, and not because it is thin: everything on it comes out of
   * the reader's own `localStorage`, so to anybody who is not that reader it is
   * an empty invitation, and to the reader it is a page search could never
   * have shown them anyway. `follow`, because the link back to the map on it is
   * a real link.
   */
  function learnPage(): Page {
    const description = clip(tr('seo.learn.desc'));

    return {
      lang,
      file: `${langBase(lang)}learn.html`,
      pathname: 'learn',
      title: tr('seo.learn.title', {}, 'Lectorea'),
      description,
      canonical: false,
      noindex: true,
      body: [
        '      <article>',
        `        <h1>${escapeHtml(tr('seo.learn.title', {}, 'Lectorea'))}</h1>`,
        `        <p>${escapeHtml(description)}</p>`,
        `        ${mapLink}`,
        '      </article>',
      ].join('\n'),
    };
  }

  function homePage(): Page {
    const description = clip(
      empty
        ? tr('seo.home.descEmpty')
        : tr('seo.home.desc', {
            courses: count(courses.length, 'course'),
            fields: count(fieldsWithCourses.length, 'field'),
          })
    );

    return {
      lang,
      file: `${langBase(lang)}index.html`,
      pathname: '',
      title: dict['app.documentTitle'] ?? 'Lectorea',
      description,
      canonical: true,
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: 'Lectorea',
          alternateName: 'Лекторея',
          url: href(lang),
          inLanguage: lang,
          description: dict['app.tagline'] ?? '',
        },
        // Named separately from the site because a course page already claims it
        // as its provider: without this the name is repeated on 225 pages and
        // defined on none of them.
        {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'Lectorea',
          url: rootHref(),
          logo: rootHref('pwa-512.png'),
          description: dict['app.tagline'] ?? '',
          sameAs: [`https://github.com/${repo}`],
        },
      ],
      body: [
        '      <article>',
        `        <h1>${escapeHtml(dict['app.title'] ?? 'Lectorea')}</h1>`,
        `        <p>${escapeHtml(dict['app.tagline'] ?? '')}</p>`,
        `        <h2>${escapeHtml(tr('seo.heading.fields'))}</h2>`,
        '        <ul>',
        fieldsWithCourses
          .map(
            (domain) =>
              `        <li><a href="${local(lang, `fields/${domain.id}`)}">${escapeHtml(
                domainTitle(domain.id)
              )}</a> — ${domain.courseCount}</li>`
          )
          .join('\n'),
        '        </ul>',
        '      </article>',
      ].join('\n'),
    };
  }

  return { coursePage, fieldPage, coursesPage, homePage, learnPage, tr, count, domainTitle };
}

/** Every path the site never claimed — served by Pages with the status to match. */
function notFoundPage(): Page {
  const { tr } = pagesIn(DEFAULT_LANG);
  return {
    lang: DEFAULT_LANG,
    file: '404.html',
    pathname: '',
    title: tr('seo.notFound.title', {}, 'Lectorea'),
    description: tr('seo.notFound.desc'),
    canonical: false,
    noindex: true,
    // Pages answers every unknown path with this one file, whichever language
    // the path was in, so it has no translation to name.
    untranslated: true,
    body: `      <p><a href="${local(DEFAULT_LANG)}">${escapeHtml(tr('seo.link.map', {}, 'Lectorea'))}</a></p>`,
  };
}

/* ──────────────────────  The door, and who opens it  ───────────────────── */

/**
 * The script that decides which language a reader gets, as one string used in
 * two places.
 *
 * It runs on the pages at the root — the ones with no language on them — and
 * also inside the app's own pages, where it is a no-op because their path
 * already names a language. The second copy is what makes `404.html` work: it
 * is one file answering every unknown address, so it is served for
 * `/courses/typo` as readily as for `/ru/courses/typo`, and only the path can
 * say which of those just happened.
 *
 * The order of preference is the honest one. What the reader chose themselves
 * outranks what their browser says about them, and the browser outranks our
 * own default — nobody is sent to a language they have already switched away
 * from. `replace` rather than an assignment, so the back button leaves the site
 * instead of returning to a door that opens the same way again.
 */
function chooseLanguage(): string {
  return [
    '(function () {',
    `  var langs = ${JSON.stringify(LANGS)};`,
    `  var fallback = ${JSON.stringify(DEFAULT_LANG)};`,
    `  var base = ${JSON.stringify(base)};`,
    '  var path = location.pathname;',
    '  var rest = path.indexOf(base) === 0 ? path.slice(base.length) : path;',
    '  while (rest.charAt(0) === "/") rest = rest.slice(1);',
    '  // Already in a language: this is one of the real pages, nothing to do.',
    '  if (langs.indexOf(rest.split("/")[0]) >= 0) return;',
    '  var chosen = null;',
    '  try {',
    '    var stored = JSON.parse(localStorage.getItem("catalog.profile.v1") || "{}");',
    '    if (langs.indexOf(stored && stored.settings && stored.settings.lang) >= 0) {',
    '      chosen = stored.settings.lang;',
    '    }',
    '  } catch (error) {',
    '    // A profile that will not parse is not a reason to refuse to open.',
    '  }',
    '  var wanted = navigator.languages || [navigator.language || ""];',
    '  for (var i = 0; i < wanted.length && !chosen; i += 1) {',
    '    var code = String(wanted[i]).toLowerCase().split("-")[0];',
    '    if (langs.indexOf(code) >= 0) chosen = code;',
    '  }',
    '  location.replace(base + (chosen || fallback) + "/" + rest + location.search + location.hash);',
    '})();',
  ].join('\n');
}

/**
 * A page at an address with no language on it.
 *
 * Every address the catalogue has exists twice over — `/ru/courses/x` and
 * `/en/courses/x` — and this is the third, the one without an opinion. It is
 * what `x-default` names, what every link shared before the languages had
 * addresses still points at, and what somebody typing the site's name lands on.
 *
 * It carries no *body*, because a third copy of prose that already exists in
 * two languages is exactly the duplicate `hreflang` is there to prevent. Its
 * head is another matter, and used to be nearly empty — a title and the
 * language links. That was wrong twice over, because this is the address people
 * actually pass around: `lectorea.org` is what goes into a chat, a post or a
 * README, and a link with no `og:` tags unfolds into a grey rectangle with a
 * hostname in it. Everything a scraper reads is therefore stated here — the
 * description, the card, the canonical address — in the catalogue's own
 * language, which is also the one this page sends an unknown reader to.
 *
 * The card is *this address's* card, not the site's: a door in front of a
 * course names the course's picture, so a shared `/courses/calculus-1` unfolds
 * into the same thing `/ru/courses/calculus-1` does.
 */
function redirectPage(pathname: string, title: string, description: string): string {
  const fallback = href(DEFAULT_LANG, pathname);
  const self = rootHref(pathname);
  const picture = card({ lang: DEFAULT_LANG, pathname, title });
  const alternates = LANGS.map(
    (lang) => `    <link rel="alternate" hreflang="${lang}" href="${href(lang, pathname)}" />`
  ).join('\n');
  const meta = [
    `<meta name="description" content="${escapeHtml(description)}" />`,
    `<meta name="robots" content="${ROBOTS[isMirror ? 'out' : 'in']}" />`,
    // The door is the address `x-default` names, so it names itself: pointing
    // it at the Russian tree would leave `x-default` on a page that disclaims
    // being canonical, and would fold every `?utm_source=…` copy of the root
    // into a language rather than into the address people shared.
    `<link rel="canonical" href="${self}" />`,
    '<link rel="icon" href="/favicon.ico" sizes="32x32" />',
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />',
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />',
    '<meta property="og:type" content="website" />',
    '<meta property="og:site_name" content="Lectorea" />',
    `<meta property="og:title" content="${escapeHtml(title)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:image" content="${picture ? picture.url : rootHref('og.png')}" />`,
    `<meta property="og:image:type" content="${picture ? picture.type : 'image/png'}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    `<meta property="og:image:alt" content="${escapeHtml(picture ? picture.alt : 'Lectorea')}" />`,
    `<meta property="og:url" content="${self}" />`,
    `<meta property="og:locale" content="${LOCALE[DEFAULT_LANG] ?? DEFAULT_LANG}" />`,
    ...LANGS.filter((lang) => lang !== DEFAULT_LANG).map(
      (lang) => `<meta property="og:locale:alternate" content="${LOCALE[lang] ?? lang}" />`
    ),
    '<meta name="twitter:card" content="summary_large_image" />',
  ].map((line) => `    ${line}`);

  return [
    '<!doctype html>',
    `<html lang="${DEFAULT_LANG}">`,
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `    <title>${escapeHtml(title)}</title>`,
    ...meta,
    alternates,
    `    <link rel="alternate" hreflang="x-default" href="${rootHref(pathname)}" />`,
    `    <script>${chooseLanguage()}</script>`,
    `    <noscript><meta http-equiv="refresh" content="0; url=${fallback}" /></noscript>`,
    '  </head>',
    `  <body><a href="${fallback}">Lectorea</a></body>`,
    '</html>',
    '',
  ].join('\n');
}

/** The redirector, at the path itself and at the path with a slash on it. */
function writeRedirect(pathname: string, title: string, description: string): void {
  const html = redirectPage(pathname, title, description);
  const at = (file: string): void => {
    const full = path.join(DIST, file);
    ensureDir(path.dirname(full));
    fs.writeFileSync(full, html, 'utf8');
  };
  at(pathname ? `${pathname}.html` : 'index.html');
  if (pathname) at(`${pathname}/index.html`);
}

/* ─────────────────────────────  Sitemap etc.  ──────────────────────────── */

type Entry = { pathname: string; priority: string };

/**
 * Every address, in every language, each naming its translations.
 *
 * The `xhtml:link` rows are the sitemap half of `hreflang` and say the same
 * thing the pages do. Both halves are wanted: a crawler that starts from the
 * sitemap learns the pair before fetching either, and one that arrives by a
 * link learns it from the page.
 */
function sitemap(entries: Entry[]): string {
  const urls: string[] = [];
  for (const { pathname, priority } of entries) {
    for (const lang of LANGS) {
      const alternates = [
        ...LANGS.map(
          (other) =>
            `    <xhtml:link rel="alternate" hreflang="${other}" href="${href(other, pathname)}" />`
        ),
        `    <xhtml:link rel="alternate" hreflang="x-default" href="${rootHref(pathname)}" />`,
      ].join('\n');
      urls.push(
        `  <url>\n    <loc>${href(lang, pathname)}</loc>\n${alternates}\n` +
          `    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${priority}</priority>\n  </url>`
      );
    }
  }
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' +
    `${urls.join('\n')}\n</urlset>\n`
  );
}

function robots(): string {
  if (isMirror) {
    return [
      '# A fork of the catalogue. The original is at https://lectorea.org — two',
      '# addresses with one catalogue between them only split the search results.',
      'User-agent: *',
      'Disallow: /',
      '',
    ].join('\n');
  }
  return [
    'User-agent: *',
    'Allow: /',
    '',
    '# The catalogue itself. Every screen is drawn from these files, so a',
    '# crawler that runs the bundle has to be able to fetch them — disallowing',
    '# /data/ would leave it rendering an empty page and reporting the site as',
    '# one that has nothing on it.',
    'Allow: /data/',
    '',
    '# Yandex, intersectional: none of these change a word of what is on the',
    '# page, and each one otherwise makes a second address for it.',
    'Clean-param: utm_source&utm_medium&utm_campaign&utm_term&utm_content&yclid&gclid&fbclid&from&ref',
    '',
    `Sitemap: ${rootHref('sitemap.xml')}`,
    '',
  ].join('\n');
}

/**
 * `llms.txt` — the site in one page, for whatever reads it as an answer rather
 * than as a result to rank.
 *
 * Same reasoning as the sitemap and for the same price: the list of URLs is
 * already in hand, and the one thing an assistant cannot get from crawling a
 * single-page app is what the catalogue *is* and which of its addresses are
 * worth reading. Fields rather than courses — 225 course lines would be a
 * database dump, and each field page carries its own courses anyway.
 *
 * One file, in the catalogue's own language, with the other tree named in it:
 * `/llms.txt` is a single address and cannot be two documents.
 */
function llms(): string {
  const { tr, count, domainTitle } = pagesIn(DEFAULT_LANG);
  const dict = dicts.get(DEFAULT_LANG) ?? {};
  const summary = empty
    ? tr('seo.llms.summary')
    : `${count(courses.length, 'course')}, ${count(fieldsWithCourses.length, 'field')}, ${count(
        meta.playlists,
        'playlist'
      )}. ${tr('seo.llms.summary')}`;

  return [
    '# Lectorea',
    '',
    `> ${dict['app.tagline'] ?? ''}`,
    '',
    summary,
    '',
    `## ${tr('seo.llms.pages')}`,
    '',
    `- [${dict['app.title'] ?? 'Lectorea'}](${href(DEFAULT_LANG)}): ${tr('seo.llms.pageMap')}.`,
    ...(courses[0]
      ? [
          `- [${courses[0] ? dict[`course.${courses[0].id}.title`] ?? courses[0].id : ''}](${href(
            DEFAULT_LANG,
            `courses/${courses[0].id}`
          )}): ${tr('seo.llms.pageCourse')}.`,
        ]
      : []),
    `- [sitemap.xml](${rootHref('sitemap.xml')}): ${tr('seo.llms.pageSitemap')}.`,
    ...LANGS.filter((lang) => lang !== DEFAULT_LANG).map(
      (lang) => `- [${lang}](${href(lang)}): ${tr('seo.llms.pageEnglish')}.`
    ),
    '',
    `## ${tr('seo.heading.fields')}`,
    '',
    ...fieldsWithCourses.map(
      (domain) =>
        `- [${domainTitle(domain.id)}](${href(DEFAULT_LANG, `fields/${domain.id}`)}): ${
          dict[`domain.${domain.id}.desc`] ?? domainTitle(domain.id)
        } (${count(domain.courseCount, 'course')}).`
    ),
    '',
    `## ${tr('seo.llms.terms')}`,
    '',
    `- ${tr('seo.llms.markup', { url: `https://github.com/${repo}` })}`,
    `- ${tr('seo.llms.videos')}`,
    '',
  ].join('\n');
}

/* ────────────────────────────────  Main  ───────────────────────────────── */

function main(): void {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('✗ dist/index.html is missing — the bundle has to be built first.');
    process.exit(1);
  }

  write(notFoundPage());
  for (const lang of LANGS) {
    const pages = pagesIn(lang);
    write(pages.homePage());
    write(pages.coursesPage());
    write(pages.learnPage());
    for (const domain of fieldsWithCourses) write(pages.fieldPage(domain));
    for (const course of courses) write(pages.coursePage(course));
  }

  /*
   * And the same addresses without a language on them.
   *
   * Two things depend on these existing. Every link shared before the languages
   * had addresses of their own says `/courses/calculus-1`, and a site that
   * answers those with 404 has thrown away whatever they were worth. And
   * `x-default` has to name something: the page for a reader whose language we
   * cannot guess is the one that guesses.
   */
  const fallbackPages = pagesIn(DEFAULT_LANG);
  const { domainTitle, tr } = fallbackPages;
  const defaults = dicts.get(DEFAULT_LANG) ?? {};
  /*
   * The description each door carries is the one its own page carries, taken
   * from the page rather than written a second time. Two wordings for one
   * address is how the card a link unfolds into comes to disagree with the page
   * behind it, and the copy nobody opens is the one that goes stale.
   */
  writeRedirect(
    '',
    defaults['app.documentTitle'] ?? 'Lectorea',
    fallbackPages.homePage().description
  );
  writeRedirect(
    'courses',
    tr('seo.courses.title', {}, 'Lectorea'),
    fallbackPages.coursesPage().description
  );
  writeRedirect(
    'learn',
    tr('seo.learn.title', {}, 'Lectorea'),
    fallbackPages.learnPage().description
  );
  for (const domain of fieldsWithCourses) {
    writeRedirect(
      `fields/${domain.id}`,
      tr('seo.domain.title', { title: domainTitle(domain.id) }, 'Lectorea'),
      fallbackPages.fieldPage(domain).description
    );
  }
  for (const course of courses) {
    const title = defaults[`course.${course.id}.title`] ?? course.id;
    writeRedirect(
      `courses/${course.id}`,
      tr('seo.course.titlePlain', { title }, 'Lectorea'),
      fallbackPages.coursePage(course).description
    );
  }

  const entries: Entry[] = [
    { pathname: '', priority: '1.0' },
    ...courses.map((course) => ({ pathname: `courses/${course.id}`, priority: '0.8' })),
    ...fieldsWithCourses.map((domain) => ({ pathname: `fields/${domain.id}`, priority: '0.7' })),
  ];

  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap(entries), 'utf8');
  fs.writeFileSync(path.join(DIST, 'robots.txt'), robots(), 'utf8');
  // A fork asks to be left out of search; an index of it for an assistant to
  // read would be the same second copy by another route.
  if (!isMirror) fs.writeFileSync(path.join(DIST, 'llms.txt'), llms(), 'utf8');

  console.log(
    `✓ ${courses.length} course pages and ${fieldsWithCourses.length} field pages in ${LANGS.length} languages, ` +
      `sitemap with ${entries.length * LANGS.length} URLs, robots.txt` +
      (isMirror ? ' (fork — kept out of search)' : ` for ${origin}`)
  );

  // Loud, but not fatal: a checkout with no crawl cache is a supported way to
  // work on the interface, and refusing to build it would be worse than saying
  // what the build is missing. On CI it is the line that explains why a green
  // deploy left search with one page.
  if (empty) {
    console.warn(
      '! the catalogue in this build has no visible courses — not one course page was written, and search is being given a site with nothing in it'
    );
  }
}

main();
