import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BuiltCourse } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { useIsDesktop, useReducedMotion } from '@/lib/hooks';
import { useHighlight } from '@/lib/highlight';
import { CARD_WIDTH } from '@/lib/layout';
import { useUi } from '@/store/ui';
import { useProfile } from '@/store/profile';
import Icon from '@/components/Icon';
import CourseCard from './CourseCard';
import ChainLinks, { type Link } from './ChainLinks';

type Props = {
  courses: BuiltCourse[];
  visible: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeselect: () => void;
};

/** How far one arrow click travels: a column plus the gap between columns. */
const COLUMN_STEP = CARD_WIDTH + 24;

/**
 * Columns, not a graph.
 *
 * A column is a level, and the level is the length of the longest chain of
 * prerequisites ending at the course — so reading left to right is reading the
 * order things must be studied in. That is the whole claim of the screen, and
 * it survives without a single line being drawn.
 *
 * Lines are drawn for one thing only: the chain of the course in hand. Over two
 * hundred cards they were noise, crossing each other far more than they
 * explained; over the six or seven cards of one path they answer the question
 * the columns cannot — *which* of the cards on the left this one needs.
 *
 * Rows line up across columns because `row` is the card's index inside its
 * column and every card is the same height — so the build's ordering, which
 * pulls a course towards the height of its prerequisites, is visible as
 * alignment instead of as geometry.
 */
export default function ColumnsView({
  courses,
  visible,
  selectedId,
  onSelect,
  onDeselect,
}: Props) {
  const catalog = useCatalog();
  const { t } = useT();
  const reducedMotion = useReducedMotion();
  const isDesktop = useIsDesktop();

  const hoveredId = useUi((state) => state.hoveredCourseId);
  const setHovered = useUi((state) => state.setHovered);
  const echoId = useUi((state) => state.echoCourseId);
  const focusRequest = useUi((state) => state.focusRequest);

  const profile = useProfile((state) => state.profile);
  const highlight = useHighlight(selectedId, hoveredId ?? echoId);
  /**
   * The same reading of the graph with the pointer taken out of it — what the
   * curves are drawn from.
   *
   * Hover is allowed to repaint the cards, because that is a glance and it ends
   * when the pointer moves on. It is not allowed to touch the lines: they are
   * drawn, and a drawing that erases and redraws itself every time the pointer
   * crosses a card is a strobe. Keeping this separate is also what keeps its
   * identity stable across a hover, so the curves are not remounted and do not
   * play their draw-in again.
   */
  const pinnedChain = useHighlight(selectedId, null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const [pulsingId, setPulsingId] = useState<string | null>(null);

  /**
   * One bucket per level, cards in `row` order. Filtered-out courses collapse
   * the column rather than leaving holes: a filter that shows three courses
   * spread over forty empty slots reads as a broken page.
   */
  const columns = useMemo(() => {
    const shown = courses.filter((course) => visible.has(course.id));
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
  }, [courses, visible]);

  const total = columns.reduce((sum, column) => sum + column.courses.length, 0);

  /**
   * The edges of the chain, as pairs of course ids.
   *
   * A selection's, and nothing else's — pointing at a card asks a question of
   * the cards, not of the curves already on screen.
   */
  const links = useMemo<Link[]>(() => {
    if (!pinnedChain.active) return [];
    const chain = new Set<string>();
    for (const column of columns) {
      for (const course of column.courses) {
        const emphasis = pinnedChain.emphasisOf(course.id);
        if (emphasis !== 'soft' && emphasis !== 'related' && emphasis !== 'muted') {
          chain.add(course.id);
        }
      }
    }
    const out: Link[] = [];
    for (const id of chain) {
      for (const dep of catalog.courseById.get(id)?.deps ?? []) {
        if (chain.has(dep)) out.push({ from: dep, to: id, depth: pinnedChain.depthOf(dep) });
      }
    }
    return out.sort((a, b) => a.depth - b.depth);
  }, [pinnedChain, columns, catalog]);

  /**
   * A card that unmounts under the cursor — a filter change, a domain switch —
   * never gets its `pointerleave`, and the hover highlight would stay pinned to
   * a course that is no longer on screen.
   */
  useEffect(() => {
    if (hoveredId && !columns.some((column) => column.courses.some((c) => c.id === hoveredId))) {
      setHovered(null);
    }
  }, [columns, hoveredId, setHovered]);

  /**
   * Bring a course into view when the path list or the search box asks for it,
   * then pulse its ring once. A smooth scroll that ends somewhere in a field of
   * identical cards leaves you looking for what moved; the pulse says which one
   * the trip was for.
   */
  useEffect(() => {
    if (!focusRequest) return;
    const card = scrollRef.current?.querySelector(`[data-course="${CSS.escape(focusRequest.courseId)}"]`);
    card?.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'center',
      inline: 'center',
    });
    setPulsingId(focusRequest.courseId);
    const timer = setTimeout(() => setPulsingId(null), 700);
    return () => clearTimeout(timer);
  }, [focusRequest, reducedMotion]);

  /** Which way there is more to see — drives both the fades and the arrows. */
  const readEdges = useCallback(() => {
    const node = scrollRef.current;
    if (!node) return;
    setEdges({
      start: node.scrollLeft <= 1,
      end: node.scrollLeft + node.clientWidth >= node.scrollWidth - 1,
    });
  }, []);

  /**
   * Opening the panel takes half the width away from the columns, and the card
   * that was selected is often exactly what disappears under it — you click a
   * course and it vanishes. Any change of the scroller's width brings the
   * selection back into view; plain scrolling never does, so this cannot fight
   * someone who has deliberately scrolled elsewhere.
   */
  const lastWidth = useRef(0);

  useEffect(() => {
    readEdges();
    const node = scrollRef.current;
    if (!node) return;

    const observer = new ResizeObserver(() => {
      readEdges();
      const width = node.clientWidth;
      if (width === lastWidth.current) return;
      lastWidth.current = width;
      if (!selectedId) return;
      node
        .querySelector(`[data-course="${CSS.escape(selectedId)}"]`)
        ?.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [readEdges, columns, selectedId]);

  const nudge = (direction: -1 | 1): void =>
    scrollRef.current?.scrollBy({
      left: direction * COLUMN_STEP,
      behavior: reducedMotion ? 'auto' : 'smooth',
    });

  if (!total) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-faint">
        {t('ui.graph.empty')}
      </div>
    );
  }

  return (
    /*
     * The group wrapper carries the affordances, not the scroller: a card at
     * the cut used to be simply sliced in half, which reads as a broken layout
     * rather than as "there is more this way".
     */
    <div className="group relative h-full">
      <div
        ref={scrollRef}
        onScroll={readEdges}
        className="h-full overflow-auto"
        role="region"
        aria-label={t('ui.a11y.graphRegion')}
        // Clicking the background drops the selection, the way clicking away from
        // a shape in any canvas does. Guarded on `[data-course]` so it only fires
        // for clicks that missed every card.
        onClick={(event) => {
          if (!selectedId) return;
          if ((event.target as HTMLElement).closest('[data-course]')) return;
          onDeselect();
        }}
      >
        <div className="relative flex min-w-max items-start gap-6 p-5">
          <ChainLinks
            scrollRef={scrollRef}
            links={links}
            revision={`${selectedId}:${columns.length}:${total}`}
            animate={!reducedMotion}
          />

          {columns.map((column) => (
            <section key={column.level} className="relative shrink-0">
              <header
                // Same z as the curve layer, later in the document: the label a
                // column is holding at the top of the screen is chrome, and a
                // prerequisite line running through it is the one place the
                // curves are not welcome.
                className="on-canvas sticky top-0 z-20 mb-3 flex items-baseline gap-2
                           pb-2 pt-1 backdrop-blur"
              >
                <h2 className="mono-label text-ink-dim">
                  {t('ui.column.level', { n: column.level + 1 })}
                </h2>
              </header>

              <ul className="flex flex-col gap-5">
                {column.courses.map((course) => {
                  const emphasis = highlight.active ? highlight.emphasisOf(course.id) : 'self';
                  return (
                    <li key={course.id}>
                      <CourseCard
                        course={course}
                        domain={catalog.domainById.get(course.domains[0])}
                        emphasis={emphasis}
                        // The signature effect: the chain lights up right to left.
                        delay={
                          reducedMotion || !highlight.pinned ? 0 : highlight.depthOf(course.id) * 30
                        }
                        selected={course.id === selectedId}
                        inPath={
                          highlight.pinned &&
                          course.id !== selectedId &&
                          (emphasis === 'direct' || emphasis === 'transitive')
                        }
                        pulsing={course.id === pulsingId}
                        status={profile.courses[course.id]?.status ?? null}
                        favorite={profile.courses[course.id]?.favorite ?? false}
                        onSelect={onSelect}
                        onHover={setHovered}
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>

      <EdgeFade side="left" hidden={edges.start} onNudge={() => nudge(-1)} showArrow={isDesktop} />
      <EdgeFade side="right" hidden={edges.end} onNudge={() => nudge(1)} showArrow={isDesktop} />
    </div>
  );
}

/**
 * The soft cut at each end of the scroller, plus the arrow that jumps a column.
 *
 * The gradient is the honest signal — it is there whether or not anyone has a
 * pointer — and it disappears at the ends, so "nothing more this way" is also
 * said. The arrow is the convenience on top, and only for pointers.
 */
function EdgeFade({
  side,
  hidden,
  onNudge,
  showArrow,
}: {
  side: 'left' | 'right';
  hidden: boolean;
  onNudge: () => void;
  showArrow: boolean;
}) {
  const { t } = useT();
  const left = side === 'left';

  return (
    <div
      className={`fade-only pointer-events-none absolute inset-y-0 z-20 flex w-12 items-center
                  transition-opacity duration-base ease-out
                  ${left ? 'left-0 justify-start' : 'right-0 justify-end'}
                  ${hidden ? 'opacity-0' : 'opacity-100'}`}
      style={{
        background: `linear-gradient(to ${left ? 'right' : 'left'},
                     var(--c-canvas), transparent)`,
      }}
    >
      {showArrow ? (
        <button
          type="button"
          tabIndex={-1}
          onClick={onNudge}
          aria-hidden="true"
          className={`pointer-events-auto ml-1 mr-1 flex h-8 w-8 items-center justify-center
                      rounded-full border border-line bg-surface text-ink-dim opacity-0
                      shadow-[var(--shadow-pop)] transition-opacity duration-fast ease-out
                      hover:text-ink group-hover:opacity-100
                      ${hidden ? 'invisible' : ''}`}
          title={left ? t('ui.column.scrollLeft') : t('ui.column.scrollRight')}
        >
          <Icon name={left ? 'chevron-left' : 'chevron-right'} size={16} />
        </button>
      ) : null}
    </div>
  );
}
