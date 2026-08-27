import { useEffect } from 'react';
import { pageView } from './analytics';
import { APP_BASE } from './lang';

/**
 * The head of the page for the view that is on screen: the tab's name, the
 * description a search result quotes, the canonical link, and — where a screen
 * asks for it — the instruction not to index the thing at all.
 *
 * Every URL is already served from a static file that carries all three —
 * `scripts/prerender.ts` writes one per course — but the app navigates without
 * reloading, so a course opened from the map would otherwise keep the head of
 * whatever page the reader happened to arrive by. A crawler reads the page
 * after the script has run, which is also the only thing that makes
 * `/courses?domain=math` a page in its own right: one file answers every
 * filter, and without this it would answer with the same head every time.
 *
 * @param canonical Path inside the site, no leading slash — `courses/calculus-1`.
 */
export function useDocumentMeta(
  title: string,
  description: string,
  canonical: string,
  options: { index?: boolean } = {}
): void {
  const index = options.index !== false;

  useEffect(() => {
    if (title) document.title = title;

    const meta = ensure<HTMLMetaElement>('meta[name="description"]', () => {
      const element = document.createElement('meta');
      element.name = 'description';
      return element;
    });
    if (description) meta.content = description;

    const link = ensure<HTMLLinkElement>('link[rel="canonical"]', () => {
      const element = document.createElement('link');
      element.rel = 'canonical';
      return element;
    });
    // Against the app's own base, which carries the language segment: the
    // canonical address of an English page is the English one, and naming the
    // Russian page instead would ask search to drop half the site.
    link.href = new URL(canonical, `${location.origin}${APP_BASE}`).href;

    /*
     * A page whose entire content comes out of the reader's own browser has
     * nothing to offer a crawler but an empty invitation, and the prerendered
     * file for it says so already. This is the same statement for the copy the
     * app renders after boot — kept in step with the file rather than left to
     * disagree with it — and it is removed again on the way out, because the
     * next screen is an ordinary page and the tag would follow it there.
     */
    const robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (index) {
      if (robots?.dataset.owner === 'app') robots.remove();
      return;
    }
    if (robots) {
      robots.content = 'noindex, follow';
      return;
    }
    const made = document.createElement('meta');
    made.name = 'robots';
    made.content = 'noindex, follow';
    made.dataset.owner = 'app';
    document.head.append(made);
  }, [title, description, canonical, index]);

  /*
   * And the same fact, counted.
   *
   * A single-page app has to say when a page changed, because nothing reloads
   * — and this is the one function that already knows, for every screen there
   * is and every screen there will be. Wiring it to the router instead would
   * have counted a view before the title had been decided, and wiring it into
   * each screen would have been a line somebody eventually forgets to add.
   *
   * Keyed on the canonical path alone, so a title arriving a beat later — the
   * catalogue finishing its load, the language changing — does not count the
   * same page twice.
   */
  useEffect(() => {
    pageView(canonical, document.title);
  }, [canonical]);
}

/** The tag if the document has one — the pages written at build time do. */
function ensure<E extends HTMLElement>(selector: string, create: () => E): E {
  const found = document.head.querySelector<E>(selector);
  if (found) return found;
  const made = create();
  document.head.append(made);
  return made;
}
