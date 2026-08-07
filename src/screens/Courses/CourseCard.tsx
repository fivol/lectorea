import { memo } from 'react';
import type { BuiltCourse, BuiltDomain } from '@shared/schema';
import { useT } from '@/i18n';
import { inkOn, withAlpha } from '@/lib/format';
import { CARD_ART_HEIGHT, CARD_HEIGHT, CARD_WIDTH } from '@/lib/layout';
import { EMPHASIS_OPACITY, type Emphasis } from '@/lib/highlight';
import { useResolvedTheme } from '@/store/profile';
import CourseArt from '@/components/CourseArt';
import Icon from '@/components/Icon';
import Tooltip from '@/components/Tooltip';
import type { CourseStatus } from '@shared/schema';

type Props = {
  course: BuiltCourse;
  domain: BuiltDomain | undefined;
  emphasis: Emphasis;
  /** Cascade delay in ms — zero when reduced motion is requested. */
  delay: number;
  selected: boolean;
  /** In the chain of the selected course: a weaker relative of `selected`. */
  inPath: boolean;
  /** Set for one pulse after the card has been scrolled to. */
  pulsing: boolean;
  status: CourseStatus | null;
  favorite: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
};

function CourseCardInner({
  course,
  domain,
  emphasis,
  delay,
  selected,
  inPath,
  pulsing,
  status,
  favorite,
  onSelect,
  onHover,
}: Props) {
  const { t } = useT();
  const scheme = useResolvedTheme();
  // The border is the domain's colour at 45 % — pale hues picked for the dark
  // canvas vanish at that strength on a white card, so it deepens with the theme.
  const colour = inkOn(domain?.color ?? '#4CC9F0', scheme);
  const opacity = EMPHASIS_OPACITY[emphasis];
  const muted = emphasis === 'muted';
  const empty = course.playlistCount === 0;

  const accent = emphasis === 'downstream' ? 'var(--c-accent)' : colour;

  return (
    <button
      type="button"
      data-course={course.id}
      onClick={() => onSelect(course.id)}
      onPointerEnter={() => onHover(course.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(course.id)}
      onBlur={() => onHover(null)}
      // `aria-current`, not `aria-selected`: the latter is only valid inside a
      // listbox or a grid, and turning a card full of interactive detail into
      // an `option` would cost more than the attribute name is worth. Both say
      // "this is the one" to a screen reader.
      aria-current={selected ? 'true' : undefined}
      className={`relative shrink-0 overflow-hidden rounded-card border text-left
                  transition-[opacity,transform,box-shadow,filter,background-color]
                  duration-base ease-inout
                  hover:z-10 hover:scale-[1.03] hover:shadow-[var(--shadow-card)]
                  motion-reduce:hover:scale-100
                  ${pulsing ? 'focus-pulse' : ''}
                  ${selected ? 'z-10' : ''}`}
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        opacity,
        // Colour is the loudest thing on a card; draining it says "not in this
        // chain" without having to take the card's legibility with it.
        filter: muted ? 'grayscale(0.6)' : undefined,
        transitionDelay: `${delay}ms`,
        // In-path cards carry a wash of the accent — present, clearly weaker
        // than the ring on the selected card, and readable in both themes.
        background: inPath && !selected ? 'var(--c-accent-soft)' : 'var(--c-surface)',
        borderColor: selected
          ? accent
          : inPath
            ? 'var(--c-accent)'
            : withAlpha(accent, muted ? 0.2 : 0.45),
        borderWidth: selected ? 2 : 1,
        boxShadow: selected ? `0 0 0 3px ${withAlpha(accent, 0.2)}, var(--shadow-card)` : undefined,
      }}
    >
      <div className="relative w-full" style={{ height: CARD_ART_HEIGHT }}>
        <CourseArt courseId={course.id} color={colour} className="h-full w-full" />
        {/* Done is a property of the picture, not of the metadata row: it has to
            survive being read at a glance across a column of forty cards. */}
        {status === 'done' ? (
          <span
            className="mark-pop absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center
                       rounded-full bg-accent text-canvas"
            title={t('ui.course.done')}
          >
            <Icon name="check" size={12} />
          </span>
        ) : null}
        {empty ? (
          <Tooltip content={t('ui.course.noMaterialsHint')}>
            <span className="on-canvas absolute left-1.5 top-1.5 rounded px-1.5 py-0.5 text-[10px] text-ink-faint">
              {t('ui.course.noMaterials')}
            </span>
          </Tooltip>
        ) : null}
      </div>

      <div
        className="flex flex-col gap-1 p-2"
        style={{ height: `calc(100% - ${CARD_ART_HEIGHT}px)` }}
      >
        <span className="line-clamp-2 text-[13px] font-semibold leading-tight text-ink">
          {t(`course.${course.id}.title`)}
        </span>
        {/* The one-line description earns its place here: a title alone leaves
            "Общая алгебра" and "Теория категорий" looking interchangeable. */}
        <span className="line-clamp-3 text-[11px] leading-snug text-ink-dim">
          {t(`course.${course.id}.desc`)}
        </span>
        <span className="mt-auto flex items-center justify-between gap-1">
          {/* The column number says where the course sits in this catalogue;
              this says when a person actually meets it, which is the question
              people arrive with. */}
          <span className="flex min-w-0 items-center gap-1 text-ink-faint">
            <span className="num truncate text-[11px]">{t(`ui.stage.${course.stage}`)}</span>
            {favorite ? <Icon name="star-filled" size={12} className="text-warning" /> : null}
            {status === 'in_progress' ? (
              <Icon name="half" size={12} className="text-formal" />
            ) : null}
          </span>
          <span className="num flex items-center gap-0.5 text-[11px] text-ink-faint">
            {course.playlistCount || ''}
            {course.playlistCount ? <Icon name="chevron-right" size={11} /> : null}
          </span>
        </span>
      </div>
    </button>
  );
}

/** Every card re-rendering on every pointer move is the thing to avoid here. */
export default memo(CourseCardInner);
