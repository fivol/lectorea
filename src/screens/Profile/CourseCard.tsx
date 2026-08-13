import { useMemo } from 'react';
import type { BuiltCourse } from '@shared/schema';
import { useT } from '@/i18n';
import { pathTo, useCatalog } from '@/lib/catalog';
import { formatHours, hoursFromSeconds } from '@/lib/format';
import { useGoalProgress } from '@/lib/goals';
import { percent, useCourseProgress } from '@/lib/progress';
import CourseArt from '@/components/CourseArt';
import Icon from '@/components/Icon';
import ProgressBar from '@/components/ProgressBar';
import { useProfileNavigation } from './navigate';

/**
 * One card for every shelf in the profile, and one question on it: how far
 * along is this.
 *
 * What counts as "far" is the only thing that differs, and it differs because
 * the shelves are asking about different things. A goal is a course you have
 * not started — the number that matters is how much of the path to it is
 * behind you. A course you are studying is one recording being worked through,
 * and the path to it is ancient history: the useful number is the lectures.
 * Same card, same place on it, the heading above the grid saying which reading
 * it is.
 */
export type CardMode = 'path' | 'course';

export default function CourseCard({
  course,
  mode,
  steps,
}: {
  course: BuiltCourse;
  mode: CardMode;
  /** The path to it, when the caller already has one. */
  steps?: string[];
}) {
  const catalog = useCatalog();
  const { t } = useT();
  const { openCourse } = useProfileNavigation();
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
        onClick={() => openCourse(course.id)}
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
          {domain ? t(`domain.${domain.id}.title`) : ''} ·{' '}
          {t('ui.course.level', { n: course.level + 1 })}
        </p>

        {mode === 'path' ? (
          <PathMetrics course={course} steps={steps} />
        ) : (
          <CourseMetrics course={course} />
        )}
      </div>
    </article>
  );
}

/** A goal: the share of everything it stands on that is already behind you. */
function PathMetrics({ course, steps }: { course: BuiltCourse; steps?: string[] }) {
  const catalog = useCatalog();
  const { t } = useT();
  const path = useMemo(
    () => steps ?? [...pathTo(catalog, course.id).map((step) => step.id), course.id],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [steps?.join(','), catalog, course.id]
  );
  const { progress, remainingHours } = useGoalProgress(path);

  return (
    <>
      {/* The percentage carries the course in hand, the count carries the
          milestones. Neither on its own is the answer to "how far am I". */}
      <ProgressBar
        className="mt-2"
        done={progress.done}
        total={progress.total}
        partial={progress.partial}
        label={`${percent(progress.fraction)}% · ${t('ui.profile.progress', {
          done: progress.done,
          total: progress.total,
        })}`}
      />

      {/* Only while there is anything left. A finished path already says so
          with a full bar reading «3 из 3», and «осталось ≈0 ч» under it is
          a line that exists to be ignored. */}
      {remainingHours > 0 ? (
        <p className="num mt-1 text-xs text-ink-faint">
          {t('ui.profile.remaining', { hours: formatHours(remainingHours) })}
        </p>
      ) : null}
    </>
  );
}

/** A course being studied: the recording it is being studied by. */
function CourseMetrics({ course }: { course: BuiltCourse }) {
  const { t } = useT();
  const ids = useMemo(() => [course.id], [course.id]);
  const progress = useCourseProgress(ids).get(course.id);

  // Nothing watched — a course marked done by hand, or one whose shard has not
  // landed. The catalogue's own estimate is the only honest thing to say.
  if (!progress) {
    return (
      <p className="num mt-2 text-xs text-ink-faint">
        {t('ui.playlist.hours', { n: formatHours(course.hours) })}
      </p>
    );
  }

  const left = Math.max(0, progress.totalSeconds - progress.watchedSeconds);

  return (
    <>
      <ProgressBar
        className="mt-2"
        done={progress.done}
        total={progress.total}
        fill={progress.fraction}
        label={`${percent(progress.fraction)}% · ${t('ui.profile.lectureProgress', {
          done: progress.done,
          total: progress.total,
        })}`}
      />
      {left > 60 ? (
        <p className="num mt-1 truncate text-xs text-ink-faint">
          {t('ui.profile.remaining', { hours: formatHours(hoursFromSeconds(left)) })} ·{' '}
          {progress.playlist.title}
        </p>
      ) : null}
    </>
  );
}
