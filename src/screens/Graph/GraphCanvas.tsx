import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { BuiltCourse } from '@shared/schema';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { useElementSize, useReducedMotion } from '@/lib/hooks';
import { CARD_HEIGHT, CARD_WIDTH, edgePath, intersects, relatedPath, type Rect } from '@/lib/layout';
import { EMPHASIS_OPACITY, useHighlight } from '@/lib/highlight';
import { useUi, ZOOM_STEPS } from '@/store/ui';
import { useProfile } from '@/store/profile';
import Icon from '@/components/Icon';
import CourseCard from './CourseCard';
import MiniMap from './MiniMap';

type Props = {
  courses: BuiltCourse[];
  visible: Set<string>;
  dimmed: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
};

/**
 * The graph is one canvas for every domain — a domain is a filter and a colour,
 * not a separate graph. Splitting it per domain would hide the whole point:
 * that electrodynamics needs not "some maths" but vector calculus, which is
 * itself not at the beginning.
 *
 * Cards are absolutely positioned DOM, edges are one SVG. No graph library:
 * react-flow at 500 nodes is slow and brings its own UX along.
 */
export default function GraphCanvas({ courses, visible, dimmed, selectedId, onSelect }: Props) {
  const catalog = useCatalog();
  const { t } = useT();
  const reducedMotion = useReducedMotion();

  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const pan = useUi((state) => state.pan);
  const setPan = useUi((state) => state.setPan);
  const zoomIndex = useUi((state) => state.zoomIndex);
  const setZoom = useUi((state) => state.setZoom);
  const hoveredId = useUi((state) => state.hoveredCourseId);
  const setHovered = useUi((state) => state.setHovered);
  const echoId = useUi((state) => state.echoCourseId);
  const focusRequest = useUi((state) => state.focusRequest);

  const profile = useProfile((state) => state.profile);
  const scale = ZOOM_STEPS[zoomIndex];
  const highlight = useHighlight(selectedId, hoveredId ?? echoId);

  const shown = useMemo(
    () => courses.filter((course) => visible.has(course.id) || dimmed.has(course.id)),
    [courses, visible, dimmed]
  );
  const shownIds = useMemo(() => new Set(shown.map((c) => c.id)), [shown]);

  /* ────────────────────────────  Viewport  ──────────────────────────── */

  const viewport: Rect = useMemo(() => {
    const width = size.width / scale;
    const height = size.height / scale;
    // One screen of margin on each side: scrolling should never reveal a hole.
    return {
      x: -pan.x / scale - width,
      y: -pan.y / scale - height,
      width: width * 3,
      height: height * 3,
    };
  }, [pan, scale, size]);

  const rendered = useMemo(
    () =>
      shown.filter((course) =>
        intersects({ x: course.x, y: course.y, width: CARD_WIDTH, height: CARD_HEIGHT }, viewport)
      ),
    [shown, viewport]
  );

  const centreOn = useCallback(
    (course: BuiltCourse) => {
      if (!size.width) return;
      setPan({
        x: size.width / 2 - (course.x + CARD_WIDTH / 2) * scale,
        y: size.height / 2 - (course.y + CARD_HEIGHT / 2) * scale,
      });
    },
    [scale, setPan, size]
  );

  /**
   * Park the view on the content — on first paint and whenever a filter changes
   * what is left. Without this, filtering down to a handful of courses leaves
   * the viewport wherever it was and the graph reads as empty.
   */
  const shownKey = useMemo(
    () => `${shown.length}:${shown[0]?.id ?? ''}:${shown[shown.length - 1]?.id ?? ''}`,
    [shown]
  );

  useEffect(() => {
    if (!size.width) return;
    const selected = selectedId ? catalog.courseById.get(selectedId) : undefined;
    if (selected) {
      centreOn(selected);
      return;
    }
    if (!shown.length) return;

    const minX = Math.min(...shown.map((course) => course.x));
    const maxX = Math.max(...shown.map((course) => course.x)) + CARD_WIDTH;
    const minY = Math.min(...shown.map((course) => course.y));
    const maxY = Math.max(...shown.map((course) => course.y)) + CARD_HEIGHT;

    // Pick the closest zoom step that shows the whole filtered set. Filtering to
    // a handful of courses that happen to sit far apart would otherwise look
    // like an empty canvas with one card in it.
    let nextZoom: 0 | 1 | 2 = 0; // overview, if even that does not fit
    for (let step = ZOOM_STEPS.length - 1; step >= 0; step--) {
      const candidate = ZOOM_STEPS[step];
      if (
        (maxX - minX) * candidate <= size.width - 80 &&
        (maxY - minY) * candidate <= size.height - 80
      ) {
        nextZoom = step as 0 | 1 | 2;
        break;
      }
    }
    const nextScale = ZOOM_STEPS[nextZoom];

    setZoom(nextZoom);
    setPan({
      x: size.width / 2 - ((minX + maxX) / 2) * nextScale,
      y: size.height / 2 - ((minY + maxY) / 2) * nextScale,
    });
    // `shownKey` stands in for `shown`, which changes identity on every filter edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey, size.width, size.height, selectedId]);

  useEffect(() => {
    if (!focusRequest) return;
    const course = catalog.courseById.get(focusRequest.courseId);
    if (course) centreOn(course);
  }, [focusRequest, catalog, centreOn]);

  /* ───────────────────────────  Interaction  ────────────────────────── */

  const dragging = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('[data-course]')) return;
    dragging.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return;
    const dx = event.clientX - dragging.current.x;
    const dy = event.clientY - dragging.current.y;
    dragging.current = { x: event.clientX, y: event.clientY };
    setPan({ x: pan.x + dx, y: pan.y + dy });
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    dragging.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const wheelAccumulator = useRef(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      wheelAccumulator.current += event.deltaY;
      if (Math.abs(wheelAccumulator.current) < 90) return;
      const direction = wheelAccumulator.current > 0 ? -1 : 1;
      wheelAccumulator.current = 0;

      const next = Math.min(2, Math.max(0, zoomIndex + direction)) as 0 | 1 | 2;
      if (next === zoomIndex) return;

      // Keep the point under the cursor still while the zoom step lands.
      const rect = element.getBoundingClientRect();
      const cx = event.clientX - rect.left;
      const cy = event.clientY - rect.top;
      const ratio = ZOOM_STEPS[next] / ZOOM_STEPS[zoomIndex];
      setPan({ x: cx - (cx - pan.x) * ratio, y: cy - (cy - pan.y) * ratio });
      setZoom(next);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [containerRef, zoomIndex, pan, setPan, setZoom]);

  /* ─────────────────────────────  Edges  ────────────────────────────── */

  const edges = useMemo(() => {
    type Edge = { key: string; d: string; kind: 'dep' | 'soft' | 'related'; opacity: number; colour: string };
    const list: Edge[] = [];
    const seenRelated = new Set<string>();

    const opacityOf = (a: string, b: string): number =>
      highlight.active
        ? Math.min(EMPHASIS_OPACITY[highlight.emphasisOf(a)], EMPHASIS_OPACITY[highlight.emphasisOf(b)])
        : 0.4;

    for (const course of rendered) {
      const target = catalog.courseById.get(course.id);
      if (!target) continue;
      const colour = catalog.domainById.get(course.domains[0])?.color ?? 'var(--c-formal)';

      for (const depId of course.deps) {
        const dep = catalog.courseById.get(depId);
        if (!dep || !shownIds.has(depId)) continue;
        list.push({
          key: `d:${depId}>${course.id}`,
          d: edgePath(dep, course),
          kind: 'dep',
          opacity: opacityOf(depId, course.id),
          colour,
        });
      }
      for (const softId of course.soft) {
        const soft = catalog.courseById.get(softId);
        if (!soft || !shownIds.has(softId)) continue;
        list.push({
          key: `s:${softId}>${course.id}`,
          d: edgePath(soft, course),
          kind: 'soft',
          opacity: opacityOf(softId, course.id),
          colour,
        });
      }
      for (const relatedId of course.related) {
        const other = catalog.courseById.get(relatedId);
        if (!other || !shownIds.has(relatedId)) continue;
        const pairKey = [course.id, relatedId].sort().join('~');
        if (seenRelated.has(pairKey)) continue;
        seenRelated.add(pairKey);
        list.push({
          key: `r:${pairKey}`,
          d: relatedPath(course, other),
          kind: 'related',
          opacity: opacityOf(relatedId, course.id) * 0.8,
          colour,
        });
      }
    }
    return list;
  }, [rendered, catalog, shownIds, highlight]);

  const compact = zoomIndex === 0;

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full touch-none overflow-hidden"
      style={{ cursor: dragging.current ? 'grabbing' : 'grab' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      role="application"
      aria-label={t('ui.a11y.graphRegion')}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${scale})`,
          width: catalog.bounds.width,
          height: catalog.bounds.height,
        }}
      >
        <svg
          className="pointer-events-none absolute left-0 top-0"
          width={catalog.bounds.width}
          height={catalog.bounds.height}
          aria-hidden="true"
        >
          <defs>
            <marker
              id="arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0 0L10 5L0 10z" fill="currentColor" />
            </marker>
          </defs>
          {edges.map((edge) => (
            <path
              key={edge.key}
              d={edge.d}
              fill="none"
              stroke={edge.colour}
              color={edge.colour}
              strokeWidth={edge.kind === 'related' ? 1 : 1.4}
              strokeDasharray={edge.kind === 'soft' ? '6 5' : undefined}
              markerEnd={edge.kind === 'related' ? undefined : 'url(#arrow)'}
              markerStart={edge.kind === 'related' ? 'url(#arrow)' : undefined}
              opacity={edge.opacity}
              style={{
                transition: reducedMotion ? 'none' : 'opacity 220ms ease-out',
              }}
            />
          ))}
        </svg>

        {rendered.map((course) => (
          <CourseCard
            key={course.id}
            course={course}
            domain={catalog.domainById.get(course.domains[0])}
            emphasis={highlight.active ? highlight.emphasisOf(course.id) : 'self'}
            // The signature effect: the chain lights up right to left, 40 ms a step.
            delay={reducedMotion || !highlight.pinned ? 0 : highlight.depthOf(course.id) * 40}
            selected={course.id === selectedId}
            status={profile.courses[course.id]?.status ?? null}
            favorite={profile.courses[course.id]?.favorite ?? false}
            compact={compact}
            dimmedByFilter={dimmed.has(course.id)}
            onSelect={onSelect}
            onHover={setHovered}
          />
        ))}
      </div>

      {!shown.length ? (
        <p className="absolute inset-0 flex items-center justify-center text-sm text-ink-faint">
          {t('ui.graph.empty')}
        </p>
      ) : null}

      <div className="absolute left-3 top-3 flex items-center gap-1 rounded-lg border border-line bg-surface/85 p-1 backdrop-blur">
        <button
          type="button"
          className="btn-ghost rounded p-1.5"
          onClick={() => setZoom(Math.max(0, zoomIndex - 1) as 0 | 1 | 2)}
          aria-label={t('ui.graph.zoomOut')}
          disabled={zoomIndex === 0}
        >
          <Icon name="minus" size={14} />
        </button>
        <span className="num w-14 text-center text-[11px] text-ink-faint">
          {t(`ui.graph.zoom.${(['overview', 'normal', 'detail'] as const)[zoomIndex]}`)}
        </span>
        <button
          type="button"
          className="btn-ghost rounded p-1.5"
          onClick={() => setZoom(Math.min(2, zoomIndex + 1) as 0 | 1 | 2)}
          aria-label={t('ui.graph.zoomIn')}
          disabled={zoomIndex === 2}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>

      <MiniMap
        courses={shown}
        bounds={catalog.bounds}
        viewport={{
          x: -pan.x / scale,
          y: -pan.y / scale,
          width: size.width / scale,
          height: size.height / scale,
        }}
        selectedId={selectedId}
        onJump={(x, y) =>
          setPan({ x: size.width / 2 - x * scale, y: size.height / 2 - y * scale })
        }
      />
    </div>
  );
}
