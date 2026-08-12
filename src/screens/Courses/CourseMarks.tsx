import type { CourseStatus } from '@shared/schema';
import { useT } from '@/i18n';
import Icon from '@/components/Icon';
import Tooltip from '@/components/Tooltip';

/**
 * The marks a person leaves on a course: in favourites, started, done.
 *
 * They used to be 12px icons in the metadata row — the line of a card the eye
 * reaches last. A star that size disappears in a column of forty cards, and a
 * tick in a circle is a rule the reader is expected to have worked out. So the
 * marks sit on the artwork now, always the same corner, and the two that stand
 * for a state say it in words rather than in symbol alone.
 *
 * Each one explains itself on hover, because a legend read once on the first
 * visit is not there three screens later when the question actually comes up.
 * The legend draws these same marks beside their meaning — the one place where
 * the tooltip would only repeat what is already on the line, hence `explain`.
 */

const PLATE =
  'mark-pop inline-flex h-[18px] shrink-0 items-center gap-1 rounded-full text-[10px] font-medium leading-none text-canvas';

type Props = {
  /** Off inside the legend, which is itself the explanation. */
  explain?: boolean;
};

export function FavoriteMark({ explain = true }: Props) {
  const { t } = useT();
  // A plate rather than a bare glyph: the star has to be found, not deciphered,
  // and the label is what tells a screen reader the card is one of someone's.
  const mark = (
    <span
      className={`${PLATE} w-[18px] justify-center bg-warning`}
      role="img"
      aria-label={t('ui.course.favoriteOn')}
    >
      <Icon name="star-filled" size={11} />
    </span>
  );
  return explain ? <Tooltip content={t('ui.legend.favorite')}>{mark}</Tooltip> : mark;
}

export function StatusMark({ status, explain = true }: Props & { status: CourseStatus }) {
  const { t } = useT();
  const done = status === 'done';
  const mark = (
    <span className={`${PLATE} px-1.5 ${done ? 'bg-accent' : 'bg-formal'}`}>
      <Icon name={done ? 'check' : 'half'} size={10} />
      {done ? t('ui.course.done') : t('ui.course.inProgress')}
    </span>
  );
  if (!explain) return mark;
  return (
    <Tooltip content={done ? t('ui.legend.done') : t('ui.legend.inProgress')}>{mark}</Tooltip>
  );
}
