import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { BuiltCourse } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { loadPlaylists } from '@/lib/data';
import { formatHours, inkOn } from '@/lib/format';
import { courseHref } from '@/lib/url';
import { useProfile, useResolvedTheme } from '@/store/profile';
import { useUi } from '@/store/ui';
import Icon from '@/components/Icon';
import { Button } from '@/components/ui';
import { StatusMark } from './CourseMarks';

type Props = {
  course: BuiltCourse;
  /** The path itself, worked out by `LinksBlock`: the closure, then the goal. */
  steps: BuiltCourse[];
  doneCount: number;
  totalHours: number;
  search: string;
  /** Path courses that the active domain filter would otherwise hide. */
  outsideFilter: number;
};

/**
 * The path to a course: the full transitive `deps` closure, ordered by level,
 * which is a correct order to study them in. Folded inside a block that is
 * itself foldable, because the summary line answers the question most of the
 * way — the total hours are the most motivating and most sobering figure on the
 * site — and the twelve steps under it are a plan, read once.
 */
export default function PathBlock({
  course,
  steps,
  doneCount,
  totalHours,
  search,
  outsideFilter,
}: Props) {
  const scheme = useResolvedTheme();
  const catalog = useCatalog();
  const { t, count, lang } = useT();
  const profile = useProfile((state) => state.profile);
  const setEcho = useUi((state) => state.setEcho);
  const requestFocus = useUi((state) => state.requestFocus);

  const [open, setOpen] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [exportState, setExportState] = useState<'idle' | 'working' | 'done'>('idle');

  const exportPlan = async (): Promise<void> => {
    setExportState('working');
    const shards = await Promise.all(steps.map((step) => loadPlaylists(step.id)));
    const lines = steps.map((step, index) => {
      const best = shards[index][0];
      const title = t(`course.${step.id}.title`);
      const status = profile.courses[step.id]?.status === 'done' ? 'x' : ' ';
      const link = best
        ? ` — [${best.title}](https://www.youtube.com/playlist?list=${best.id})`
        : '';
      return `- [${status}] ${index + 1}. ${title}${link}`;
    });
    const markdown = [
      `# ${t(`course.${course.id}.title`)}`,
      '',
      `${count(steps.length, 'course')}, ≈${formatHours(totalHours)} ${t('ui.plural.hour.many')}`,
      '',
      ...lines,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(markdown);
    } catch {
      // Clipboard can be blocked; the download below still delivers the plan.
    }
    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${course.id}-plan.md`;
    anchor.click();
    URL.revokeObjectURL(url);

    setExportState('done');
    setTimeout(() => setExportState('idle'), 2000);
  };

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
        <span className="num min-w-0 text-ink-dim">
          {t('ui.path.summary', {
            courses: count(steps.length, 'course'),
            hours: formatHours(totalHours),
            done: doneCount,
          })}
        </span>
      </button>

      <div className="collapse" data-open={open}>
        <div className="pt-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-faint">
              <input
                type="checkbox"
                checked={hideDone}
                onChange={(event) => setHideDone(event.target.checked)}
                className="accent-[var(--c-accent)]"
              />
              {t('ui.path.hideDone')}
            </label>
            <Button
              variant="ghost"
              small
              icon="download"
              iconSize={13}
              onClick={exportPlan}
              disabled={exportState === 'working'}
            >
              {exportState === 'done' ? t('ui.common.copied') : t('ui.path.export')}
            </Button>
          </div>

          {outsideFilter ? (
            <p className="mb-2 text-xs text-ink-faint">{t('ui.path.breaksFilter')}</p>
          ) : null}

          <ol className="space-y-0.5">
            {steps.map((step, index) => {
              const status = profile.courses[step.id]?.status ?? null;
              const isGoal = step.id === course.id;
              if (hideDone && status === 'done' && !isGoal) return null;
              const domain = catalog.domainById.get(step.domains[0]);

              return (
                <li key={step.id}>
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
                      <span className="shrink-0 text-[11px] text-accent">← {t('ui.path.goal')}</span>
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
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}

