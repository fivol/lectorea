import type { ReactNode } from 'react';
import { useT } from '@/i18n';
import { contributeUrl } from '@/lib/repo';
import Icon from './Icon';

/**
 * «Не хватает курса? — Предложите», at the foot of a screen.
 *
 * Set to be found rather than to be seen. The line used to lie flat against
 * the bottom edge with the content running into it, which reads as a page cut
 * off; a full plate instead — fill, rim and shadow — reads as a cookie banner,
 * and a banner is a thing people learn not to look at. So: the capsule shape,
 * to lift it off whatever is scrolling past underneath, and nothing else. It
 * comes up to full strength when the pointer is on it.
 *
 * On a phone it goes back to being a bar. An island is the full width there
 * anyway, so the capsule buys nothing.
 *
 * The link goes to the chooser rather than to one form: what is missing might
 * be a course, a territory or a remark, and the app cannot tell which.
 *
 * @param floating Over a drawing rather than under a column — see below.
 */
export default function ContributeBar({
  children,
  floating = false,
  className = '',
}: {
  children: ReactNode;
  floating?: boolean;
  /** For the one place it rides inside a scroller rather than under it. */
  className?: string;
}) {
  const { t } = useT();
  return (
    /*
      Floating, the line has no band of its own at all.

      A bar under the map is a strip of flat colour across the bottom of a
      drawing that is otherwise edge to edge — the sea stops, and a page that
      was a window becomes a picture with a caption bolted under it. Lying on
      the map instead, it takes the answer the map gives its own names: a halo
      in the colour the letters are written on, which is what makes eleven-point
      grey legible over a coastline one moment and open water the next.

      Nothing is clickable but the link, so the rest of the row hands its
      presses down to whatever is underneath. A line of small print may not take
      a strip of the map away from the hand dragging it.
    */
    <footer
      className={`${
        floating
          ? 'over-map pointer-events-none px-4 text-center'
          : 'shrink-0 border-t border-line px-4 py-2 text-center md:border-t-0 md:px-6 md:pb-2.5 md:pt-1.5'
      } ${className}`}
    >
      <p
        className={`inline-flex flex-wrap items-center justify-center gap-x-1.5 text-[11px]
                    text-ink-faint transition-opacity duration-base ease-out hover:opacity-100
                    ${
                      floating
                        ? 'opacity-80'
                        : `opacity-70 md:rounded-full md:bg-surface/40 md:px-3 md:py-1
                           md:backdrop-blur-sm`
                    }`}
      >
        {children}
        <a
          href={contributeUrl()}
          target="_blank"
          rel="noreferrer noopener"
          className={`inline-flex items-center gap-1 underline decoration-line underline-offset-2
                      transition-colors hover:text-accent ${floating ? 'pointer-events-auto' : ''}`}
        >
          {t('ui.footer.suggest')}
          <Icon name="external" size={10} />
        </a>
      </p>
    </footer>
  );
}
