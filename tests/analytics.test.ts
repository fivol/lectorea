import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The one thing about analytics that cannot be checked by reading it.
 *
 * `gtag.js` is handed its commands through an array anybody can push to, and it
 * decides what to act on by asking each entry what it is: the answer it accepts
 * is `[object Arguments]`, and a plain array is left in the queue without a
 * word. Everything downstream of that mistake looks like a working install —
 * the queue fills, the container loads, the commands are visibly in it — and
 * the property stays empty. This site shipped that version for a day, and the
 * only way it was ever going to be caught is by looking at the shape of what
 * goes into the queue, which is what this does.
 *
 * The environment is `node`, so the browser this module expects is built here
 * by hand. It needs very little: somewhere to push, a `document` to append a
 * script to, and a `navigator` with no objection to being counted.
 */

type Fake = {
  dataLayer: unknown[];
  appended: string[];
};

function browser(): Fake {
  const state: Fake = { dataLayer: [], appended: [] };
  const location = {
    origin: 'https://lectorea.org',
    pathname: '/ru/',
    search: '',
    hash: '',
    replace: () => {},
  };
  const window = {
    location,
    dataLayer: state.dataLayer,
    addEventListener: () => {},
    matchMedia: () => ({ matches: false }),
  };
  const document = {
    createElement: () => ({ async: false, src: '' }),
    head: {
      append: (element: { src?: string }) => {
        if (element.src) state.appended.push(element.src);
      },
    },
    addEventListener: () => {},
  };
  define({ window, document, location, navigator: {} });
  return state;
}

/**
 * `navigator` is a getter on the global object in Node, so it is defined rather
 * than assigned — and the same way for all of them, so there is one rule here
 * instead of one rule and an exception.
 */
function define(globals: Record<string, unknown>): void {
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
}

/** Fresh module every time: the measurement id is read once, at import. */
async function load() {
  vi.stubEnv('VITE_GA4_ID', 'G-TESTONLY');
  // The build is not a production one here, and without this the module is
  // silent by design — which would make every assertion below pass on nothing.
  vi.stubEnv('VITE_GA4_DEBUG', '1');
  vi.resetModules();
  return import('../src/lib/analytics');
}

describe('the gtag queue', () => {
  let fake: Fake;

  beforeEach(() => {
    fake = browser();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('pushes arguments objects, which is the only thing gtag.js reads', async () => {
    const { initAnalytics } = await load();
    initAnalytics(true);

    expect(fake.dataLayer.length).toBeGreaterThan(0);
    for (const entry of fake.dataLayer) {
      expect(Object.prototype.toString.call(entry)).toBe('[object Arguments]');
    }
  });

  it('configures the stream before the script that reads the queue is loaded', async () => {
    const { initAnalytics } = await load();
    initAnalytics(true);

    const commands = fake.dataLayer.map((entry) => Array.from(entry as ArrayLike<unknown>));
    expect(commands.map((command) => command[0])).toEqual(['consent', 'js', 'config']);
    expect(commands.at(-1)?.[1]).toBe('G-TESTONLY');
    expect(fake.appended).toEqual([
      'https://www.googletagmanager.com/gtag/js?id=G-TESTONLY',
    ]);
  });

  it('names a page by the address it is actually at, language and all', async () => {
    const { initAnalytics, pageView } = await load();
    initAnalytics(true);
    pageView('courses/calculus-1?domain=math&secret=1', 'Calculus');

    const event = Array.from(fake.dataLayer.at(-1) as ArrayLike<unknown>);
    expect(event[0]).toBe('event');
    expect(event[1]).toBe('page_view');
    expect(event[2]).toMatchObject({
      page_path: '/ru/courses/calculus-1?domain=math',
      page_location: 'https://lectorea.org/ru/courses/calculus-1?domain=math',
    });
  });

  it('says nothing at all when the browser asks not to be counted', async () => {
    define({ navigator: { globalPrivacyControl: true } });
    const { initAnalytics } = await load();
    initAnalytics(true);

    expect(fake.dataLayer).toEqual([]);
    expect(fake.appended).toEqual([]);
  });
});
