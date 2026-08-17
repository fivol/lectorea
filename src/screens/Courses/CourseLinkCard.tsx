import { Link } from 'react-router-dom';
import { useT } from '@/i18n';
import { useCatalog, useLinkNote } from '@/lib/catalog';
import { withAlpha } from '@/lib/format';
import { useIsTruncated } from '@/lib/hooks';
import { courseHref } from '@/lib/url';
import { useUi } from '@/store/ui';
import CourseArt from '@/components/CourseArt';
import Icon from '@/components/Icon';
import Tooltip from '@/components/Tooltip';

/**
 * A neighbouring course, linked from the panel.
 *
 * "What has to come first" and "what this opens up" are the same relation read
 * in opposite directions, so they get the same card — the only difference
 * between the two lists is the heading over them.
 *
 * The name gets two lines. A course title is the unit of meaning on this
 * screen, and one truncated line turned «Дифференциальная геометрия» into
 * «Дифференциал…», which names nothing. The thumbnail gives up width for it,
 * and on the rare title that still does not fit, the tooltip has the rest.
 */
export default function CourseLinkCard({
  courseId,
  search,
  /** Courses further along behind this one, shown as "+3" on the forward list. */
  behind = 0,
  /** The course whose panel this card stands in — the other end of the edge. */
  from,
}: {
  courseId: string;
  search: string;
  behind?: number;
  from?: string;
}) {
  const catalog = useCatalog();
  const { t } = useT();
  const linkNote = useLinkNote();
  const setEcho = useUi((state) => state.setEcho);
  const requestFocus = useUi((state) => state.requestFocus);

  const title = t(`course.${courseId}.title`);
  const [titleRef, clipped] = useIsTruncated<HTMLSpanElement>([title]);

  const course = catalog.courseById.get(courseId);
  if (!course) return null;

  const domain = catalog.domainById.get(course.domains[0]);
  const colour = domain?.color ?? 'var(--c-formal)';

  /**
   * What the tooltip has to say, in order of how much it is worth saying: why
   * this course is here, then — only if the name did not fit — the name. Both,
   * when the name is clipped and there is a reason too.
   */
  const note = from ? linkNote(from, courseId) : null;
  const hint = note ? (clipped ? `${title} — ${note}` : note) : clipped ? title : null;

  return (
    <Tooltip content={hint}>
      <Link
        to={courseHref(courseId, search)}
        // Both ends: the card to lift, and the course this panel is about, so
        // the columns can draw the edge between the two while it is pointed at.
        onMouseEnter={() => setEcho(courseId, from)}
        onMouseLeave={() => setEcho(null)}
        onClick={() => requestFocus(courseId)}
        className="flex items-center gap-2.5 rounded-card border bg-surface p-2 transition-colors
                   duration-fast ease-out hover:border-accent"
        style={{ borderColor: withAlpha(colour, 0.4) }}
      >
        <span className="h-9 w-12 shrink-0 overflow-hidden rounded">
          <CourseArt courseId={courseId} color={colour} domain={domain} className="h-full w-full" />
        </span>
        <span className="min-w-0 flex-1">
          <span ref={titleRef} className="block line-clamp-2 text-caption leading-snug text-ink">
            {title}
          </span>
          <span className="num block truncate text-[11px] text-ink-faint">
            {domain ? t(`domain.${domain.id}.title`) : ''} · {t(`ui.stage.${course.stage}`)}
            {behind ? ` · ${t('ui.unlocks.behind', { n: behind })}` : ''}
          </span>
        </span>
        <Icon name="chevron-right" size={13} className="shrink-0 text-ink-faint" />
      </Link>
    </Tooltip>
  );
}
