import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BuiltCourse } from '@shared/schema';
import { useT } from '@/i18n';
import { pathTo, useCatalog } from '@/lib/catalog';
import { loadPlaylists } from '@/lib/data';
import { formatHours } from '@/lib/format';
import { courseHref } from '@/lib/url';
import { useProfile } from '@/store/profile';
import { useUi } from '@/store/ui';
import Icon from '@/components/Icon';

type Props = {
  course: BuiltCourse;
  search: string;
  /** Path courses that the active domain filter would otherwise hide. */
  outsideFilter: number;
};

/**
 * The path to a course: the full transitive `deps` closure, ordered by level,
 * which is a correct order to study them in. Collapsed by default — the summary
 * line carries the number that matters, and the total hours are the most
 * motivating and most sobering figure on the site.
 */
export default function PathBlock({ course, search, outsideFilter }: Props) {
  const catalog = useCatalog();
  const { t, count, lang } = useT();
  const profile = useProfile((state) => state.profile);
  const setEcho = useUi((state) => state.setEcho);
  const requestFocus = useUi((state) => state.requestFocus);

  const [open, setOpen] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const [exportState, setExportState] = useState<'idle' | 'working' | 'done'>('idle');

  const steps = useMemo(() => [...pathTo(catalog, course.id), course], [course, catalog]);

  const doneCount = steps.filter((step) => profile.courses[step.id]?.status === 'done').length;
  const totalHours = steps.reduce((sum, step) => sum + step.hours, 0);

  if (steps.length < 2) {
    return (
      <section className="border-t border-line px-4 py-3">
        <p className="text-sm text-ink-faint">{t('ui.path.empty')}</p>
      </section>
    );
  }

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
    <section className="border-t border-line">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm hover:bg-surface-2"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} className="text-ink-faint" />
        <span className="font-medium">{t('ui.path.title')}:</span>
        <span className="num text-ink-dim">
          {t('ui.path.summary', {
            courses: count(steps.length, 'course'),
            hours: formatHours(totalHours),
            done: doneCount,
          })}
        </span>
      </button>

      {open ? (
        <div className="px-4 pb-4">
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
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={exportPlan}
              disabled={exportState === 'working'}
            >
              <Icon name="download" size={13} />
              {exportState === 'done' ? t('ui.common.copied') : t('ui.path.export')}
            </button>
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
                    <StatusMark status={status} goal={isGoal} />
                    <span className="min-w-0 flex-1 truncate">
                      {t(`course.${step.id}.title`)}
                    </span>
                    {isGoal ? (
                      <span className="shrink-0 text-[11px] text-accent">← {t('ui.path.goal')}</span>
                    ) : (
                      <span
                        className="num shrink-0 text-[11px]"
                        style={{ color: domain?.color }}
                        title={new Intl.NumberFormat(lang).format(step.hours)}
                      >
                        {step.hours ? `${formatHours(step.hours)} ч` : ''}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

function StatusMark({ status, goal }: { status: string | null; goal: boolean }) {
  if (goal) return <span className="w-3.5 text-center text-accent">●</span>;
  if (status === 'done') return <Icon name="check" size={13} className="text-accent" />;
  if (status === 'in_progress') return <Icon name="half" size={13} className="text-formal" />;
  return <span className="w-3.5 text-center text-ink-faint">○</span>;
}
