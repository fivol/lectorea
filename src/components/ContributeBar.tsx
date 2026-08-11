import type { ReactNode } from 'react';
import { useT } from '@/i18n';
import { contributeUrl } from '@/lib/repo';
import Icon from './Icon';

/**
 * «Не хватает курса? — Предложите», at the foot of a screen.
 *
 * A plate on a wide screen. The line used to sit flat against the bottom edge
 * with the content running straight into it, which reads as a page cut off
 * rather than as an invitation — and an invitation nobody sees is the same as
 * not making one. On a phone it goes back to being a bar: an island is the
 * full width there anyway, so the capsule buys nothing and the shadow under it
 * costs a row of content.
 *
 * The link goes to the chooser rather than to one form: what is missing might
 * be a course, a territory or a remark, and the app cannot tell which.
 */
export default function ContributeBar({ children }: { children: ReactNode }) {
  const { t } = useT();
  return (
    <footer
      className="shrink-0 border-t border-line px-4 py-2.5 text-center
                 md:border-t-0 md:px-6 md:pb-3 md:pt-2"
    >
      <p
        className="inline-flex flex-wrap items-center justify-center gap-x-1.5 text-xs
                   text-ink-faint md:plate md:px-4 md:py-1.5"
      >
        {children}
        <a
          href={contributeUrl()}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-ink-dim underline decoration-line
                     underline-offset-2 transition-colors hover:text-accent"
        >
          {t('ui.footer.suggest')}
          <Icon name="external" size={11} />
        </a>
      </p>
    </footer>
  );
}
