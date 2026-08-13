import { useEffect } from 'react';

/**
 * The head of the page for the view that is on screen: the tab's name, the
 * description a search result quotes, and the canonical link.
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
export function useDocumentMeta(title: string, description: string, canonical: string): void {
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
    link.href = new URL(canonical, `${location.origin}${import.meta.env.BASE_URL}`).href;
  }, [title, description, canonical]);
}

/** The tag if the document has one — the pages written at build time do. */
function ensure<E extends HTMLElement>(selector: string, create: () => E): E {
  const found = document.head.querySelector<E>(selector);
  if (found) return found;
  const made = create();
  document.head.append(made);
  return made;
}
