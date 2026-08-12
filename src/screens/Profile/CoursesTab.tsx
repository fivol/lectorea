import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BuiltCourse } from '@shared/schema';
import { useT } from '@/i18n';
import { pathTo, useCatalog } from '@/lib/catalog';
import { formatHours } from '@/lib/format';
import { courseHref, useCourseSlice } from '@/lib/url';
import { useProfile } from '@/store/profile';
import { useUi } from '@/store/ui';
import CourseArt from '@/components/CourseArt';
import Icon from '@/components/Icon';
import EmptyState from '@/components/EmptyState';
import ProgressBar from '@/components/ProgressBar';
import { Button } from '@/components/ui';

/**
 * A favourited course is a goal — there is no third entity and no third icon.
 * Progress along it is the share of its transitive prerequisites already done.
 */
export default function CoursesTab() {
  const catalog = useCatalog();
  const { t } = useT();
  const profile = useProfile((state) => state.profile);
  const navigate = useNavigate();
  const closeProfile = useUi((state) => state.closeProfile);

  const toMap = (): void => {
    closeProfile();
    navigate('/');
  };

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
    return (
      <EmptyState
        icon="star"
        text={t('ui.profile.empty')}
        action={{ label: t('ui.profile.toMap'), onClick: toMap }}
      />
    );
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
      ) : (
        /* Progress with no goal is a set of ticks with nothing to add up to,
           so the tab says what turns them into one. */
        <EmptyState
          icon="star"
          text={t('ui.profile.noGoal')}
          action={{ label: t('ui.profile.toMap'), onClick: toMap }}
        />
      )}

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
  const sliceAround = useCourseSlice();

  return (courseId: string): void => {
    closeProfile();
    // Into the course's own fields rather than onto the whole catalogue: the
    // profile is opened over either screen, and «продолжить путь» that lands on
    // a hundred and eighty unrelated cards has answered a different question.
    navigate(courseHref(courseId, sliceAround(courseId)));
    requestFocus(courseId);
  };
}

function GoalCard({ course }: { course: BuiltCourse }) {
  const catalog = useCatalog();
  const { t } = useT();
  const profile = useProfile((state) => state.profile);
  const open = useCourseNavigation();

  const steps = [...pathTo(catalog, course.id), course];
  const doneIds = steps.filter((step) => profile.courses[step.id]?.status === 'done');
  const remainingHours = steps
    .filter((step) => profile.courses[step.id]?.status !== 'done')
    .reduce((sum, step) => sum + step.hours, 0);

  // "Continue" goes to the first unfinished course by level — the one that can
  // actually be started right now.
  const nextId =
    steps.find((step) => profile.courses[step.id]?.status !== 'done')?.id ?? course.id;
  const domain = catalog.domainById.get(course.domains[0]);

  return (
    <article className="surface flex gap-3 overflow-hidden p-3">
      <span className="h-14 w-20 shrink-0 overflow-hidden rounded">
        <CourseArt
          courseId={course.id}
          color={domain?.color ?? 'var(--c-formal)'}
          domain={domain}
          className="h-full w-full"
        />
      </span>
      <div className="min-w-0 flex-1">
        <h4 className="truncate text-sm font-semibold">{t(`course.${course.id}.title`)}</h4>
        <p className="num mt-0.5 truncate text-xs text-ink-faint">
          {domain ? t(`domain.${domain.id}.title`) : ''} · {t('ui.course.level', { n: course.level + 1 })}
        </p>

        <ProgressBar
          className="mt-2"
          done={doneIds.length}
          total={steps.length}
          label={t('ui.profile.progress', { done: doneIds.length, total: steps.length })}
        />

        <p className="num mt-1 text-xs text-ink-faint">
          {t('ui.profile.remaining', { hours: formatHours(remainingHours) })}
        </p>

        {/* One verb for the path, in both of its states — «Изучать» in the
            panel is about a single course's status and stays there. */}
        <Button small className="mt-2" onClick={() => open(nextId)}>
          {doneIds.length ? t('ui.profile.continuePath') : t('ui.profile.startPath')}
          <Icon name="chevron-right" size={12} />
        </Button>
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
          domain={domain}
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
