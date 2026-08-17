import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BuiltCourse } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { useIsDesktop, useReducedMotion } from '@/lib/hooks';
import { useHighlight } from '@/lib/highlight';
import { CARD_WIDTH, COLUMN_GAP, COLUMN_GAP_STEPPED } from '@/lib/layout';
import { placeGuests, type Edge } from '@/lib/order';
import { useShuffle } from '@/lib/shuffle';
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

/**
 * Columns, not a graph.
 *
 * A column is a level, and the level is the length of the longest chain of
 * prerequisites ending at the course — so reading left to right is reading the
 * order things must be studied in. That is the whole claim of the screen, and
 * it survives without a single line being drawn.
 *
 * Lines are drawn for one thing only: the chain *behind* the course in hand.
 * Over two hundred cards they were noise, crossing each other far more than
 * they explained; over the six or seven cards of one path they answer the
 * question the columns cannot — *which* of the cards on the left this one
 * needs. What the course opens up is the same question asked from the other
 * end, and it is answered by opening that course, not by a second bundle of
 * lines going the other way — see `links`.
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
   * The card a name in the panel is pointing at, and the panel it was named in.
   *
   * Set by hovering a prerequisite, a next course or a step of the path — the
   * one case where something outside the columns has to say «this one». It
   * lifts that card and draws the one edge being pointed at, and does nothing
   * else: the reading of the screen belongs to the selection, and a glance at a
   * list on the right is not a new selection.
   */
  const echo = useUi((state) => state.echo);
  const echoId = echo?.id ?? null;
  const focusRequest = useUi((state) => state.focusRequest);

  const profile = useProfile((state) => state.profile);
  /** Every edge of the chain, or the tree it cuts back to — see `links`. */
  const fullGraph = profile.settings.fullGraph;
  /** Steps down a lane in the gap, or one curve from card to card. */
  const stepped = profile.settings.steppedLines;
  /** Steps need a corridor to run down; a curve does not — see `COLUMN_GAP`. */
  const gap = stepped ? COLUMN_GAP_STEPPED : COLUMN_GAP;
  const highlight = useHighlight(selectedId);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const [pulsingId, setPulsingId] = useState<string | null>(null);

  /**
   * One bucket per level, cards in `row` order. Filtered-out courses collapse
   * the column rather than leaving holes: a filter that shows three courses
   * spread over forty empty slots reads as a broken page.
   */
  const shelved = useMemo(() => {
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

  /**
   * Which cards the chain covers, and every edge inside it.
   *
   * Separate from `links` because both the ordering below and the drawn lines
   * need this, and because it is the *graph* rather than what is drawn of it:
   * the columns must not rearrange themselves when «Все связи» is pressed, so
   * the order is settled against every edge whether or not the tree keeps it.
   */
  const chain = useMemo(() => {
    const focus = highlight.focusId;
    const upstream = new Set<string>();
    const opened = new Set<string>();
    if (!highlight.active || !focus) return { focus: null, upstream, opened, edges: [] as Edge[] };

    for (const column of shelved) {
      for (const course of column.courses) {
        const emphasis = highlight.emphasisOf(course.id);
        if (emphasis === 'self' || emphasis === 'direct' || emphasis === 'transitive') {
          upstream.add(course.id);
        } else if (emphasis === 'downstream') {
          opened.add(course.id);
        }
      }
    }

    const edges: Edge[] = [];
    for (const id of upstream) {
      for (const dep of catalog.courseById.get(id)?.deps ?? []) {
        if (upstream.has(dep)) edges.push({ from: dep, to: id });
      }
    }
    // What the selection opens up is not drawn any more — see `links` — but it
    // still decides where those cards stand: without the edge, a course pulled
    // onto the canvas from another field keeps its catalogue row and lands as
    // far from the course that opened it as its home band happens to be.
    for (const id of opened) edges.push({ from: focus, to: id });

    return { focus, upstream, opened, edges };
  }, [highlight, shelved, catalog]);

  /**
   * The columns as drawn: the field's own cards in the order the build gave
   * them, the borrowed ones dropped wherever the chain reads best. See
   * `placeGuests` — it is the guests that carry nine tenths of the crossings,
   * because their `row` was decided by a band they are visiting from.
   */
  const columns = useMemo(
    () => placeGuests(shelved, guests, chain.edges),
    [shelved, guests, chain.edges]
  );

  const total = columns.reduce((sum, column) => sum + column.courses.length, 0);

  /**
   * Everything on the canvas, in the order it stands in — the FLIP's cue. The
   * gap is in it because switching drawing mode moves every column sideways,
   * which is a card changing places like any other.
   */
  const arrangement = useMemo(
    () =>
      `${gap}:` +
      columns.map((column) => column.courses.map((course) => course.id).join(',')).join('|'),
    [columns, gap]
  );

  useShuffle(scrollRef, arrangement, !reducedMotion);

  /**
   * The edges of the chain, as pairs of course ids.
   *
   * A selection's, and nothing else's — pointing at a card asks a question of
   * the cards, not of the curves already on screen.
   *
   * One side, not two: the tree of prerequisites that leads to the selection.
   * Every edge therefore touches the selected course or something on the way to
   * it. Drawing *every* edge between lit cards also caught the links among the
   * courses it opens to each other — biochemistry into molecular biology while
   * cell biology was the one selected — and those are both the longest sweeps
   * on screen and the ones that answer a question nobody asked.
   *
   * The fan forward — one line out of the selection into each course it opens —
   * went the same way, and for a harder reason: it could only ever be drawn
   * over what the filter had left standing. Prerequisites are borrowed back
   * onto the canvas in full, so the tree behind a course is complete or it is
   * not drawn at all; the courses ahead are not borrowed, so the fan showed
   * whichever of them the current field happened to contain and read as the
   * whole answer. «Открывает путь к» in the panel is the whole answer, and it
   * costs a click to make it drawn as well: the course opened becomes the
   * selection, and the same relation is then a prerequisite of it — drawn the
   * one way this screen draws anything, right to left, with everything it
   * stands on brought in behind it.
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
   * the whole reason for asking for a tree. Nearest by the row it is *standing*
   * in, not by the catalogue's: a guest has just been moved to wherever it read
   * best, and picking its parent by the row it no longer occupies would hand
   * the tree the long edge the move was made to avoid.
   */
  const links = useMemo<Link[]>(() => {
    const { focus, upstream, opened, edges } = chain;
    if (!focus) return [];

    const seat = new Map<string, { column: number; row: number }>();
    columns.forEach((column, index) =>
      column.courses.forEach((course, row) => seat.set(course.id, { column: index, row }))
    );

    /** The one course each card is hung under when the graph is cut to a tree. */
    const parentOf = new Map<string, string>();
    if (!fullGraph) {
      const needs = new Map<string, string[]>();
      for (const edge of edges) {
        if (!upstream.has(edge.from) || !upstream.has(edge.to)) continue;
        needs.set(edge.from, [...(needs.get(edge.from) ?? []), edge.to]);
      }
      for (const [dep, dependants] of needs) {
        const here = seat.get(dep);
        const nearest = dependants.reduce((best, id) => {
          const one = seat.get(id);
          const other = seat.get(best);
          if (!one || !other) return best;
          if (one.column !== other.column) return one.column < other.column ? id : best;
          const reach = Math.abs(one.row - (here?.row ?? 0));
          const bestReach = Math.abs(other.row - (here?.row ?? 0));
          return reach < bestReach ? id : best;
        });
        parentOf.set(dep, nearest);
      }
    }

    const out: Link[] = [];
    for (const edge of edges) {
      // Forward edges carry the placement and nothing else.
      if (opened.has(edge.to)) continue;
      // A card whose every dependant is off the canvas has no parent to be
      // hung under, so it keeps what it has rather than being cut adrift.
      if (!fullGraph && parentOf.has(edge.from) && parentOf.get(edge.from) !== edge.to) continue;
      out.push({ from: edge.from, to: edge.to, depth: highlight.depthOf(edge.from) });
    }

    return out.sort((a, b) => a.depth - b.depth);
  }, [chain, columns, highlight, fullGraph]);

  /**
   * The chain's lines, plus the one the pointer is asking about.
   *
   * A name in the panel is one end of a relation and the panel it stands in is
   * the other, so pointing at it can be answered with the line itself rather
   * than only with the card lighting up — including for edges the canvas is not
   * otherwise drawing: what a course opens up, and the second prerequisite the
   * tree dropped when «Все связи» is off.
   *
   * Only where the relation is a prerequisite, in whichever direction the panel
   * happened to name it. A line on this canvas says «this has to come first» and
   * that is the whole of what it says; «Также полезно» and «Рядом» are ties of
   * another kind, and drawing them the same way would make the picture claim
   * something the catalogue does not. Those still borrow their card in.
   *
   * `deps` decides the direction, not the two seats: a prerequisite's level is
   * strictly lower than its dependant's, so the edge always runs left to right,
   * which is the one direction `routeSteps` can draw.
   */
  const drawn = useMemo<Link[]>(() => {
    if (!echo?.from || echo.from === echo.id) return links;

    const there = catalog.courseById.get(echo.id);
    const here = catalog.courseById.get(echo.from);
    const edge = there?.deps.includes(echo.from)
      ? { from: echo.from, to: echo.id }
      : here?.deps.includes(echo.id)
        ? { from: echo.id, to: echo.from }
        : null;
    if (!edge) return links;
    if (links.some((link) => link.from === edge.from && link.to === edge.to)) return links;

    // Last, so it is painted over the chain rather than under it. Off-canvas
    // ends are dropped by the router, which measures before it draws.
    return [...links, { ...edge, depth: 0 }];
  }, [links, echo, catalog]);

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
      // One arrow press travels a column plus the gap between columns, which
      // the drawing mode decides — the two drifting apart lands the scroll
      // somewhere that is not a column edge.
      left: direction * (CARD_WIDTH + gap),
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
        <div className="relative flex min-w-max items-start p-5" style={{ gap }}>
          <ChainLinks
            scrollRef={scrollRef}
            links={drawn}
            revision={`${selectedId}:${columns.length}:${total}:${gap}`}
            animate={!reducedMotion}
            stepped={stepped}
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
                    // The FLIP reads its positions off the row rather than off
                    // the card: the card carries a transform of its own for the
                    // hover lift, and two animations on one property fight.
                    <li key={course.id} data-card={course.id}>
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
