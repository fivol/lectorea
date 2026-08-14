import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { BuiltCourse } from '@shared/schema';
import { useT } from '@/i18n';
import { pathTo, unlocksOf, useCatalog, useLinkNote } from '@/lib/catalog';
import { formatHours } from '@/lib/format';
import { useIsMobile } from '@/lib/hooks';
import { courseHref } from '@/lib/url';
import { useProfile } from '@/store/profile';
import { useUi } from '@/store/ui';
import Icon from '@/components/Icon';
import Tooltip from '@/components/Tooltip';
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
 * it.
 *
 * On a phone the three of them were 340 to 460 pixels of neighbouring courses
 * between the title and the playlists, which are what the sheet is opened for,
 * so there they fold into one line — which course to start with, and what the
 * whole path costs — and the fold is remembered for every course afterwards.
 *
 * A wide panel has the height, and a control that hides three headings behind a
 * fourth is worth less there than the headings: nothing folds, and the lists cap
 * their height and scroll instead, so a course that opens eight others cannot
 * push the playlists off the screen either.
 *
 * The lists are ordered by reading direction rather than by edge type: what
 * stands before the course, then what stands after it, then the whole chain.
 * `soft` therefore sits under the prerequisites instead of in a section of its
 * own — it is the same question, asked with a weaker answer, and it used to
 * live below the recordings, half a panel away from the list it belongs to.
 *
 * "What has to come first" and "what this opens up" keep their mirrored
 * headings — they are the same edge read from both ends — and the full chain
 * follows them rather than splitting the pair.
 */
export default function LinksBlock({ course, search, outsideFilter }: Props) {
  const catalog = useCatalog();
  const { t, count } = useT();
  const isMobile = useIsMobile();
  const preference = useProfile((state) => state.profile.settings.panelLinks);
  const setSetting = useProfile((state) => state.setSetting);
  const courses = useProfile((state) => state.profile.courses);
  const setEcho = useUi((state) => state.setEcho);
  const linkNote = useLinkNote();

  const unlocks = useMemo(() => unlocksOf(catalog, course.id), [catalog, course.id]);
  const steps = useMemo(() => [...pathTo(catalog, course.id), course], [catalog, course]);

  const hasPath = steps.length > 1;
  const totalHours = steps.reduce((sum, step) => sum + step.hours, 0);

  // A course at the root of its field with nothing standing on it yet has no
  // structure to tell — heading, summary line and all would say only that. The
  // weak links count: a course whose only neighbours are `soft` or `related`
  // has something to say, and this used to be the test that swallowed it.
  if (!course.deps.length && !unlocks.length && !course.soft.length && !course.related.length) {
    return null;
  }

  const open = preference === 'open';

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

  /**
   * The lists, capped on a wide panel.
   *
   * Two rows of cards and six steps are enough to read the shape of a chain;
   * past that the scroll belongs to the list rather than to the panel, or a
   * course with eight sequels pushes its own recordings out of sight. The cap
   * is only for the panel: an inner scrollport inside the phone sheet is a
   * gesture fighting the sheet's own drag.
   */
  const capCards = isMobile ? '' : 'max-h-36 overflow-y-auto overscroll-contain pr-1';

  const content = (
    <>
      {course.deps.length ? (
        <div>
          <h3 className="mb-2 text-sm font-medium">{t('ui.prereq.title')}</h3>
          <ul className={`grid gap-1.5 sm:grid-cols-2 ${capCards}`}>
            {course.deps.map((id) => (
              <li key={id}>
                <CourseLinkCard courseId={id} search={search} from={course.id} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* The same cards as the prerequisites, at the same opacity the columns
          give a soft neighbour, so «bleached» means one thing on this screen:
          useful, not required, not counted in the path or the hours. */}
      {course.soft.length ? (
        <div>
          {/* The one heading on the screen naming a relation nobody has met
              before — «what has to come first» explains itself, «also useful»
              has to say what it is not: a gate, a step of the path, an hour in
              the estimate. That is a sentence, so it goes behind a mark. */}
          <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-ink-dim">
            {t('ui.course.recommends')}
            <Tooltip content={t('ui.course.recommendsHint')}>
              <button
                type="button"
                className="inline-flex cursor-help text-ink-faint transition-colors
                           duration-fast ease-out hover:text-ink-dim"
                aria-label={t('ui.course.recommendsHint')}
              >
                <Icon name="help" size={13} />
              </button>
            </Tooltip>
          </h3>
          <ul className={`grid gap-1.5 opacity-75 sm:grid-cols-2 ${capCards}`}>
            {course.soft.map((id) => (
              <li key={id}>
                <CourseLinkCard courseId={id} search={search} from={course.id} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {unlocks.length ? (
        <div>
          <h3 className="mb-2 text-sm font-medium">{t('ui.unlocks.title')}</h3>
          <ul className={`grid gap-1.5 sm:grid-cols-2 ${capCards}`}>
            {unlocks.map((step) => (
              <li key={step.id}>
                <CourseLinkCard
                  courseId={step.id}
                  search={search}
                  behind={step.behind}
                  from={course.id}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {hasPath ? (
        <PathBlock
          course={course}
          steps={steps}
          totalHours={totalHours}
          search={search}
          outsideFilter={outsideFilter}
          capped={!isMobile}
        />
      ) : null}

      {/* `related` has no direction — it is not before the course or after it,
          so a list of cards would promise an order it does not have. One line
          of names, under everything that does. */}
      {course.related.length ? (
        <p className="text-xs text-ink-faint">
          {t('ui.course.relatedTo')}:{' '}
          {course.related.map((id, index) => (
            <span key={id}>
              {index ? ', ' : ''}
              <Tooltip content={linkNote(course.id, id)}>
                <Link
                  to={courseHref(id, search)}
                  onMouseEnter={() => setEcho(id)}
                  onMouseLeave={() => setEcho(null)}
                  className="text-ink-dim hover:text-ink"
                >
                  {t(`course.${id}.title`)}
                </Link>
              </Tooltip>
            </span>
          ))}
        </p>
      ) : null}
    </>
  );

  if (!isMobile) {
    return <section className="space-y-4 border-t border-line px-4 py-4">{content}</section>;
  }

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
          {/* The line rolls up as the block rolls down, over the same duration:
              dropping it the moment the fold opens made one movement look like
              two, the text going first and the height following it. */}
          {/* No `block` here: it would win over the grid display the fold is
              made of, and the line would sit there invisible at full height. */}
          <span className="collapse" data-open={!open}>
            <span className="block text-xs text-ink-dim">
              {first}
              {first && figure ? ' · ' : null}
              {figure ? <span className="num">{figure}</span> : null}
            </span>
          </span>
        </span>
      </button>

      {/* The padding is a wrapper in, not on the row that animates: a closed
          fold is `0fr` of *content*, and 16 pixels of padding on the collapsing
          box itself stay behind as a strip of empty section. */}
      <div className="collapse" data-open={open}>
        <div>
          <div className="space-y-4 px-4 pb-4">{content}</div>
        </div>
      </div>
    </section>
  );
}
