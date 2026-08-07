import { useMemo, useState } from 'react';
import type { BuiltCourse } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { useProfile } from '@/store/profile';
import CourseArt from '@/components/CourseArt';
import Icon from '@/components/Icon';

type Props = {
  courses: BuiltCourse[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

/**
 * A graph is unreadable on a phone. The replacement is a vertical list grouped
 * by level, which keeps the one thing the graph is for — what comes before what
 * — and drops the part that needs a mouse.
 */
export default function MobileCourseList({ courses, selectedId, onSelect }: Props) {
  const { t, count } = useT();
  const catalog = useCatalog();
  const profile = useProfile((state) => state.profile);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const levels = useMemo(() => {
    const map = new Map<number, BuiltCourse[]>();
    for (const course of courses) {
      map.set(course.level, [...(map.get(course.level) ?? []), course]);
    }
    return [...map.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([level, list]) => ({
        level,
        list: list.sort((a, b) =>
          t(`course.${a.id}.title`).localeCompare(t(`course.${b.id}.title`))
        ),
      }));
  }, [courses, t]);

  const toggle = (level: number): void =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });

  if (!courses.length) {
    return <p className="px-4 py-10 text-center text-sm text-ink-faint">{t('ui.graph.empty')}</p>;
  }

  return (
    <div className="pb-24">
      {levels.map(({ level, list }) => (
        <section key={level}>
          <button
            type="button"
            className="sticky top-0 z-10 flex w-full items-center gap-2 border-b border-line
                       bg-canvas/95 px-4 py-2 text-left backdrop-blur"
            onClick={() => toggle(level)}
            aria-expanded={!collapsed.has(level)}
          >
            <Icon
              name={collapsed.has(level) ? 'chevron-right' : 'chevron-down'}
              size={13}
              className="text-ink-faint"
            />
            <span className="text-xs uppercase tracking-wide text-ink-faint">
              {t('ui.mobile.levelGroup', { n: level + 1 })}
            </span>
            <span className="num ml-auto text-xs text-ink-faint">{list.length}</span>
          </button>

          {collapsed.has(level)
            ? null
            : list.map((course) => {
                const domain = catalog.domainById.get(course.domains[0]);
                const status = profile.courses[course.id]?.status ?? null;
                const favorite = profile.courses[course.id]?.favorite ?? false;
                return (
                  <button
                    key={course.id}
                    type="button"
                    onClick={() => onSelect(course.id)}
                    className={`flex w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left
                                ${course.id === selectedId ? 'bg-surface-2' : ''}`}
                  >
                    <span className="h-10 w-14 shrink-0 overflow-hidden rounded">
                      <CourseArt
                        courseId={course.id}
                        color={domain?.color ?? 'var(--c-formal)'}
                        className="h-full w-full"
                      />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-ink">
                        {t(`course.${course.id}.title`)}
                      </span>
                      {course.deps.length ? (
                        <span className="block truncate text-xs text-ink-faint">
                          {t('ui.course.requires')}:{' '}
                          {course.deps.map((id) => t(`course.${id}.title`)).join(', ')}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {favorite ? <Icon name="star-filled" size={12} className="text-social" /> : null}
                      {status === 'done' ? <Icon name="check" size={12} className="text-accent" /> : null}
                      <span className="num text-xs text-ink-faint">
                        {course.playlistCount || t('ui.course.noMaterials')}
                      </span>
                      <Icon name="chevron-right" size={13} className="text-ink-faint" />
                    </span>
                  </button>
                );
              })}
        </section>
      ))}
      <p className="px-4 pt-4 text-center text-xs text-ink-faint">
        {count(courses.length, 'course')}
      </p>
    </div>
  );
}
