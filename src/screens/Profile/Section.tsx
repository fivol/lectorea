import type { ReactNode } from 'react';
import { useT } from '@/i18n';
import Icon from '@/components/Icon';
import { Button } from '@/components/ui';

type Props = {
  title: string;
  /** One line under the heading, for a section whose rule is not obvious. */
  hint?: string;
  /** How many there are in total — not how many are on screen. */
  count?: number;
  /** Given only when the section is holding more than it is showing. */
  onExpand?: () => void;
  children: ReactNode;
};

/**
 * One shelf of the profile.
 *
 * The count in the heading and the way in are the same statement made twice:
 * «Пройдено 24» beside a grid of four is a promise that the other twenty are
 * somewhere, and the button is where. It appears only when there is something
 * behind it — a section showing everything it has needs no door, and a row of
 * dead «показать все» links teaches people to stop reading them.
 */
export default function Section({ title, hint, count, onExpand, children }: Props) {
  const { t } = useT();

  return (
    <section>
      <header className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {count !== undefined ? (
          <span className="num text-xs text-ink-faint">{count}</span>
        ) : null}
        {onExpand ? (
          <Button variant="ghost" small className="ml-auto" onClick={onExpand}>
            {t('ui.profile.showAll')}
            <Icon name="chevron-right" size={12} />
          </Button>
        ) : null}
      </header>
      {hint ? <p className="-mt-2 mb-3 text-xs text-ink-faint">{hint}</p> : null}
      {children}
    </section>
  );
}

/**
 * The same shelf with everything on it, one press further in.
 *
 * Still the profile — the tabs stay above it and the way back is a button in
 * the corner rather than the browser's: opening a list of forty finished
 * courses is not somewhere you have been, it is more of what you were already
 * looking at.
 */
export function ExpandedSection({
  title,
  onBack,
  toolbar,
  children,
}: {
  title: string;
  onBack: () => void;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useT();

  return (
    <section>
      <header className="mb-4 flex items-center gap-2">
        <Button variant="ghost" small icon="arrow-left" iconSize={13} onClick={onBack}>
          {t('ui.profile.back')}
        </Button>
        <h3 className="text-sm font-medium">{title}</h3>
        {toolbar ? <div className="ml-auto flex items-center gap-2">{toolbar}</div> : null}
      </header>
      {children}
    </section>
  );
}
