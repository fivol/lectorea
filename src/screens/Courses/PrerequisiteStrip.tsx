import type { BuiltCourse } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { withAlpha } from '@/lib/format';
import { useUi } from '@/store/ui';
import CourseArt from '@/components/CourseArt';
import Icon from '@/components/Icon';

type Props = {
  course: BuiltCourse;
  onSelect: (id: string) => void;
};

/**
 * The direct prerequisites of the selected course, as a band above the columns.
 *
 * The columns now hold one field at a time, so a prerequisite from another field
 * is not in them at all — and hunting for one that *is* means scanning back
 * across several levels. Both cases are the same question, and this answers it
 * in one place, at the top, where the answer is needed before anything else on
 * the screen matters.
 *
 * Direct only. The full chain is a study plan and belongs in the panel's path
 * block; a strip of ten cards would be a second, worse copy of it. Courses have
 * at most three direct prerequisites, so this never needs to scroll in practice.
 *
 * Every prerequisite is listed, including ones already visible in the columns.
 * Showing only the missing ones would make the count depend on the filter, so
 * "requires 1" would sometimes mean "requires 3, two of them elsewhere".
 */
export default function PrerequisiteStrip({ course, onSelect }: Props) {
  const catalog = useCatalog();
  const { t, count } = useT();
  const setEcho = useUi((state) => state.setEcho);

  const deps = course.deps
    .map((id) => catalog.courseById.get(id))
    .filter((item): item is BuiltCourse => Boolean(item))
    .sort((a, b) => a.level - b.level || a.row - b.row);

  if (!deps.length) return null;

  return (
    <section className="shrink-0 border-b border-line bg-surface/40 px-5 py-2.5">
      <div className="mb-2 flex items-baseline gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-dim">
          {t('ui.course.requires')}
        </h2>
        <span className="num text-[11px] text-ink-faint">{count(deps.length, 'course')}</span>
      </div>

      <ul className="flex gap-2 overflow-x-auto pb-0.5">
        {deps.map((dep) => {
          const domain = catalog.domainById.get(dep.domains[0]);
          const colour = domain?.color ?? 'var(--c-formal)';
          return (
            <li key={dep.id}>
              <button
                type="button"
                onClick={() => onSelect(dep.id)}
                onPointerEnter={() => setEcho(dep.id)}
                onPointerLeave={() => setEcho(null)}
                className="flex w-[264px] items-center gap-2.5 rounded-lg border bg-surface p-2
                           text-left transition-colors hover:border-accent"
                style={{ borderColor: withAlpha(colour, 0.45) }}
              >
                <span className="h-10 w-14 shrink-0 overflow-hidden rounded">
                  <CourseArt courseId={dep.id} color={colour} className="h-full w-full" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-ink">
                    {t(`course.${dep.id}.title`)}
                  </span>
                  <span className="num block truncate text-[11px] text-ink-faint">
                    {domain ? t(`domain.${domain.id}.title`) : ''} · {t(`ui.stage.${dep.stage}`)}
                  </span>
                </span>
                <Icon name="chevron-right" size={13} className="shrink-0 text-ink-faint" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
