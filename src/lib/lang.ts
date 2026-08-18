import { UI_LANGS, type UiLang } from '@shared/schema';

/**
 * Which language this page is, decided by its address.
 *
 * Russian is the catalogue's own language and lives at the root; English lives
 * under `/en/`. It used to live in `localStorage` instead, which meant one
 * address served both — fine for a reader, useless for everything else. A
 * search engine has one URL and has to be told which language is on it; a link
 * pasted into a chat carries the language of whoever pasted it, not of whoever
 * opens it; and a page in two languages cannot declare either.
 *
 * Read once, at module load, from the path — before React mounts, because the
 * router's `basename` is fixed at mount and every link in the app is written
 * relative to it. That is what keeps the rest of the code free of this: no
 * screen, no `href` builder and no route knows there is a prefix at all.
 */

/** The language the catalogue is written in, and the one served from the root. */
export const DEFAULT_LANG: UiLang = 'ru';

const CODES = UI_LANGS.map((entry) => entry.id);

/** `/lectorea/` in a fork, `/` on the domain — where the app is mounted. */
const SITE_BASE = import.meta.env.BASE_URL;

function readLang(pathname: string): UiLang {
  const rest = pathname.startsWith(SITE_BASE) ? pathname.slice(SITE_BASE.length) : pathname;
  const first = rest.replace(/^\/+/, '').split('/')[0];
  const found = CODES.find((code) => code === first && code !== DEFAULT_LANG);
  return found ?? DEFAULT_LANG;
}

export const UI_LANG: UiLang = readLang(window.location.pathname);

/**
 * What the router is mounted on: the site's base plus the language segment.
 * Every `to=` and `navigate()` in the app is resolved against it, which is why
 * they can all go on saying `/courses/calculus-1`.
 */
export const APP_BASE = UI_LANG === DEFAULT_LANG ? SITE_BASE : `${SITE_BASE}${UI_LANG}/`;

/** Where a path inside the app lives in another language — `''` is the front page. */
export function hrefInLang(path: string, lang: UiLang): string {
  const prefix = lang === DEFAULT_LANG ? SITE_BASE : `${SITE_BASE}${lang}/`;
  return `${prefix}${path.replace(/^\/+/, '')}`;
}
