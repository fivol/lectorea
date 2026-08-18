/**
 * Counting what happens on the site without learning anything about who it
 * happened to.
 *
 * The profile never leaves the browser and that is not changing — this is the
 * other half of the same promise, and the reason it is one module rather than
 * a `gtag()` call in thirty components. **Nothing reaches Google except through
 * `track`**, and `track` scrubs what it is given: a fixed allowlist of query
 * parameters, a cap on every string, and a refusal to forward anything that
 * looks like a person rather than a course. A component that wants to count
 * something cannot accidentally send a search box's contents, because the only
 * door out has the filter built into it.
 *
 * Four things switch it off, and any one of them is enough:
 *
 * - no `VITE_GA4_ID` in the build — a fork, a local checkout, `pnpm dev`;
 * - `Do Not Track` or Global Privacy Control asked for by the browser;
 * - the reader's own switch in **Профиль → Настройки**, which is stored with
 *   the rest of the profile and read before the first event;
 * - a development build, unless `VITE_GA4_DEBUG` says otherwise — otherwise
 *   every afternoon of work would land in the same reports as the readers.
 *
 * What is deliberately *not* here: no user id, no advertising signals, no
 * remarketing, no cross-site anything. `allow_google_signals: false` is what
 * turns off the half of GA4 that infers demographics from a Google account, and
 * it is set before the first event rather than in the console, so a property
 * recreated by hand cannot quietly come back with it on.
 */

import { ANALYTICS_EVENTS, ANALYTICS_PARAMS, BUILT_IN_PARAMS } from '@shared/analytics';
import { APP_BASE } from './lang';

/** The GA4 web stream this build reports to. Empty means the site is silent. */
const MEASUREMENT_ID = import.meta.env.VITE_GA4_ID ?? '';

/** Sending from a dev server is opt-in, and lands in DebugView rather than the reports. */
const DEBUG = import.meta.env.VITE_GA4_DEBUG === '1';

/**
 * Query parameters allowed to travel with a page view.
 *
 * An allowlist rather than a denylist, because the failure modes are not
 * symmetrical: forgetting to add a parameter here costs one dimension in a
 * report, and forgetting to *exclude* one publishes whatever a future feature
 * decides to put in the URL. All four of these are facts about the catalogue —
 * a field of knowledge, a channel, a lecturer's name as YouTube publishes it,
 * a playlist id — and all four are already in the link a reader would share.
 */
const SHAREABLE = new Set(['domain', 'provider', 'lecturer', 'playlist']);

/**
 * A search term that looks like it is about a person rather than a subject.
 *
 * The search box is the one place on the site that takes free text, and free
 * text is where an address, a phone number or somebody's handle gets pasted by
 * accident. The query is dropped whole when any of those match — the event
 * still goes, so the count of searches stays honest, it simply carries no term.
 */
const PERSONAL =
  /[\w.+-]+@[\w-]+\.\w{2,}|(?:\+?\d[\s()\-–]?){7,}|(?:^|\s)@[a-z\d_]{3,}|\d{6,}/i;

/** Longer than this is pasted text, not a question about a subject. */
const TERM_LIMIT = 60;

/** GA4's own ceiling on a parameter value. Anything longer is rejected silently. */
const VALUE_LIMIT = 100;

export type EventParams = Record<string, string | number | boolean | null | undefined>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

let started = false;
/** The reader's switch. Assumed on until the profile has been read. */
let consented = true;

/**
 * Whether the browser itself has asked not to be counted.
 *
 * Read once per call rather than cached: GPC is a property some extensions set
 * after load, and a signal that arrives late is still a signal.
 */
function refused(): boolean {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  return (
    nav.globalPrivacyControl === true ||
    nav.doNotTrack === '1' ||
    nav.msDoNotTrack === '1' ||
    (window as Window & { doNotTrack?: string }).doNotTrack === '1'
  );
}

/** Whether anything at all is allowed to be sent right now. */
function live(): boolean {
  return Boolean(MEASUREMENT_ID) && consented && !refused() && (import.meta.env.PROD || DEBUG);
}

/**
 * Loads gtag and configures it, once.
 *
 * `send_page_view: false` because this is a single-page app: gtag's automatic
 * one fires against whatever URL the bundle booted on, and every navigation
 * after it would go uncounted. `pageView` below is called by the router
 * instead, which is also the only place that knows the title of the view.
 */
export function initAnalytics(consent: boolean): void {
  consented = consent;
  if (started || !live()) return;
  started = true;

  window.dataLayer = window.dataLayer ?? [];
  /*
   * `arguments`, and not the array a rest parameter would hand over.
   *
   * gtag.js walks its own queue and asks each entry what it is; the only answer
   * it acts on is `[object Arguments]`. A plain array is left where it was put,
   * without a warning, and everything downstream of it looks exactly like a
   * working install: `dataLayer` fills up, the container script loads, the
   * commands are visibly in the queue — and not one request to `/g/collect` is
   * ever made, so the property stays empty. This site shipped that version for
   * a day. The canonical snippet is written the way it is for this reason, and
   * copying its shape rather than its intent is what the arrow function was.
   */
  const gtag: (...args: unknown[]) => void = function () {
    window.dataLayer!.push(arguments);
  };
  window.gtag = gtag;

  // Consent Mode, stated rather than defaulted. There is no banner because
  // there is nothing to ask about: everything an advertising cookie would be
  // for is denied here and cannot be granted later by anything on the site.
  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'granted',
  });

  gtag('js', new Date());
  /*
   * Only fields GA4 actually reads.
   *
   * A config key gtag does not recognise is not refused — it is forwarded as an
   * *event parameter*, on every event, for the life of the property. That is
   * how `anonymize_ip` and `transport_type` came to ride along as `ep.` fields
   * in the payload: both are Universal Analytics, and GA4 answers them by
   * doing what they asked for anyway — every IP is anonymised, and the tag
   * already sends with `sendBeacon` when the page is going away. So they cost
   * two useless parameters on every hit and bought nothing. The way to tell,
   * for the next one: look at a `/g/collect` request and see whether the key
   * came out prefixed with `ep.`.
   */
  gtag('config', MEASUREMENT_ID, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    ...(DEBUG ? { debug_mode: true } : {}),
  });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`;
  document.head.append(script);

  watchOutbound();
  watchErrors();
}

/**
 * The reader's switch, from the profile.
 *
 * The press that turns it **off** is not itself counted, and that falls out of
 * the order rather than being special-cased: the store notifies its subscribers
 * synchronously, so consent is already withdrawn by the time the wrapper around
 * the action gets to report it. The cost is that the opt-out rate is not
 * knowable, which is the right way round — a switch that sends one last event
 * on its way out is not a switch anybody should believe.
 *
 * Turning it off has to stop an already-loaded gtag as well as the next one,
 * which is what the `ga-disable-` flag is for — it is read by the script on
 * every send, so the switch takes effect on the press rather than on the next
 * reload. Turning it back on starts the script if the session never loaded it.
 */
export function setAnalyticsConsent(consent: boolean): void {
  consented = consent;
  if (MEASUREMENT_ID) {
    (window as unknown as Record<string, boolean>)[`ga-disable-${MEASUREMENT_ID}`] = !consent;
  }
  if (consent) initAnalytics(true);
}

/**
 * One event, scrubbed.
 *
 * Every call site in the app goes through here, and nothing here trusts its
 * caller: values are coerced to what GA4 accepts, strings are cut to its limit,
 * and anything empty is dropped rather than sent as `undefined`, which would
 * show up in a report as a real value with a strange name.
 */
export function track(name: string, params: EventParams = {}): void {
  const clean: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    if (typeof value === 'boolean') clean[key] = value ? 1 : 0;
    else if (typeof value === 'number') {
      if (Number.isFinite(value)) clean[key] = Math.round(value * 1000) / 1000;
    } else clean[key] = value.slice(0, VALUE_LIMIT);
  }

  if (import.meta.env.DEV) {
    // The registry is the property's own configuration — see `shared/analytics.ts`.
    // An event or a parameter that is not in it will be collected by GA4 and
    // then be missing from every report, which is a failure that looks exactly
    // like success. Saying so here is the only moment anybody is watching.
    if (!ANALYTICS_EVENTS[name]) console.warn(`[analytics] event not in the registry: ${name}`);
    for (const key of Object.keys(clean)) {
      if (!ANALYTICS_PARAMS[key] && !BUILT_IN_PARAMS.has(key)) {
        console.warn(`[analytics] parameter not in the registry: ${name}.${key}`);
      }
    }
    console.debug('[analytics]', name, clean);
  }
  if (!live() || !window.gtag) return;
  window.gtag('event', name, clean);
}

/**
 * A view of the site, named by the route rather than by the URL that reached it.
 *
 * The argument is the **canonical** path the page already computes for its own
 * `<link rel=canonical>` — see `useDocumentMeta`, which is where this is called
 * from. That is deliberate on two counts. It is the semantic page rather than
 * the address bar, so the same course read through three different filters is
 * one row in a report instead of three; and it is built out of catalogue ids by
 * a function that has to be correct for search engines anyway, so there is no
 * second place where a page could come to be named wrongly.
 *
 * The query string is rebuilt from the allowlist above even so. A parameter
 * added to a canonical path next year would otherwise start leaving the browser
 * on the day it is added, without anybody having decided that it should.
 *
 * Resolved against `APP_BASE`, which is the one thing the canonical path leaves
 * out: the language. Every screen builds its links language-free — that is what
 * makes the router's `basename` work — so a page arrived at in either tree
 * named itself `/courses/calculus-1`, and the two languages were one row in
 * every report. They are two pages: two addresses, two sets of prose, two rows
 * in Search Console. The path a report is read by should be the one a crawler
 * and a shared link both name.
 */
export function pageView(canonical: string, title: string): void {
  const [path, search = ''] = canonical.split('?');
  const kept = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(search)) {
    if (SHAREABLE.has(key)) kept.append(key, value);
  }
  const query = kept.toString();
  const address = new URL(`${path}${query ? `?${query}` : ''}`, `${location.origin}${APP_BASE}`);
  track('page_view', {
    page_path: `${address.pathname}${address.search}`,
    page_title: title,
    page_location: address.href,
  });
}

/**
 * A query, as a subject rather than as something somebody typed.
 *
 * Lower-cased and squeezed so that «Теорвер », «теорвер» and «ТЕОРВЕР» are one
 * row in a report rather than three, and returned empty — meaning "count the
 * search, forget the words" — for anything long or personal. The gaps this is
 * really for are short: a course the catalogue does not have is two or three
 * words, never a paragraph.
 */
export function searchTerm(raw: string): string {
  const term = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!term || term.length > TERM_LIMIT || PERSONAL.test(term)) return '';
  return term;
}

/**
 * Actions that report themselves.
 *
 * The alternative was a `track()` beside every `set…` in the store, which rots
 * the first time somebody adds an action and forgets one — and worse, spreads
 * the question "what does this event mean" across thirty call sites. This takes
 * the object of actions the store already builds and wraps the ones named in
 * `table`, running the original first and then asking the table what happened.
 *
 * The table is given the state on **both** sides of the call, which is what
 * makes it possible to describe an event by its outcome rather than by its
 * arguments: `cycleCourseStatus` takes an id and no status, and the status it
 * landed on is only knowable afterwards. Anything not in the table is passed
 * through untouched, so an untracked action costs nothing and a new one is one
 * line rather than an edit to the store's logic.
 */
export type Report<S> = (change: {
  args: unknown[];
  before: S;
  after: S;
}) => [string, EventParams] | null;

export function reporting<T extends Record<string, unknown>, S>(
  actions: T,
  snapshot: () => S,
  table: Partial<Record<keyof T, Report<S>>>
): T {
  const wrapped: Record<string, unknown> = { ...actions };
  for (const [name, report] of Object.entries(table) as Array<[string, Report<S>]>) {
    const original = actions[name];
    if (typeof original !== 'function') continue;
    wrapped[name] = (...args: unknown[]) => {
      const before = snapshot();
      const result = (original as (...rest: unknown[]) => unknown)(...args);
      const event = report({ args, before, after: snapshot() });
      if (event) track(event[0], event[1]);
      return result;
    };
  }
  return wrapped as T;
}

/**
 * How far into a lecture somebody got, at the four points worth knowing.
 *
 * The player reports its position about four times a second and the profile
 * already throttles that to one write in five seconds; neither is an event
 * worth sending. What a report can use is the shape of the drop-off — how many
 * of the people who start a lecture are still there a quarter of the way in —
 * so the milestones are what goes, once each, and a lecture rewatched from the
 * top in the same session does not send them twice.
 */
const MILESTONES = [10, 25, 50, 75, 90];

export function watchProgress(): (
  videoId: string,
  sec: number,
  duration: number,
  about: EventParams
) => void {
  const reached = new Map<string, number>();
  return (videoId, sec, duration, about) => {
    if (!videoId || !duration) return;
    const seen = reached.get(videoId);
    if (seen === undefined) {
      reached.set(videoId, 0);
      track('video_start', { video_id: videoId, video_provider: 'youtube', ...about });
      return;
    }
    const percent = Math.min(100, (sec / duration) * 100);
    for (const mark of MILESTONES) {
      if (percent >= mark && seen < mark) {
        reached.set(videoId, mark);
        track('video_progress', {
          video_id: videoId,
          video_provider: 'youtube',
          video_percent: mark,
          ...about,
        });
      }
    }
  };
}

/**
 * Every link that leaves the site, counted by where it goes and nothing else.
 *
 * One listener on the document rather than a handler per link: the site is a
 * catalogue of links to somebody else's lectures, they are written in a dozen
 * components, and a rule that has to be remembered at each one is a rule that
 * will be missed. Only the host travels — a YouTube URL carries the video in
 * its query string, and the events that are actually about a lecture already
 * name it.
 */
function watchOutbound(): void {
  document.addEventListener(
    'click',
    (event) => {
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      let url: URL;
      try {
        url = new URL(anchor.href, location.href);
      } catch {
        return;
      }
      if (!/^https?:$/.test(url.protocol) || url.origin === location.origin) return;
      track('outbound_click', { link_domain: url.hostname.replace(/^www\./, '') });
    },
    { capture: true }
  );
}

/**
 * Errors, as a count rather than as a debugger.
 *
 * There is no server to log to, so an exception on somebody's phone is
 * otherwise invisible for as long as they do not report it — and a static site
 * that breaks on one browser breaks silently for everybody using it. The
 * message is cut to GA4's limit and the stack never goes: a stack costs a
 * report nothing it can use and is the one field with a chance of carrying a
 * URL somebody was on. Capped per session, because the failure worth knowing
 * about is the first one and the loop after it is the same fact repeated.
 */
const ERROR_LIMIT = 5;

function watchErrors(): void {
  let sent = 0;
  const report = (message: string, source: string): void => {
    if (sent >= ERROR_LIMIT || !message) return;
    sent += 1;
    track('app_error', { message: message.slice(0, VALUE_LIMIT), source });
  };

  window.addEventListener('error', (event) => {
    const file = event.filename ? event.filename.split('/').pop() ?? '' : '';
    report(event.message, `${file}:${event.lineno ?? 0}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    report(reason instanceof Error ? reason.message : String(reason ?? ''), 'promise');
  });
}
