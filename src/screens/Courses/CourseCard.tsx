import { memo } from 'react';
import type { BuiltCourse, BuiltDomain } from '@shared/schema';
import { useT } from '@/i18n';
import { withAlpha } from '@/lib/format';
import { CARD_HEIGHT, CARD_WIDTH } from '@/lib/layout';
import { EMPHASIS_OPACITY, type Emphasis } from '@/lib/highlight';
import CourseArt from '@/components/CourseArt';
import Icon from '@/components/Icon';
import type { CourseStatus } from '@shared/schema';

type Props = {
  course: BuiltCourse;
  domain: BuiltDomain | undefined;
  emphasis: Emphasis;
  /** Cascade delay in ms — zero when reduced motion is requested. */
  delay: number;
  selected: boolean;
  status: CourseStatus | null;
  favorite: boolean;
  dimmedByFilter: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
};

function CourseCardInner({
  course,
  domain,
  emphasis,
  delay,
  selected,
  status,
  favorite,
  dimmedByFilter,
  onSelect,
  onHover,
}: Props) {
  const { t } = useT();
  const colour = domain?.color ?? 'var(--c-formal)';
  const opacity = EMPHASIS_OPACITY[emphasis] * (dimmedByFilter ? 0.55 : 1);
  const empty = course.playlistCount === 0;

  const accent =
    emphasis === 'downstream' ? 'var(--c-accent)' : colour;

  return (
    <button
      type="button"
      data-course={course.id}
      onClick={() => onSelect(course.id)}
      onPointerEnter={() => onHover(course.id)}
      onPointerLeave={() => onHover(null)}
      onFocus={() => onHover(course.id)}
      onBlur={() => onHover(null)}
      aria-current={selected ? 'true' : undefined}
      className={`relative shrink-0 overflow-hidden rounded-lg border text-left
                  transition-[opacity,transform,box-shadow] duration-200 ease-out
                  hover:z-10 hover:scale-[1.03] hover:shadow-[var(--shadow-card)]
                  motion-reduce:hover:scale-100
                  ${selected ? 'z-10' : ''}`}
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        opacity,
        transitionDelay: `${delay}ms`,
        background: 'var(--c-surface)',
        borderColor: selected ? accent : withAlpha(accent, emphasis === 'muted' ? 0.2 : 0.45),
        borderWidth: selected ? 2 : 1,
        boxShadow: selected ? `0 0 0 3px ${withAlpha(accent, 0.2)}, var(--shadow-card)` : undefined,
      }}
    >
      <div className="relative h-[72px] w-full">
        <CourseArt courseId={course.id} color={colour} className="h-full w-full" />
        {empty ? (
          <span className="absolute right-1.5 top-1.5 rounded bg-canvas/70 px-1.5 py-0.5 text-[10px] text-ink-faint">
            {t('ui.course.noMaterials')}
          </span>
        ) : null}
      </div>

      <div className="flex h-[calc(100%-72px)] flex-col justify-between p-2">
        <span className="line-clamp-2 text-[13px] font-semibold leading-tight text-ink">
          {t(`course.${course.id}.title`)}
        </span>
        <span className="flex items-center justify-between gap-1">
          {/* The column number says where the course sits in this catalogue;
              this says when a person actually meets it, which is the question
              people arrive with. */}
          <span className="flex min-w-0 items-center gap-1 text-ink-faint">
            <span className="num truncate text-[11px]">{t(`ui.stage.${course.stage}`)}</span>
            {favorite ? <Icon name="star-filled" size={12} className="text-social" /> : null}
            {status === 'done' ? <Icon name="check" size={12} className="text-accent" /> : null}
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
