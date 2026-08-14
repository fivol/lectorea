import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = (): void => setMatches(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** Breakpoints: <768 mobile, 768–1200 tablet, >1200 desktop. */
export const useIsMobile = (): boolean => useMediaQuery('(max-width: 767px)');
export const useIsDesktop = (): boolean => useMediaQuery('(min-width: 1201px)');

/**
 * A window taller than it is wide.
 *
 * The map's own question, and not the same one as `useIsMobile`: there are two
 * drawings of the world, one ranged and one stacked, and which of them fits is
 * decided by the shape of the window rather than by the size of the device. A
 * tablet held upright wants the stacked one; a phone turned on its side wants
 * the ranged one, and gets it.
 */
export const useIsPortrait = (): boolean => useMediaQuery('(orientation: portrait)');

export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/** Closes on Escape. Returns nothing — the caller owns the state. */
export function useEscape(enabled: boolean, onEscape: () => void): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onEscape();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, onEscape]);
}

/** Traps Tab inside a container and restores focus to whatever opened it. */
export function useFocusTrap(active: boolean) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    const container = ref.current;
    container?.focus();

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || !container) return;
      const focusable = container.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [active]);

  return ref;
}

/** Locks body scroll while an overlay is open. */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}

/**
 * Whether an element is actually cutting its text off.
 *
 * A tooltip repeating a title that is fully visible is noise, so the ones that
 * exist to rescue a clipped name have to know whether anything was clipped.
 * Re-measured on resize and whenever `deps` change, because both the text and
 * the width it has to fit in move — the panel is draggable.
 */
export function useIsTruncated<T extends HTMLElement>(
  deps: unknown[] = []
): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = (): void =>
      setTruncated(node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return [ref, truncated];
}

/**
 * Chrome that measures itself, published as a length on the root element.
 *
 * Anything that has to line up with a piece of chrome — stand clear of it, or
 * sit exactly under it — needs to know how big that chrome is, and it is never a
 * number anybody can write down: the header's controls are as wide as «Карта
 * Список Профиль» happen to be, and the same row in English is narrower. Written
 * down as a constant it is right in one language and wrong in the other, and
 * wrong again the day a word changes.
 *
 * So the chrome measures itself and publishes it as `--{name}` on `:root`, and
 * everything placed against it reads that instead of guessing. `FloatingFoot`
 * does the same for the band at the bottom of the window, with a measurement of
 * its own shape — this is the plain version, for a box that is worth its own
 * width or height.
 */
export function useMeasuredVar<T extends HTMLElement>(
  name: string,
  axis: 'width' | 'height' = 'width'
): React.RefObject<T> {
  const ref = useRef<T>(null);

  /*
   * Before the paint, not after: whatever is sized off this variable is on
   * screen in the same frame, and a measurement taken afterwards would show it
   * at its fallback for one frame and then move it.
   */
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const property = `--${name}`;

    const publish = (): void => {
      const box = node.getBoundingClientRect();
      const size = axis === 'width' ? box.width : box.height;
      document.documentElement.style.setProperty(property, `${Math.round(size)}px`);
    };

    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty(property);
    };
  }, [name, axis]);

  return ref;
}

export function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
