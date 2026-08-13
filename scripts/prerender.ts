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
    // tag to go on, and a path relative to the site means nothing to it.
    `<meta property="og:image" content="${href('pwa-512.png')}" />`,
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

function write(page: Page): void {
  const file = path.join(DIST, page.file);
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, render(page), 'utf8');
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
      ? `${course.playlistCount} записей лекций, около ${hoursOf(course)} ч`
      : '',
    deps.length ? `до этого: ${list(deps)}` : '',
  ].filter(Boolean);

  const description = clip(
    own
      ? `${own}. ${facts.join('. ')}`
      : `Курс «${title}» в каталоге Lectorea: видеозаписи лекций и порядок изучения. ${facts.join('. ')}`
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
                item: href(`courses?domain=${fields[0]}`),
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
              `        <li><a href="${local(`courses?domain=${id}`)}">${escapeHtml(domainTitle(id))}</a></li>`
          )
          .join('\n')}\n      </ul>`
      : '',
    `      <p><a href="${local()}">Карта знаний</a> · <a href="${local('courses')}">Все курсы</a></p>`,
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
          `      <h2><a href="${local(`courses?domain=${group.domain.id}`)}">${escapeHtml(
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
    // One file answers `/courses` and every `?domain=…` view of it.
    canonical: false,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'CollectionPage',
        name: 'Курсы Lectorea',
        url: href('courses'),
        inLanguage: env.defaultLang,
        isPartOf: { '@type': 'WebSite', name: 'Lectorea', url: href() },
      },
    ],
    body: `      <article>\n${body.join('\n')}\n      </article>`,
  };
}

function homePage(): Page {
  const fields = domains
    .filter((domain) => domain.courseCount)
    .map(
      (domain) =>
        `        <li><a href="${local(`courses?domain=${domain.id}`)}">${escapeHtml(
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
    ],
    body: [
      '      <article>',
      `        <h1>${escapeHtml(dict['app.title'] ?? 'Lectorea')}</h1>`,
      `        <p>${escapeHtml(dict['app.tagline'] ?? '')}</p>`,
      '        <h2>Области знаний</h2>',
      '        <ul>',
      fields,
      '        </ul>',
      `        <p><a href="${local('courses')}">Все курсы</a></p>`,
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
    body: `      <p><a href="${local()}">Карта знаний</a> · <a href="${local('courses')}">Все курсы</a></p>`,
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
  return ['User-agent: *', 'Allow: /', '', `Sitemap: ${href('sitemap.xml')}`, ''].join('\n');
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
  for (const course of courses) write(coursePage(course));

  const entries: Entry[] = [
    { loc: href(), priority: '1.0' },
    { loc: href('courses'), priority: '0.9' },
    ...courses.map((course) => ({ loc: href(`courses/${course.id}`), priority: '0.8' })),
    ...domains
      .filter((domain) => domain.courseCount)
      .map((domain) => ({ loc: href(`courses?domain=${domain.id}`), priority: '0.7' })),
  ];

  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap(entries), 'utf8');
  fs.writeFileSync(path.join(DIST, 'robots.txt'), robots(), 'utf8');

  console.log(
    `✓ ${courses.length} course pages, sitemap with ${entries.length} URLs, robots.txt` +
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
