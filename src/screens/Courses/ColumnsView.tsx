import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BuiltCourse } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { useIsDesktop, useReducedMotion } from '@/lib/hooks';
import { useHighlight } from '@/lib/highlight';
import { CARD_WIDTH, COLUMN_GAP } from '@/lib/layout';
import { useUi } from '@/store/ui';
import { useProfile } from '@/store/profile';
import Icon from '@/components/Icon';
import CourseCard from './CourseCard';
import ChainLinks, { type Link } from './ChainLinks';

type Props = {
  courses: BuiltCourse[];
  visible: Set<string>;
  /** Of the visible ones, those the filter does not actually cover — see below. */
  guests: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDeselect: () => void;
};

/** How far one arrow click travels: a column plus the gap between columns. */
const COLUMN_STEP = CARD_WIDTH + COLUMN_GAP;

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
  guests,
  selectedId,
  onSelect,
  onDeselect,
}: Props) {
  const catalog = useCatalog();
  const { t } = useT();
  const reducedMotion = useReducedMotion();
  const isDesktop = useIsDesktop();

  /**
   * The card a name in the panel is pointing at.
   *
   * Set by hovering a prerequisite, a next course or a step of the path — the
   * one case where something outside the columns has to say «this one». It
   * lifts that card and nothing else: the reading of the screen belongs to the
   * selection, and a glance at a list on the right is not a new selection.
   */
  const echoId = useUi((state) => state.echoCourseId);
  const focusRequest = useUi((state) => state.focusRequest);

  const profile = useProfile((state) => state.profile);
  /** Every edge of the chain, or the tree it cuts back to — see `links`. */
  const fullGraph = profile.settings.fullGraph;
  const highlight = useHighlight(selectedId);

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
   *
   * Two sides, and only two: the tree of prerequisites that leads to the
   * selection, and one hop out to what it opens. Every edge therefore touches
   * the selected course or something on the way to it. Drawing *every* edge
   * between lit cards also caught the links among the courses it opens to each
   * other — biochemistry into molecular biology while cell biology was the one
   * selected — and those are both the longest sweeps on screen and the ones
   * that answer a question nobody asked.
   *
   * How many of them are drawn is the reader's, and `fullGraph` is the switch.
   * Off, the chain is cut back to a tree rooted at the selected course: every
   * other card keeps one of the edges leading out of it — towards the course
   * that needs it — and drops the rest, so following a line from any card still
   * arrives at the selection and no card is left with nothing drawn to it. That
   * is a real loss and not a tidying: `deps` is already a transitive reduction,
   * the build warns on any edge the graph implies, so of the 1085 edges drawn
   * across every chain in the catalogue exactly none are redundant. The 177 a
   * tree drops, a sixth of them, are the second prerequisites of the 70 courses
   * that have more than one — biochemistry needs organic chemistry *and* cell
   * biology, and with the switch off only one of those is drawn. Which is why
   * it is a switch and not a decision made here: «Опирается на» in the panel
   * goes on naming every one of them either way.
   *
   * The parent kept is the nearest course that needs this one — fewest columns
   * to the right, then nearest row — because a tree drawn with short edges is
   * the whole reason for asking for a tree.
   */
  const links = useMemo<Link[]>(() => {
    const focus = highlight.focusId;
    if (!highlight.active || !focus) return [];

    const upstream = new Set<string>();
    const opened = new Set<string>();
    for (const column of columns) {
      for (const course of column.courses) {
        const emphasis = highlight.emphasisOf(course.id);
        if (emphasis === 'self' || emphasis === 'direct' || emphasis === 'transitive') {
          upstream.add(course.id);
        } else if (emphasis === 'downstream') {
          opened.add(course.id);
        }
      }
    }

    const depsOn = (id: string): string[] =>
      (catalog.courseById.get(id)?.deps ?? []).filter((dep) => upstream.has(dep));

    /** The one course each card is hung under when the graph is cut to a tree. */
    const parentOf = new Map<string, string>();
    if (!fullGraph) {
      const needs = new Map<string, BuiltCourse[]>();
      for (const id of upstream) {
        const course = catalog.courseById.get(id);
        if (!course) continue;
        for (const dep of depsOn(id)) needs.set(dep, [...(needs.get(dep) ?? []), course]);
      }
      for (const [dep, dependants] of needs) {
        const here = catalog.courseById.get(dep);
        const nearest = dependants.reduce((best, course) => {
          if (course.level !== best.level) return course.level < best.level ? course : best;
          const reach = Math.abs(course.row - (here?.row ?? 0));
          const bestReach = Math.abs(best.row - (here?.row ?? 0));
          return reach < bestReach ? course : best;
        });
        parentOf.set(dep, nearest.id);
      }
    }

    const out: Link[] = [];
    for (const id of upstream) {
      for (const dep of depsOn(id)) {
        // A card whose every dependant is off the canvas has no parent to be
        // hung under, so it keeps what it has rather than being cut adrift.
        if (!fullGraph && parentOf.has(dep) && parentOf.get(dep) !== id) continue;
        out.push({ from: dep, to: id, depth: highlight.depthOf(dep) });
      }
    }
    // Downstream is a fan, not a graph: the selection is a prerequisite of each
    // of these by definition, and nothing further is drawn. A fan is already a
    // tree, so the switch has nothing to say about it.
    for (const id of opened) out.push({ from: focus, to: id, depth: 0 });

    return out.sort((a, b) => a.depth - b.depth);
  }, [highlight, columns, catalog, fullGraph]);

  /**
   * Bring a course into view when the path list or the search box asks for it,
   * then pulse its ring once. A smooth scroll that ends somewhere in a field of
   * identical cards leaves you looking for what moved; the pulse says which one
   * the trip was for.
   *
   * The columns are in the dependencies because a request often arrives with a
   * new set of them — pressing the field tag on a borrowed card asks for the
   * course and changes the filter under it in the same click. Scrolling once,
   * against the columns that were there when the click landed, aimed at where
   * the card used to be and finished at the end of a page that had meanwhile
   * become three cards long.
   */
  const pulsed = useRef(0);

  useEffect(() => {
    if (!focusRequest) return;
    const card = scrollRef.current?.querySelector(`[data-course="${CSS.escape(focusRequest.courseId)}"]`);
    card?.scrollIntoView({
      behavior: reducedMotion ? 'auto' : 'smooth',
      block: 'center',
      inline: 'center',
    });
    // The scroll is repeated whenever the columns settle again; the pulse is
    // not — it answers the press, and a card that flashes every time a filter
    // changes is a card asking for attention it has no news to justify.
    if (pulsed.current === focusRequest.nonce) return;
    pulsed.current = focusRequest.nonce;
    setPulsingId(focusRequest.courseId);
    const timer = setTimeout(() => setPulsingId(null), 700);
    return () => clearTimeout(timer);
  }, [focusRequest, columns, reducedMotion]);

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
        <div className="relative flex min-w-max items-start p-5" style={{ gap: COLUMN_GAP }}>
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
                        // Standing in a column it does not belong to: the card
                        // says which field it came from and leads back to it.
                        guest={guests.has(course.id)}
                        inPath={
                          highlight.pinned &&
                          course.id !== selectedId &&
                          (emphasis === 'direct' || emphasis === 'transitive')
                        }
                        pulsing={course.id === pulsingId}
                        // A name in the panel is being pointed at, and this is
                        // the card it means.
                        echoed={course.id === echoId}
                        status={profile.courses[course.id]?.status ?? null}
                        favorite={profile.courses[course.id]?.favorite ?? false}
                        onSelect={onSelect}
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
