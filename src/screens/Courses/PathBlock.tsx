import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BuiltCourse } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { formatHours, inkOn } from '@/lib/format';
import { pathProgress, percent, useCourseProgress } from '@/lib/progress';
import { courseHref } from '@/lib/url';
import { useProfile, useResolvedTheme } from '@/store/profile';
import { useUi } from '@/store/ui';
import Icon from '@/components/Icon';
import ProgressBar from '@/components/ProgressBar';
import Tooltip from '@/components/Tooltip';
import { StatusMark } from './CourseMarks';

type Props = {
  course: BuiltCourse;
  /** The path itself, worked out by `LinksBlock`: the closure, then the goal. */
  steps: BuiltCourse[];
  totalHours: number;
  search: string;
  /** Cap the list and let it scroll — see `LinksBlock`. */
  capped: boolean;
};

/**
 * The path to a course: the full transitive `deps` closure, ordered by level,
 * which is a correct order to study them in. Folded, because the summary line
 * answers the question most of the way — the total hours are the most
 * motivating and most sobering figure on the site — and the twelve steps under
 * it are a plan, read once.
 */
export default function PathBlock({
  course,
  steps,
  totalHours,
  search,
  capped,
}: Props) {
  const scheme = useResolvedTheme();
  const catalog = useCatalog();
  const { t, count, lang } = useT();
  const profile = useProfile((state) => state.profile);
  const setEcho = useUi((state) => state.setEcho);
  const requestFocus = useUi((state) => state.requestFocus);

  const [open, setOpen] = useState(false);
  const [hideDone, setHideDone] = useState(false);

  const stepIds = useMemo(() => steps.map((step) => step.id), [steps]);
  const byCourse = useCourseProgress(stepIds);
  const path = pathProgress(
    stepIds,
    (id) => profile.courses[id]?.status === 'done',
    (id) => byCourse.get(id) ?? null
  );
  const doneCount = path.done;
  const remainingHours = steps
    .filter((step) => profile.courses[step.id]?.status !== 'done')
    .reduce((sum, step) => sum + step.hours, 0);

  /* The goal stays on screen whatever its state, so a path whose only done
     course is the goal has nothing the checkbox could hide — and an offer to
     hide nothing reads as a broken control. */
  const hidable = steps.some(
    (step) => step.id !== course.id && profile.courses[step.id]?.status === 'done'
  );
  const hiding = hideDone && hidable;

  return (
    <div>
      <button
        type="button"
        className="-mx-2 flex w-[calc(100%+1rem)] items-start gap-2 rounded px-2 py-1.5 text-left
                   text-sm transition-colors duration-fast ease-out hover:bg-surface-2"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <Icon
          name="chevron-right"
          size={14}
          className={`mt-[3px] shrink-0 text-ink-faint transition-transform duration-fast ease-out
                      ${open ? 'rotate-90' : ''}`}
        />
        <span className="shrink-0 font-medium">{t('ui.path.title')}:</span>
        {/* The hours in this line are a sum of estimates, and each estimate is a
            median over recordings — two rules deep, and neither of them
            guessable from «≈78 ч». The bubble sits on the figure rather than on
            the row: the row is the fold, and it has its own job. */}
        <Tooltip content={t('ui.legend.pathHours')}>
          <span className="num min-w-0 cursor-help text-ink-dim">
            {t('ui.path.summary', {
              courses: count(steps.length, 'course'),
              hours: formatHours(totalHours),
              done: doneCount,
            })}
          </span>
        </Tooltip>
      </button>

      {/* Outside the fold, and only once there is progress to show: how much of
          the path is done is the one thing worth seeing without opening it,
          while an empty bar over «0 из 7» is forty pixels saying the same as
          the line above.

          Lectures count towards it as the fraction of a course they are, so
          three weeks into a forty-hour prerequisite the bar has moved even
          though the count has not. */}
      {doneCount || path.partial ? (
        <div className="pt-2">
          <ProgressBar
            done={doneCount}
            total={steps.length}
            partial={path.partial}
            label={`${percent(path.fraction)}% · ${t('ui.profile.progress', {
              done: doneCount,
              total: steps.length,
            })}`}
          />
          {/* What «осталось» leaves out is the course in hand: three weeks into
              a forty-hour prerequisite it is still charging forty, because the
              hours come from the catalogue and the ticks are in the bar above.
              The bubble is the only place that can say so. */}
          <Tooltip content={t('ui.legend.remaining')} tap>
            <p className="num mt-1 w-fit cursor-help text-[11px] text-ink-faint">
              {t('ui.profile.remaining', { hours: formatHours(remainingHours) })}
            </p>
          </Tooltip>
        </div>
      ) : null}

      {/* The padding sits inside the collapsing box rather than on it: `0fr`
          closes the content, and padding on the row itself stays behind. */}
      <div className="collapse" data-open={open}>
        <div>
          <div className="pt-2">
            {hidable ? (
              <label className="mb-2 flex w-fit cursor-pointer items-center gap-2 text-xs text-ink-faint">
                <input
                  type="checkbox"
                  checked={hideDone}
                  onChange={(event) => setHideDone(event.target.checked)}
                  className="accent-[var(--c-accent)]"
                />
                {t('ui.path.hideDone')}
              </label>
            ) : null}

            <ol
              className={`space-y-0.5 ${
                capped ? 'max-h-[11rem] overflow-y-auto overscroll-contain pr-1' : ''
              }`}
            >
              {steps.map((step, index) => {
                const status = profile.courses[step.id]?.status ?? null;
                const isGoal = step.id === course.id;
                if (hiding && status === 'done' && !isGoal) return null;
                const domain = catalog.domainById.get(step.domains[0]);

                const watched = status === 'done' ? null : byCourse.get(step.id);

                return (
                  <li key={step.id} className="relative">
                    <Link
                      to={courseHref(step.id, search)}
                      onMouseEnter={() => setEcho(step.id)}
                      onMouseLeave={() => setEcho(null)}
                      onClick={() => requestFocus(step.id)}
                      className={`flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-2
                                  ${status === 'done' ? 'text-ink-faint' : 'text-ink-dim'}
                                  ${isGoal ? 'font-semibold text-ink' : ''}`}
                    >
                      <span className="num w-5 shrink-0 text-right text-xs text-ink-faint">
                        {index + 1}.
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {t(`course.${step.id}.title`)}
                      </span>
                      {/* The same plate the cards wear, on the same side as the
                          hours: a state worth marking says itself in a word, and
                          an untouched step says it by carrying no mark at all.
                          Four dots in a column, told apart by colour and by a
                          tooltip that a phone never shows, said none of that. */}
                      {status ? <StatusMark status={status} /> : null}
                      {isGoal ? (
                        <span className="shrink-0 text-[11px] text-accent">
                          ← {t('ui.path.goal')}
                        </span>
                      ) : (
                        <span
                          className="num shrink-0 text-[11px]"
                          // Text, so the field's hue is taken at reading strength:
                          // a biome ramp runs from basalt to chalk and both ends
                          // vanish into one scheme or the other.
                          style={{ color: domain ? inkOn(domain.color, scheme) : undefined }}
                          title={new Intl.NumberFormat(lang).format(step.hours)}
                        >
                          {step.hours
                            ? t('ui.playlist.hours', { n: formatHours(step.hours) })
                            : ''}
                        </span>
                      )}
                    </Link>
                    {/* How far into this one step, along the foot of its row.
                        The plate above says «Изучается», which is true of a
                        first lecture and of a twenty-ninth alike; this is the
                        part of the answer a word cannot carry. */}
                    {watched?.started && !watched.complete ? (
                      <span
                        className="pointer-events-none absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-surface-2"
                        title={t('ui.course.lecturesDone', {
                          done: watched.done,
                          total: watched.total,
                        })}
                      >
                        <span
                          className="block h-full rounded-full bg-accent/60"
                          style={{ width: `${percent(watched.fraction)}%` }}
                        />
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

