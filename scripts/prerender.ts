import fs from 'node:fs';
import path from 'node:path';
import type { BuiltCourse, BuiltDomain, Meta } from '../shared/schema.js';
import { ensureDir, env, ROOT } from './lib/config.js';

/**
 * A static page per course, made after the bundle.
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
 * runs no JavaScript is left with. The sitemap and robots.txt come from the
 * same pass, since the list of URLs is already in hand.
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

/** An absolute URL for a path inside the site: `href('courses')`. */
function href(pathname = ''): string {
  return `${origin}${base}${pathname}`;
}

/** The same, as a link the page itself can carry — no host, so a fork works. */
function local(pathname = ''): string {
  return `${base}${pathname}`;
}

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
const dict = read<Record<string, string>>(`i18n/${env.defaultLang}.json`);

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

const courseTitle = (id: string): string => dict[`course.${id}.title`] ?? id;
const domainTitle = (id: string): string => dict[`domain.${id}.title`] ?? id;
const lastmod = meta.builtAt.slice(0, 10);

/**
 * A string from the dictionary, filled in — the same keys the app names a page
 * with once it has booted. Two wordings for one page would be two answers to
 * "what is this", and the one a crawler keeps is not the one it read first.
 */
function tr(key: string, params: Record<string, string> = {}, fallback = ''): string {
  const template = dict[key];
  if (!template) return fallback;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => params[name] ?? whole);
}

/* ──────────────────────────────  Rendering  ────────────────────────────── */

type Page = {
  /** Where the file goes inside dist — and, minus `.html`, what Pages serves it at. */
  file: string;
  /** The path it is reached by, empty for the front page. */
  pathname: string;
  title: string;
  description: string;
  /**
   * Whether the page may name itself the canonical one. A file that serves many
   * views — `/courses` also answers `?domain=math` — must not, or every field
   * of knowledge is declared a duplicate of the bare column screen before the
   * app has had a chance to say otherwise. Those set it from the browser.
   */
  canonical: boolean;
  jsonLd?: unknown[];
  /** What a crawler that runs no JavaScript is given in place of the app. */
  body?: string;
  noindex?: boolean;
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

function render(page: Page): string {
  const url = href(page.pathname);
  const head = [
    `<title>${escapeHtml(page.title)}</title>`,
    `<meta name="description" content="${escapeHtml(page.description)}" />`,
    `<meta property="og:title" content="${escapeHtml(page.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(page.description)}" />`,
    // Absolute by requirement: a card is fetched by a scraper that has only the
    // tag to go on, and a path relative to the site means nothing to it. The
    // size and the alt text stay in the template — one picture, every page.
    `<meta property="og:image" content="${href('og.png')}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:locale" content="${env.defaultLang === 'ru' ? 'ru_RU' : 'en_US'}" />`,
  ];
  if (page.canonical) head.push(`<link rel="canonical" href="${url}" />`);
  if (page.noindex || isMirror) head.push('<meta name="robots" content="noindex, follow" />');
  for (const entry of page.jsonLd ?? []) head.push(jsonLdScript(entry));

  const html = template
    // Dropped rather than rewritten in place: the template writes some of these
    // across several lines and some on one, and a page that quietly kept the
    // catalogue's description because a regex missed it would look right.
    .replace(/[ \t]*<title>[\s\S]*?<\/title>\n/, '')
    .replace(/[ \t]*<meta\s+name="description"[\s\S]*?\/>\n/, '')
    .replace(/[ \t]*<meta\s+property="og:title"[\s\S]*?\/>\n/, '')
    .replace(/[ \t]*<meta\s+property="og:description"[\s\S]*?\/>\n/, '')
    .replace(/[ \t]*<meta\s+property="og:image"[\s\S]*?\/>\n/, '')
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
  const file = path.join(DIST, page.pathname, 'index.html');
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

/* ────────────────────────────────  Text  ───────────────────────────────── */

/**
 * A build can legitimately have no catalogue in it — a checkout with no
 * `cache.db`, documented as enough to work on the interface — and it can have
 * none by accident, as when CI restores a crawl cache that a failed run left
 * empty. Either way the prose must not count out loud: «0 курсов в 39 областях
 * знаний» is a sentence nobody should be able to publish by not noticing.
 */
const empty = courses.length === 0;

/** «180 курсов», «22 курса», «1 курс» — the count and its noun, in agreement. */
function plural(n: number, one: string, few: string, many: string): string {
  const ten = n % 10;
  const hundred = n % 100;
  if (ten === 1 && hundred !== 11) return `${n} ${one}`;
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

/** «в 39 областях знаний» — the same, for the one other noun that is counted. */
function inFields(n: number): string {
  return `${n} ${n === 1 ? 'области' : 'областях'} знаний`;
}

/** Search results cut a description at about 160 characters — so cut it here. */
function clip(text: string, limit = 160): string {
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).replace(/[,.;:—-]$/, '')}…`;
}

function list(ids: string[], limit = 3): string {
  const names = ids.slice(0, limit).map(courseTitle);
  return names.join(', ');
}

function hoursOf(course: BuiltCourse): number {
  return Math.max(1, Math.round(course.hours));
}

function linksTo(ids: string[]): string {
  return ids
    .map((id) => `        <li><a href="${local(`courses/${id}`)}">${escapeHtml(courseTitle(id))}</a></li>`)
    .join('\n');
}

/* ──────────────────────────────  The pages  ────────────────────────────── */

function coursePage(course: BuiltCourse): Page {
  const title = courseTitle(course.id);
  const own = dict[`course.${course.id}.desc`] ?? '';
  const deps = course.deps.filter((id) => byId.has(id));
  const next = opens.get(course.id) ?? [];
  const fields = course.domains.filter((id) => domainById.has(id));

  const facts = [
    course.playlistCount
      ? `${plural(course.playlistCount, 'запись', 'записи', 'записей')} лекций, около ${hoursOf(course)} ч`
      : '',
    deps.length ? `Что нужно знать заранее: ${list(deps)}` : '',
  ].filter(Boolean);

  const description = clip(
    [
      own || `Курс «${title}» в каталоге Lectorea: видеозаписи лекций и порядок изучения`,
      ...facts,
    ].join('. ')
  );

  const jsonLd: unknown[] = [
    {
      '@context': 'https://schema.org',
      '@type': 'Course',
      name: title,
      description: own || description,
      url: href(`courses/${course.id}`),
      inLanguage: env.defaultLang,
      isAccessibleForFree: true,
      // The catalogue, not the university: one entry gathers the recordings of
      // several, and naming any one of them the provider of the course would be
      // a claim about the other twenty.
      provider: { '@type': 'Organization', name: 'Lectorea', url: href() },
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
        { '@type': 'ListItem', position: 1, name: 'Каталог', item: href() },
        ...(fields.length
          ? [
              {
                '@type': 'ListItem',
                position: 2,
                name: domainTitle(fields[0]),
                item: href(`fields/${fields[0]}`),
              },
            ]
          : []),
        {
          '@type': 'ListItem',
          position: fields.length ? 3 : 2,
          name: title,
          item: href(`courses/${course.id}`),
        },
      ],
    },
  ];

  const sections = [
    `      <h1>${escapeHtml(title)}</h1>`,
    own ? `      <p>${escapeHtml(own)}</p>` : '',
    course.playlistCount
      ? `      <p>Записей лекций: ${course.playlistCount}. Примерная длительность курса: ${hoursOf(course)} ч.</p>`
      : '      <p>Записей лекций пока нет — их можно предложить.</p>',
    deps.length
      ? `      <h2>Что нужно знать заранее</h2>\n      <ul>\n${linksTo(deps)}\n      </ul>`
      : '',
    next.length
      ? `      <h2>Что открывает дальше</h2>\n      <ul>\n${linksTo(next)}\n      </ul>`
      : '',
    fields.length
      ? `      <h2>Область знаний</h2>\n      <ul>\n${fields
          .map(
            (id) =>
              `        <li><a href="${local(`fields/${id}`)}">${escapeHtml(domainTitle(id))}</a></li>`
          )
          .join('\n')}\n      </ul>`
      : '',
    `      <p><a href="${local()}">Карта знаний</a></p>`,
  ].filter(Boolean);

  return {
    file: `courses/${course.id}.html`,
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
 * same title, the same list of every course in the catalogue, until the bundle
 * had run and rewritten the head. A crawler that indexes what it is served had
 * thirty-nine copies of one page and no reason to keep any of them.
 *
 * A field is also the shape of the question people actually ask — «курсы по
 * математике», «видеолекции по физике» — and the texts to answer it with are
 * already written, in `domain.<id>.title` and `domain.<id>.desc`.
 */
function fieldPage(domain: BuiltDomain): Page {
  const title = domainTitle(domain.id);
  const own = dict[`domain.${domain.id}.desc`] ?? '';
  const items = courses.filter((course) => course.domains.includes(domain.id));
  // The columns, kept as columns: a field is read left to right, and the list a
  // crawler is given should say the same thing the screen does.
  const ordered = [...items].sort((a, b) => a.level - b.level || courseTitle(a.id).localeCompare(courseTitle(b.id), 'ru'));

  const description = clip(
    [
      own || `Курсы и видеолекции по теме «${title}» в каталоге Lectorea`,
      items.length ? `${plural(items.length, 'курс', 'курса', 'курсов')} в порядке изучения` : '',
    ]
      .filter(Boolean)
      .join('. ')
  );

  return {
    file: `fields/${domain.id}.html`,
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
        url: href(`fields/${domain.id}`),
        inLanguage: env.defaultLang,
        isPartOf: { '@type': 'WebSite', name: 'Lectorea', url: href() },
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
            url: href(`courses/${course.id}`),
          })),
        },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Каталог', item: href() },
          { '@type': 'ListItem', position: 2, name: title, item: href(`fields/${domain.id}`) },
        ],
      },
    ],
    body: `      <article>\n${[
      `        <h1>${escapeHtml(title)}</h1>`,
      own ? `        <p>${escapeHtml(own)}</p>` : '',
      items.length
        ? `        <p>${plural(items.length, 'курс', 'курса', 'курсов')}, ${plural(domain.playlistCount, 'запись', 'записи', 'записей')} лекций, около ${Math.max(1, Math.round(domain.hours))} ч.</p>`
        : '        <p>Курсы этой области ещё готовятся.</p>',
      ordered.length
        ? `        <h2>Курсы в порядке изучения</h2>\n        <ul>\n${linksTo(ordered.map((course) => course.id))}\n        </ul>`
        : '',
      `        <p><a href="${local()}">Карта знаний</a></p>`,
    ]
      .filter(Boolean)
      .join('\n')}\n      </article>`,
  };
}

function coursesPage(): Page {
  const byDomain = domains.map((domain) => ({
    domain,
    items: courses.filter((course) => course.domains.includes(domain.id)),
  }));

  const body = [
    '      <h1>Все курсы каталога</h1>',
    `      <p>${
      empty ? 'Курсы' : `${plural(courses.length, 'курс', 'курса', 'курсов')} в ${inFields(domains.length)}`
    }, выстроенные в порядке изучения: у каждого видно, что нужно знать до него и что он открывает после.</p>`,
    ...byDomain
      .filter((group) => group.items.length)
      .map(
        (group) =>
          `      <h2><a href="${local(`fields/${group.domain.id}`)}">${escapeHtml(
            domainTitle(group.domain.id)
          )}</a></h2>\n      <ul>\n${linksTo(group.items.map((course) => course.id))}\n      </ul>`
      ),
  ];

  return {
    file: 'courses.html',
    pathname: 'courses',
    title: tr('seo.courses.title', {}, 'Lectorea'),
    description: clip(
      empty
        ? 'Университетские курсы по областям знаний: видеозаписи лекций, порядок изучения и связи между курсами.'
        : `${plural(courses.length, 'университетский курс', 'университетских курса', 'университетских курсов')} в ${inFields(domains.length)}: видеозаписи лекций, порядок изучения и связи между курсами.`
    ),
    // One file answers `/courses` and every filtered view of it.
    canonical: false,
    /*
     * Kept as a file and out of search, which is not a contradiction.
     *
     * `/courses` with nothing set is the one view of the catalogue that answers
     * no question — 225 cards across nine columns of every subject at once —
     * and the app sends a reader who lands on it back to the map. An address
     * that redirects must not also be offered as a result: that is a search
     * result which does not go where it said. `follow` because the list below
     * is still 225 links, and this file is also what serves the filtered views
     * — `/courses?provider=…` is a slice somebody asked for and stays.
     */
    noindex: true,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Курсы Lectorea',
        url: href('courses'),
        inLanguage: env.defaultLang,
        isPartOf: { '@type': 'WebSite', name: 'Lectorea', url: href() },
        // The fields rather than the courses: 225 entries would be the sitemap
        // written twice, and each field page lists its own.
        mainEntity: {
          '@type': 'ItemList',
          numberOfItems: fieldsWithCourses.length,
          itemListElement: fieldsWithCourses.map((domain, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: domainTitle(domain.id),
            url: href(`fields/${domain.id}`),
          })),
        },
      },
    ],
    body: `      <article>\n${body.join('\n')}\n      </article>`,
  };
}

function homePage(): Page {
  const fields = fieldsWithCourses
    .map(
      (domain) =>
        `        <li><a href="${local(`fields/${domain.id}`)}">${escapeHtml(
          domainTitle(domain.id)
        )}</a> — ${domain.courseCount}</li>`
    )
    .join('\n');

  return {
    file: 'index.html',
    pathname: '',
    title: dict['app.documentTitle'] ?? 'Lectorea',
    description: clip(
      empty
        ? 'Бесплатный каталог университетских видеолекций в порядке изучения: что нужно знать до курса и что он открывает дальше.'
        : `Бесплатный каталог университетских видеолекций: ${plural(courses.length, 'курс', 'курса', 'курсов')} в ${inFields(domains.length)} в порядке изучения — что нужно знать до курса и что он открывает.`
    ),
    canonical: true,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: 'Lectorea',
        alternateName: 'Лекторея',
        url: href(),
        inLanguage: env.defaultLang,
        description: dict['app.tagline'] ?? '',
      },
      // Named separately from the site because a course page already claims it
      // as its provider: without this the name is repeated on 225 pages and
      // defined on none of them.
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: 'Lectorea',
        url: href(),
        logo: href('pwa-512.png'),
        description: dict['app.tagline'] ?? '',
        sameAs: [`https://github.com/${repo}`],
      },
    ],
    body: [
      '      <article>',
      `        <h1>${escapeHtml(dict['app.title'] ?? 'Lectorea')}</h1>`,
      `        <p>${escapeHtml(dict['app.tagline'] ?? '')}</p>`,
      '        <h2>Области знаний</h2>',
      '        <ul>',
      fields,
      '        </ul>',
      '      </article>',
    ].join('\n'),
  };
}

/** Every path the site never claimed — served by Pages with the status to match. */
function notFoundPage(): Page {
  return {
    file: '404.html',
    pathname: '',
    title: 'Страница не найдена | Lectorea',
    description: 'Такой страницы в каталоге нет — откройте карту знаний или список курсов.',
    canonical: false,
    noindex: true,
    body: `      <p><a href="${local()}">Карта знаний</a></p>`,
  };
}

/* ─────────────────────────────  Sitemap etc.  ──────────────────────────── */

type Entry = { loc: string; priority: string };

function sitemap(entries: Entry[]): string {
  const urls = entries
    .map(
      ({ loc, priority }) =>
        `  <url>\n    <loc>${loc.replace(/&/g, '&amp;')}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${priority}</priority>\n  </url>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
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
    `Sitemap: ${href('sitemap.xml')}`,
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
 */
function llms(): string {
  const lines = [
    '# Lectorea',
    '',
    `> ${dict['app.tagline'] ?? 'Каталог университетских видеолекций в порядке изучения.'}`,
    '',
    empty
      ? 'Бесплатный каталог записей университетских лекций с YouTube, выстроенных по зависимостям: у каждого курса видно, что нужно знать до него и что он открывает после. Без регистрации и рекламы.'
      : `Бесплатный каталог записей университетских лекций с YouTube: ${plural(courses.length, 'курс', 'курса', 'курсов')} в ${inFields(fieldsWithCourses.length)}, ${plural(meta.playlists, 'плейлист', 'плейлиста', 'плейлистов')} лекций. Курсы связаны зависимостями: у каждого видно, что нужно знать до него и что он открывает после. Без регистрации и рекламы.`,
    '',
    '## Основные страницы',
    '',
    `- [Карта знаний](${href()}): области знаний как материки, вход в каталог.`,
    ...(courses[0]
      ? [
          `- [Страница курса](${href(`courses/${courses[0].id}`)}): описание, что нужно знать заранее, что курс открывает дальше, записи лекций. Адрес любого курса — \`/courses/<id>\`.`,
        ]
      : []),
    `- [Sitemap](${href('sitemap.xml')}): все адреса каталога.`,
    '',
    '## Области знаний',
    '',
    ...fieldsWithCourses.map(
      (domain) =>
        `- [${domainTitle(domain.id)}](${href(`fields/${domain.id}`)}): ${
          dict[`domain.${domain.id}.desc`] ?? `курсы по теме «${domainTitle(domain.id)}»`
        } (${plural(domain.courseCount, 'курс', 'курса', 'курсов')}).`
    ),
    '',
    '## Условия',
    '',
    '- Разметка курсов и зависимостей открыта: https://github.com/' + repo,
    '- Сами лекции размещены на YouTube и принадлежат своим авторам; каталог только ссылается на них.',
    '',
  ];
  return lines.join('\n');
}

/* ────────────────────────────────  Main  ───────────────────────────────── */

function main(): void {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('✗ dist/index.html is missing — the bundle has to be built first.');
    process.exit(1);
  }

  write(homePage());
  write(notFoundPage());
  write(coursesPage());
  for (const domain of fieldsWithCourses) write(fieldPage(domain));
  for (const course of courses) write(coursePage(course));

  const entries: Entry[] = [
    { loc: href(), priority: '1.0' },
    ...courses.map((course) => ({ loc: href(`courses/${course.id}`), priority: '0.8' })),
    ...fieldsWithCourses.map((domain) => ({ loc: href(`fields/${domain.id}`), priority: '0.7' })),
  ];

  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap(entries), 'utf8');
  fs.writeFileSync(path.join(DIST, 'robots.txt'), robots(), 'utf8');
  // A fork asks to be left out of search; an index of it for an assistant to
  // read would be the same second copy by another route.
  if (!isMirror) fs.writeFileSync(path.join(DIST, 'llms.txt'), llms(), 'utf8');

  console.log(
    `✓ ${courses.length} course pages, ${fieldsWithCourses.length} field pages, sitemap with ${entries.length} URLs, robots.txt` +
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
