import { useMemo } from 'react';
import type { BuiltCourse } from '@shared/schema';
import { useT } from '@/i18n';
import { pathTo, unlocksOf, useCatalog } from '@/lib/catalog';
import { formatHours } from '@/lib/format';
import { useIsMobile } from '@/lib/hooks';
import { useProfile } from '@/store/profile';
import Icon from '@/components/Icon';
import ProgressBar from '@/components/ProgressBar';
import CourseLinkCard from './CourseLinkCard';
import PathBlock from './PathBlock';

type Props = {
  course: BuiltCourse;
  search: string;
  /** Path courses that the active domain filter would otherwise hide. */
  outsideFilter: number;
};

/**
 * Where the course sits: what it needs, what it opens up, and the whole path to
 * it — one block, folded.
 *
 * The three used to be three sections in a row, and on a phone they were 340 to
 * 460 pixels of neighbouring courses between the title and the playlists, which
 * are what the sheet is opened for. Folded they are one line, and the line
 * still carries the two things worth knowing without opening anything: which
 * course comes first, and how long the whole path is.
 *
 * The two directions of one relation stay adjacent and keep their mirrored
 * headings — "what has to come first" and "what this opens up" are the same
 * edge read from both ends. The full chain follows the pair rather than
 * splitting it.
 */
export default function LinksBlock({ course, search, outsideFilter }: Props) {
  const catalog = useCatalog();
  const { t, count } = useT();
  const isMobile = useIsMobile();
  const preference = useProfile((state) => state.profile.settings.panelLinks);
  const setSetting = useProfile((state) => state.setSetting);
  const courses = useProfile((state) => state.profile.courses);

  const unlocks = useMemo(() => unlocksOf(catalog, course.id), [catalog, course.id]);
  const steps = useMemo(() => [...pathTo(catalog, course.id), course], [catalog, course]);

  const hasPath = steps.length > 1;
  const doneCount = steps.filter((step) => courses[step.id]?.status === 'done').length;
  const totalHours = steps.reduce((sum, step) => sum + step.hours, 0);
  const remainingHours = steps
    .filter((step) => courses[step.id]?.status !== 'done')
    .reduce((sum, step) => sum + step.hours, 0);

  // A course at the root of its field with nothing standing on it yet has no
  // structure to tell — heading, summary line and all would say only that.
  if (!course.deps.length && !unlocks.length) return null;

  const open = preference === 'auto' ? !isMobile : preference === 'open';

  // The two halves of the folded line: where to start — the one thing in the
  // block anybody acts on — and what the whole thing costs. A course nothing is
  // built on has no path, so it says what it opens up instead.
  //
  // Where to start is the first step still unfinished, not the first step:
  // pointing at a course that already carries a tick is the one thing the line
  // must not do, and the steps are in study order, so the first one left is the
  // one to open next.
  const pending = steps.filter(
    (step) => step.id !== course.id && courses[step.id]?.status !== 'done'
  );
  const first = pending.length
    ? t('ui.links.first', { course: t(`course.${pending[0].id}.title`) }) +
      (pending.length > 1 ? ` +${pending.length - 1}` : '')
    : null;
  const figure = hasPath
    ? t('ui.links.path', {
        courses: count(steps.length, 'course'),
        hours: formatHours(totalHours),
      })
    : unlocks.length
      ? t('ui.links.opens', { courses: count(unlocks.length, 'course') })
      : null;

  return (
    <section className="border-t border-line">
      <button
        type="button"
        className="flex w-full items-start gap-2 px-4 py-3 text-left text-sm
                   transition-colors duration-fast ease-out hover:bg-surface-2"
        onClick={() => setSetting('panelLinks', open ? 'closed' : 'open')}
        aria-expanded={open}
      >
        <Icon
          name="chevron-right"
          size={14}
          className={`mt-[3px] shrink-0 text-ink-faint transition-transform duration-fast ease-out
                      ${open ? 'rotate-90' : ''}`}
        />
        <span className="min-w-0 flex-1">
          {/* A course at the root of its field has nothing behind it, and a
              heading promising a path over a single list of what it opens up
              is a heading about some other course. */}
          <span className="block font-medium">
            {hasPath ? t('ui.links.title') : t('ui.links.titleNoPath')}
          </span>
          {/* Under the heading rather than after it, and only while folded:
              opened, every part of this line is a heading two lines below it,
              and the same numbers would be on screen twice. */}
          {open ? null : (
            <span className="mt-0.5 block text-xs text-ink-dim">
              {first}
              {first && figure ? ' · ' : null}
              {figure ? <span className="num">{figure}</span> : null}
            </span>
          )}
        </span>
      </button>

      {/* Outside the fold, and only once there is progress to show: how much of
          the path is done is the one thing worth seeing without opening
          anything, while an empty bar over «0 из 7» is forty pixels saying the
          same as the line above it. */}
      {hasPath && doneCount ? (
        <div className="px-4 pb-3">
          <ProgressBar
            done={doneCount}
            total={steps.length}
            label={t('ui.profile.progress', { done: doneCount, total: steps.length })}
          />
          <p className="num mt-1 text-[11px] text-ink-faint">
            {t('ui.profile.remaining', { hours: formatHours(remainingHours) })}
          </p>
        </div>
      ) : null}

      <div className="collapse" data-open={open}>
        <div className="space-y-4 px-4 pb-4">
          {course.deps.length ? (
            <div>
              <h3 className="mb-2 text-sm font-medium">{t('ui.prereq.title')}</h3>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {course.deps.map((id) => (
                  <li key={id}>
                    <CourseLinkCard courseId={id} search={search} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {unlocks.length ? (
            <div>
              <h3 className="mb-2 text-sm font-medium">{t('ui.unlocks.title')}</h3>
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {unlocks.map((step) => (
                  <li key={step.id}>
                    <CourseLinkCard courseId={step.id} search={search} behind={step.behind} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {hasPath ? (
            <PathBlock
              course={course}
              steps={steps}
              doneCount={doneCount}
              totalHours={totalHours}
              search={search}
              outsideFilter={outsideFilter}
            />
          ) : null}
        </div>
      </div>
    </section>
  );
}
