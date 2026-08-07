import { useEffect, useMemo, useRef } from 'react';
import type { BuiltCourse } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { useReducedMotion } from '@/lib/hooks';
import { useHighlight } from '@/lib/highlight';
import { useUi } from '@/store/ui';
import { useProfile } from '@/store/profile';
import CourseCard from './CourseCard';

type Props = {
  courses: BuiltCourse[];
  visible: Set<string>;
  dimmed: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

/**
 * Columns, not a graph.
 *
 * A column is a level, and the level is the length of the longest chain of
 * prerequisites ending at the course — so reading left to right is reading the
 * order things must be studied in. That is the whole claim of the screen, and
 * it survives without a single line being drawn.
 *
 * Prerequisites are answered by pointing at a card (its dependencies light up,
 * everything else fades) and by the path list in the panel, which is a study
 * plan rather than a picture of one. Arrows over 200 cards were mostly noise:
 * at any useful zoom they crossed each other far more than they explained.
 *
 * Rows line up across columns because `row` is the card's index inside its
 * column and every card is the same height — so the build's ordering, which
 * pulls a course towards the height of its prerequisites, is visible as
 * alignment instead of as geometry.
 */
export default function ColumnsView({ courses, visible, dimmed, selectedId, onSelect }: Props) {
  const catalog = useCatalog();
  const { t, count } = useT();
  const reducedMotion = useReducedMotion();

  const hoveredId = useUi((state) => state.hoveredCourseId);
  const setHovered = useUi((state) => state.setHovered);
  const echoId = useUi((state) => state.echoCourseId);
  const focusRequest = useUi((state) => state.focusRequest);

  const profile = useProfile((state) => state.profile);
  const highlight = useHighlight(selectedId, hoveredId ?? echoId);

  const scrollRef = useRef<HTMLDivElement>(null);

  /**
   * One bucket per level, cards in `row` order. Filtered-out courses collapse
   * the column rather than leaving holes: a filter that shows three courses
   * spread over forty empty slots reads as a broken page.
   */
  const columns = useMemo(() => {
    const shown = courses.filter(
      (course) => visible.has(course.id) || dimmed.has(course.id)
    );
    const buckets = new Map<number, BuiltCourse[]>();
    for (const course of shown) {
      buckets.set(course.level, [...(buckets.get(course.level) ?? []), course]);
    }
    return [...buckets.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([level, list]) => ({
        level,
        courses: list.sort((a, b) => a.row - b.row),
      }));
  }, [courses, visible, dimmed]);

  const total = columns.reduce((sum, column) => sum + column.courses.length, 0);

  /** Bring a course into view when the path list or the search box asks for it. */
  useEffect(() => {
    if (!focusRequest) return;
    const card = scrollRef.current?.querySelector(`[data-course="${CSS.escape(focusRequest.courseId)}"]`);
    card?.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'center',
      inline: 'center',
    });
  }, [focusRequest, reducedMotion]);

  if (!total) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-faint">
        {t('ui.graph.empty')}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="h-full overflow-auto"
      role="region"
      aria-label={t('ui.a11y.graphRegion')}
    >
      <div className="flex items-start gap-6 p-5">
        {columns.map((column) => (
          <section key={column.level} className="shrink-0">
            <header
              className="sticky top-0 z-10 mb-3 flex items-baseline gap-2 bg-canvas/85
                         pb-2 pt-1 backdrop-blur"
            >
              <h2 className="num text-xs font-semibold uppercase tracking-wide text-ink-dim">
                {t('ui.column.level', { n: column.level + 1 })}
              </h2>
              <span className="num text-[11px] text-ink-faint">
                {count(column.courses.length, 'course')}
              </span>
            </header>

            <ul className="flex flex-col gap-5">
              {column.courses.map((course) => (
                <li key={course.id}>
                  <CourseCard
                    course={course}
                    domain={catalog.domainById.get(course.domains[0])}
                    emphasis={highlight.active ? highlight.emphasisOf(course.id) : 'self'}
                    // The signature effect: the chain lights up right to left.
                    delay={reducedMotion || !highlight.pinned ? 0 : highlight.depthOf(course.id) * 40}
                    selected={course.id === selectedId}
                    status={profile.courses[course.id]?.status ?? null}
                    favorite={profile.courses[course.id]?.favorite ?? false}
                    dimmedByFilter={dimmed.has(course.id)}
                    onSelect={onSelect}
                    onHover={setHovered}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
