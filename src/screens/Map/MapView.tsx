import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { loadMapSvg } from '@/lib/data';
import { parseMapSvg, type ParsedMap } from '@/lib/map';
import { useReducedMotion } from '@/lib/hooks';
import { withAlpha } from '@/lib/format';
import { DomainGlyph } from '@/components/DomainIcon';

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

  /** Domains the hovered one draws from, transitively — they stay lit. */
  const sources = useMemo(() => {
    const found = new Set<string>();
    if (!hovered) return found;
    const queue = [hovered];
    const seen = new Set([hovered]);
    while (queue.length) {
      for (const source of catalog.domainById.get(queue.shift()!)?.dependsOn ?? []) {
        if (seen.has(source)) continue;
        seen.add(source);
        found.add(source);
        queue.push(source);
      }
    }
    return found;
  }, [hovered, catalog]);

  if (!map) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-faint">
        {t('ui.common.loading')}
      </div>
    );
  }

  /**
   * SVG has no z-index — paint order is document order, so a territory drawn
   * earlier sits under its neighbours. Scaling one up without moving it to the
   * end left its grown edge clipped by whatever came after it, which is what
   * made the hover look broken rather than raised.
   */
  const ordered = hovered
    ? [
        ...map.shapes.filter((shape) => shape.domainId !== hovered),
        ...map.shapes.filter((shape) => shape.domainId === hovered),
      ]
    : map.shapes;

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
        {ordered.map((shape) => {
          const domain = catalog.domainById.get(shape.domainId);
          if (!domain) return null;

          const emphasis = emphasisOf(domain.id);
          const isHovered = hovered === domain.id;
          // Dimming only has to say "not this one" — the territory must stay
          // readable, otherwise pointing at anything blacks out half the map.
          const opacity = emphasis === 'full' ? 1 : emphasis === 'related' ? 0.88 : 0.68;

          return (
            <g
              key={shape.shapeId}
              style={{
                /**
                 * The lift used to be an SVG `transform` attribute, which CSS
                 * transitions do not animate — every hover was a two-pixel jump.
                 * As a CSS transform it eases, and `fill-box` puts the origin at
                 * the territory's own centre so it grows in place.
                 *
                 * One duration for everything, no per-domain delays: the map
                 * should settle into a new state as one movement. Staggering the
                 * fade made half the territories lag the other half by a quarter
                 * of a second, which read as the map stuttering rather than as
                 * anything meaningful.
                 */
                transformBox: 'fill-box',
                transformOrigin: 'center',
                transform: isHovered && !reducedMotion ? 'scale(1.03)' : 'scale(1)',
                transition: reducedMotion
                  ? 'none'
                  : 'opacity 220ms ease-out, transform 320ms cubic-bezier(0.22, 1, 0.36, 1)',
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
                  // Both states name a shadow so the two interpolate. With
                  // `undefined` on one side there is nothing to animate from and
                  // the glow snapped in, which is most of what made the hover
                  // feel abrupt.
                  filter: `drop-shadow(0 3px 10px ${withAlpha(
                    domain.color,
                    isHovered && !reducedMotion ? 0.45 : 0
                  )})`,
                  transition: reducedMotion
                    ? 'none'
                    : 'fill 220ms ease-out, stroke-width 220ms ease-out, filter 260ms ease-out',
                }}
              />
              <Label
                shape={shape}
                domainId={domain.id}
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
  domainId,
  title,
  counter,
  showCounter,
  colour,
}: {
  shape: { cx: number; cy: number; width: number; height: number };
  domainId: string;
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

  /**
   * The glyph carries the territory, so it is sized against the territory
   * rather than against the text — big enough to be read as the thing the area
   * *is*, at a glance and from across the map.
   *
   * It is drawn only where there is room for the glyph and the name together;
   * on a cramped territory the name is worth more than the picture.
   */
  const glyphSize = Math.max(26, Math.min(76, shape.width / 2.6));
  const gap = size * 0.45;
  const showGlyph = shape.height > glyphSize + size * 2.4;

  // Glyph and title are laid out as one block, centred together — otherwise
  // adding the glyph pushes the whole label off the middle of the territory.
  const blockTop = showGlyph
    ? shape.cy - (glyphSize + gap + size * 0.72) / 2
    : shape.cy - size * 0.36;
  const titleY = blockTop + (showGlyph ? glyphSize + gap : 0) + size * 0.72;

  return (
    <g className="pointer-events-none" textAnchor="middle">
      {showGlyph ? (
        <DomainGlyph
          domainId={domainId}
          x={shape.cx}
          y={blockTop + glyphSize / 2}
          size={glyphSize}
          colour={colour}
          opacity={0.9}
          strokeWidth={1.7}
        />
      ) : null}
      <text
        x={shape.cx}
        y={titleY}
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
          y={titleY + size + 3}
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
