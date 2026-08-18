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

/**
 * The language to fall back on when the address does not say and the reader's
 * browser asks for one the catalogue does not have.
 */
export const DEFAULT_LANG: UiLang = 'ru';

const CODES = UI_LANGS.map((entry) => entry.id);

/** `/lectorea/` in a fork, `/` on the domain — where the app is mounted. */
const SITE_BASE = import.meta.env.BASE_URL;

/**
 * Every page of the app is under a language — `/ru/…` or `/en/…` — so the first
 * segment is the answer. A path without one is not a page of the app at all: it
 * is the redirector at the root, or `404.html` being served for an address
 * nobody claimed, and both send the reader somewhere with a language on it
 * before this ever matters. The fallback is for that moment in between.
 */
function readLang(pathname: string): UiLang {
  const rest = pathname.startsWith(SITE_BASE) ? pathname.slice(SITE_BASE.length) : pathname;
  const first = rest.replace(/^\/+/, '').split('/')[0];
  return CODES.find((code) => code === first) ?? DEFAULT_LANG;
}

export const UI_LANG: UiLang = readLang(window.location.pathname);

/*
 * An address with no language on it, put right before React sees it.
 *
 * In a build this never fires: `scripts/prerender.ts` writes a page at the
 * root of every address whose whole job is to choose a language, and it runs
 * from the `<head>` long before this bundle has finished downloading. The one
 * place there is no such page is `pnpm dev`, where nothing is prerendered and
 * `http://localhost:5173/` would otherwise mount the router on `/ru/` while the
 * browser is at `/` — a blank screen and no error, which is the worst way to
 * find out.
 *
 * So this is the development safety net rather than the real door, and it is
 * deliberately the dumber of the two: no browser sniffing, just the fallback
 * language and the path kept intact. The preference order that matters lives
 * in one place, and it is the one a reader actually arrives through.
 */
if (readLang(window.location.pathname) === DEFAULT_LANG) {
  const { pathname, search, hash } = window.location;
  const rest = pathname.startsWith(SITE_BASE) ? pathname.slice(SITE_BASE.length) : pathname;
  if (!CODES.some((code) => rest.replace(/^\/+/, '').split('/')[0] === code)) {
    window.location.replace(`${SITE_BASE}${DEFAULT_LANG}/${rest.replace(/^\/+/, '')}${search}${hash}`);
  }
}

/**
 * What the router is mounted on: the site's base plus the language segment.
 * Every `to=` and `navigate()` in the app is resolved against it, which is why
 * they can all go on saying `/courses/calculus-1`.
 */
export const APP_BASE = `${SITE_BASE}${UI_LANG}/`;

/** Where a path inside the app lives in another language — `''` is the front page. */
export function hrefInLang(path: string, lang: UiLang): string {
  return `${SITE_BASE}${lang}/${path.replace(/^\/+/, '')}`;
}
