import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { loadMapSvg } from '@/lib/data';
import { parseMapSvg, type ParsedMap } from '@/lib/map';
import { useReducedMotion } from '@/lib/hooks';
import { withAlpha } from '@/lib/format';

type Props = {
  /** Domains matching the current search; empty means "no query typed". */
  matched: Set<string>;
  searchActive: boolean;
  /** Domains carrying materials from the active provider filter, or null. */
  allowed: Set<string> | null;
};

type Emphasis = 'full' | 'related' | 'dim';

/**
 * The first screen is a shop window, so animation is allowed here in a way it
 * is not in the graph — but it still yields to `prefers-reduced-motion`, which
 * leaves colour changes and drops the movement.
 */
export default function MapView({ matched, searchActive, allowed }: Props) {
  const catalog = useCatalog();
  const navigate = useNavigate();
  const { t, count } = useT();
  const reducedMotion = useReducedMotion();

  const [map, setMap] = useState<ParsedMap | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMapSvg()
      .then((text) => {
        if (!cancelled) setMap(parseMapSvg(text));
      })
      .catch(() => setMap(null));
    return () => {
      cancelled = true;
    };
  }, []);

  /** Domains the hovered one draws from — they glow weaker, in a cascade. */
  const sources = useMemo(() => {
    if (!hovered) return new Map<string, number>();
    const order = new Map<string, number>();
    const queue: Array<{ id: string; depth: number }> = [{ id: hovered, depth: 0 }];
    const seen = new Set([hovered]);
    while (queue.length) {
      const { id, depth } = queue.shift()!;
      for (const source of catalog.domainById.get(id)?.dependsOn ?? []) {
        if (seen.has(source)) continue;
        seen.add(source);
        order.set(source, depth + 1);
        queue.push({ id: source, depth: depth + 1 });
      }
    }
    return order;
  }, [hovered, catalog]);

  if (!map) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-faint">
        {t('ui.common.loading')}
      </div>
    );
  }

  const emphasisOf = (domainId: string): Emphasis => {
    if (allowed && !allowed.has(domainId)) return 'dim';
    if (hovered) {
      if (domainId === hovered) return 'full';
      return sources.has(domainId) ? 'related' : 'dim';
    }
    // Zero results must not black out the whole map — the "nothing found" line
    // says it instead.
    if (searchActive && matched.size) return matched.has(domainId) ? 'full' : 'dim';
    return 'full';
  };

  return (
    <div className="relative h-full w-full">
      <svg
        viewBox={map.viewBox}
        className="h-full w-full"
        role="group"
        aria-label={t('ui.a11y.mapRegion')}
        onPointerLeave={() => setHovered(null)}
      >
        {map.shapes.map((shape) => {
          const domain = catalog.domainById.get(shape.domainId);
          if (!domain) return null;

          const emphasis = emphasisOf(domain.id);
          const isHovered = hovered === domain.id;
          const delay = reducedMotion ? 0 : (sources.get(domain.id) ?? 0) * 80;
          // Dimming only has to say "not this one" — the territory must stay
          // readable, otherwise pointing at anything blacks out half the map.
          const opacity = emphasis === 'full' ? 1 : emphasis === 'related' ? 0.88 : 0.68;
          const lift = isHovered && !reducedMotion ? -2 : 0;

          return (
            <g
              key={shape.shapeId}
              transform={`translate(0 ${lift})`}
              style={{
                transition: reducedMotion
                  ? 'none'
                  : `opacity 180ms ease-out ${delay}ms, transform 180ms ease-out`,
                opacity,
                cursor: 'pointer',
              }}
              onPointerEnter={() => setHovered(domain.id)}
              // Leaving a territory has to clear the highlight even when the
              // pointer is still inside the svg — the gaps between territories
              // are part of the map, and the dimming used to survive there.
              // Guarded against the enter/leave pair firing out of order when
              // moving straight from one territory onto its neighbour.
              onPointerLeave={() => setHovered((current) => (current === domain.id ? null : current))}
              onClick={() => navigate(`/courses?domain=${encodeURIComponent(domain.id)}`)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  navigate(`/courses?domain=${encodeURIComponent(domain.id)}`);
                }
              }}
              tabIndex={0}
              role="link"
              aria-label={`${t(`domain.${domain.id}.title`)}, ${count(domain.courseCount, 'course')}`}
            >
              <path
                id={shape.shapeId}
                d={shape.d}
                fill={withAlpha(domain.color, isHovered ? 0.55 : emphasis === 'full' ? 0.3 : 0.18)}
                stroke={domain.color}
                strokeWidth={isHovered ? 2 : domain.bridge ? 1.4 : 1}
                strokeDasharray={domain.bridge ? '5 4' : undefined}
                style={{
                  filter: isHovered ? `drop-shadow(0 6px 18px ${withAlpha(domain.color, 0.45)})` : undefined,
                  transition: reducedMotion ? 'none' : 'fill 180ms ease-out, stroke-width 180ms ease-out',
                }}
              />
              <Label
                shape={shape}
                title={t(`domain.${domain.id}.title`)}
                counter={
                  domain.courseCount ? count(domain.courseCount, 'course') : t('ui.map.emptyDomain')
                }
                showCounter={isHovered}
                colour={domain.color}
              />
            </g>
          );
        })}
      </svg>

      <p className="pointer-events-none absolute bottom-3 left-4 text-xs text-ink-faint">
        {t('ui.map.legend')}
      </p>
    </div>
  );
}

function Label({
  shape,
  title,
  counter,
  showCounter,
  colour,
}: {
  shape: { cx: number; cy: number; width: number; height: number };
  title: string;
  counter: string;
  showCounter: boolean;
  colour: string;
}) {
  // Small territories only get a label when pointed at, otherwise the map turns
  // into a wall of overlapping text.
  const roomy = shape.width > 92 && shape.height > 52;
  if (!roomy && !showCounter) return null;

  const size = Math.max(11, Math.min(17, shape.width / 8));

  return (
    <g className="pointer-events-none" textAnchor="middle">
      <text
        x={shape.cx}
        y={shape.cy}
        fontSize={size}
        fontWeight={600}
        fill="var(--c-ink)"
        // A halo, not an outline. `strokeLinejoin: round` is the whole trick:
        // the default miter join throws long spikes off every sharp corner of a
        // glyph, which is what made the old 3.5px stroke look serrated.
        style={{
          paintOrder: 'stroke',
          stroke: 'var(--c-canvas)',
          strokeWidth: 2,
          strokeLinejoin: 'round',
          strokeLinecap: 'round',
          strokeOpacity: 0.75,
        }}
      >
        {title}
      </text>
      {showCounter ? (
        <text
          x={shape.cx}
          y={shape.cy + size + 3}
          fontSize={size * 0.75}
          fill={colour}
          style={{
            paintOrder: 'stroke',
            stroke: 'var(--c-canvas)',
            strokeWidth: 2,
            strokeLinejoin: 'round',
            strokeLinecap: 'round',
            strokeOpacity: 0.75,
          }}
        >
          {counter}
        </text>
      ) : null}
    </g>
  );
}
