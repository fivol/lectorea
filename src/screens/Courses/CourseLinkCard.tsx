import { Link } from 'react-router-dom';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { withAlpha } from '@/lib/format';
import { courseHref } from '@/lib/url';
import { useUi } from '@/store/ui';
import CourseArt from '@/components/CourseArt';
import Icon from '@/components/Icon';

/**
 * A neighbouring course, linked from the panel.
 *
 * "What has to come first" and "what this opens up" are the same relation read
 * in opposite directions, so they get the same card — the only difference
 * between the two lists is the heading over them.
 */
export default function CourseLinkCard({
  courseId,
  search,
  /** Courses further along behind this one, shown as "+3" on the forward list. */
  behind = 0,
}: {
  courseId: string;
  search: string;
  behind?: number;
}) {
  const catalog = useCatalog();
  const { t } = useT();
  const setEcho = useUi((state) => state.setEcho);
  const requestFocus = useUi((state) => state.requestFocus);

  const course = catalog.courseById.get(courseId);
  if (!course) return null;

  const domain = catalog.domainById.get(course.domains[0]);
  const colour = domain?.color ?? 'var(--c-formal)';

  return (
    <Link
      to={courseHref(courseId, search)}
      onMouseEnter={() => setEcho(courseId)}
      onMouseLeave={() => setEcho(null)}
      onClick={() => requestFocus(courseId)}
      className="flex items-center gap-2.5 rounded-lg border bg-surface p-2 transition-colors hover:border-accent"
      style={{ borderColor: withAlpha(colour, 0.4) }}
    >
      <span className="h-10 w-14 shrink-0 overflow-hidden rounded">
        <CourseArt courseId={courseId} color={colour} className="h-full w-full" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink">{t(`course.${courseId}.title`)}</span>
        <span className="num block truncate text-[11px] text-ink-faint">
          {domain ? t(`domain.${domain.id}.title`) : ''} · {t(`ui.stage.${course.stage}`)}
          {behind ? ` · ${t('ui.unlocks.behind', { n: behind })}` : ''}
        </span>
      </span>
      <Icon name="chevron-right" size={13} className="shrink-0 text-ink-faint" />
    </Link>
  );
}
