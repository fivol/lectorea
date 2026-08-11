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
 */
export default function ContributeBar({ children }: { children: ReactNode }) {
  const { t } = useT();
  return (
    <footer
      className="shrink-0 border-t border-line px-4 py-2 text-center
                 md:border-t-0 md:px-6 md:pb-2.5 md:pt-1.5"
    >
      <p
        className="inline-flex flex-wrap items-center justify-center gap-x-1.5 text-[11px]
                   text-ink-faint opacity-70 transition-opacity duration-base ease-out
                   hover:opacity-100 md:rounded-full md:bg-surface/40 md:px-3 md:py-1
                   md:backdrop-blur-sm"
      >
        {children}
        <a
          href={contributeUrl()}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 underline decoration-line underline-offset-2
                     transition-colors hover:text-accent"
        >
          {t('ui.footer.suggest')}
          <Icon name="external" size={10} />
        </a>
      </p>
    </footer>
  );
}
