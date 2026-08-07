import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BuiltCourse } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { formatHours } from '@/lib/format';
import { useProfile } from '@/store/profile';
import { useUi } from '@/store/ui';
import CourseArt from '@/components/CourseArt';
import Icon from '@/components/Icon';

/**
 * A favourited course is a goal — there is no third entity and no third icon.
 * Progress along it is the share of its transitive prerequisites already done.
 */
export default function CoursesTab() {
  const catalog = useCatalog();
  const { t } = useT();
  const profile = useProfile((state) => state.profile);

  const groups = useMemo(() => {
    const inProgress: BuiltCourse[] = [];
    const done: BuiltCourse[] = [];
    const goals: BuiltCourse[] = [];

    for (const [id, entry] of Object.entries(profile.courses)) {
      const course = catalog.courseById.get(id);
      if (!course) continue;
      if (entry.favorite) goals.push(course);
      if (entry.status === 'in_progress') inProgress.push(course);
      if (entry.status === 'done') done.push(course);
    }
    return { inProgress, done, goals };
  }, [profile.courses, catalog]);

  const empty = !groups.inProgress.length && !groups.done.length && !groups.goals.length;
  if (empty) {
    return <p className="p-8 text-center text-sm text-ink-faint">{t('ui.profile.empty')}</p>;
  }

  return (
    <div className="space-y-8 p-4">
      {groups.goals.length ? (
        <section>
          <h3 className="mb-1 text-sm font-medium">{t('ui.profile.group.favorite')}</h3>
          <p className="mb-3 text-xs text-ink-faint">{t('ui.profile.group.favorite.hint')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {groups.goals.map((course) => (
              <GoalCard key={course.id} course={course} />
            ))}
          </div>
        </section>
      ) : null}

      {(['in_progress', 'done'] as const).map((status) => {
        const list = status === 'in_progress' ? groups.inProgress : groups.done;
        if (!list.length) return null;
        return (
          <section key={status}>
            <h3 className="mb-3 text-sm font-medium">{t(`ui.profile.group.${status}`)}</h3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((course) => (
                <PlainCard key={course.id} course={course} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function useCourseNavigation() {
  const navigate = useNavigate();
  const closeProfile = useUi((state) => state.closeProfile);
  const requestFocus = useUi((state) => state.requestFocus);

  return (courseId: string): void => {
    closeProfile();
    navigate(`/courses/${encodeURIComponent(courseId)}`);
    requestFocus(courseId);
  };
}

function GoalCard({ course }: { course: BuiltCourse }) {
  const catalog = useCatalog();
  const { t } = useT();
  const profile = useProfile((state) => state.profile);
  const open = useCourseNavigation();

  const steps = [...course.reachUp, course.id];
  const doneIds = steps.filter((id) => profile.courses[id]?.status === 'done');
  const percent = Math.round((doneIds.length / steps.length) * 100);
  const remainingHours = steps
    .filter((id) => profile.courses[id]?.status !== 'done')
    .reduce((sum, id) => sum + (catalog.courseById.get(id)?.hours ?? 0), 0);

  // "Continue" goes to the first unfinished course in topological order — the
  // one that can actually be started right now.
  const nextId = steps.find((id) => profile.courses[id]?.status !== 'done') ?? course.id;
  const domain = catalog.domainById.get(course.domains[0]);

  return (
    <article className="surface flex gap-3 overflow-hidden p-3">
      <span className="h-14 w-20 shrink-0 overflow-hidden rounded">
        <CourseArt
          courseId={course.id}
          color={domain?.color ?? 'var(--c-formal)'}
          className="h-full w-full"
        />
      </span>
      <div className="min-w-0 flex-1">
        <h4 className="truncate text-sm font-semibold">{t(`course.${course.id}.title`)}</h4>
        <p className="num mt-0.5 truncate text-xs text-ink-faint">
          {domain ? t(`domain.${domain.id}.title`) : ''} · {t('ui.course.level', { n: course.level + 1 })}
        </p>

        <div className="mt-2 flex items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
            <span
              className="block h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${percent}%` }}
            />
          </span>
          <span className="num shrink-0 text-xs text-ink-dim">
            {t('ui.profile.progress', { done: doneIds.length, total: steps.length })}
          </span>
        </div>

        <p className="num mt-1 text-xs text-ink-faint">
          {t('ui.profile.remaining', { hours: formatHours(remainingHours) })}
        </p>

        <button type="button" className="btn mt-2 text-xs" onClick={() => open(nextId)}>
          {t('ui.profile.continue')}
          <Icon name="chevron-right" size={12} />
        </button>
      </div>
    </article>
  );
}

function PlainCard({ course }: { course: BuiltCourse }) {
  const catalog = useCatalog();
  const { t } = useT();
  const open = useCourseNavigation();
  const domain = catalog.domainById.get(course.domains[0]);

  return (
    <button
      type="button"
      onClick={() => open(course.id)}
      aria-label={`${t(`course.${course.id}.title`)} — ${t('ui.profile.openInGraph')}`}
      className="surface flex items-center gap-3 p-2 text-left hover:border-accent"
    >
      <span className="h-10 w-14 shrink-0 overflow-hidden rounded">
        <CourseArt
          courseId={course.id}
          color={domain?.color ?? 'var(--c-formal)'}
          className="h-full w-full"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{t(`course.${course.id}.title`)}</span>
        <span className="num block truncate text-xs text-ink-faint">
          {domain ? t(`domain.${domain.id}.title`) : ''}
        </span>
      </span>
      <Icon name="chevron-right" size={13} className="text-ink-faint" />
    </button>
  );
}
