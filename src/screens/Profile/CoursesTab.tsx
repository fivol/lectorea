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
              <CourseCard key={course.id} course={course} />
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
            {/* The same grid as the goals above, because the same card is in it. */}
            <div className="grid gap-3 sm:grid-cols-2">
              {list.map((course) => (
                <CourseCard key={course.id} course={course} />
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

/**
 * One card for all three groups.
 *
 * A goal used to be a card with artwork, a path and hours, and a course in
 * progress a thin strip with a name on it — so the tab read as three lists of
 * three different things, when a goal, a course being studied and a finished
 * one are one course in three states. The state is what the heading above the
 * grid says; the card says what the course is and how far along it you are,
 * and that is the same question in every group.
 */
function CourseCard({ course }: { course: BuiltCourse }) {
  const catalog = useCatalog();
  const { t } = useT();
  const profile = useProfile((state) => state.profile);
  const open = useCourseNavigation();

  const steps = [...pathTo(catalog, course.id), course];
  const doneIds = steps.filter((step) => profile.courses[step.id]?.status === 'done');
  const remainingHours = steps
    .filter((step) => profile.courses[step.id]?.status !== 'done')
    .reduce((sum, step) => sum + step.hours, 0);

  const domain = catalog.domainById.get(course.domains[0]);

  return (
    <article className="surface relative flex gap-3 overflow-hidden p-3 transition-colors
                        duration-fast ease-out hover:border-accent">
      {/*
        The whole card opens the course, and the card alone. It used to open
        nothing at all — every part of it was a caption, and the one thing that
        could be pressed was a button underneath offering to «начать путь»,
        which went not to the course on the card but to the first unfinished
        step of the path behind it. A card that names one course and leads to
        another is a card you learn not to trust; the path itself is in the
        panel the course opens, one press further on and asked for.

        Laid over the card rather than wrapped around it: the progress bar is a
        `div`, and a `div` cannot live inside a `button`.
      */}
      <button
        type="button"
        onClick={() => open(course.id)}
        aria-label={`${t(`course.${course.id}.title`)} — ${t('ui.profile.openInGraph')}`}
        className="absolute inset-0 z-10"
      />
      <span className="h-14 w-20 shrink-0 overflow-hidden rounded">
        <CourseArt
          courseId={course.id}
          color={domain?.color ?? 'var(--c-formal)'}
          domain={domain}
          className="h-full w-full"
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <h4 className="min-w-0 flex-1 truncate text-sm font-semibold">
            {t(`course.${course.id}.title`)}
          </h4>
          {/* The one mark that says the card is a door rather than a summary. */}
          <Icon name="chevron-right" size={13} className="mt-0.5 shrink-0 text-ink-faint" />
        </div>
        <p className="num mt-0.5 truncate text-xs text-ink-faint">
          {domain ? t(`domain.${domain.id}.title`) : ''} · {t('ui.course.level', { n: course.level + 1 })}
        </p>

        <ProgressBar
          className="mt-2"
          done={doneIds.length}
          total={steps.length}
          label={t('ui.profile.progress', { done: doneIds.length, total: steps.length })}
        />

        {/* Only while there is anything left. A finished path already says so
            with a full bar reading «3 из 3», and «осталось ≈0 ч» under it is
            a line that exists to be ignored. */}
        {remainingHours > 0 ? (
          <p className="num mt-1 text-xs text-ink-faint">
            {t('ui.profile.remaining', { hours: formatHours(remainingHours) })}
          </p>
        ) : null}
      </div>
    </article>
  );
}
