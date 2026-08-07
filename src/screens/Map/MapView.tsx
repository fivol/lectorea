import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { loadMapSvg, mapImageUrl } from '@/lib/data';
import { parseMapSvg, type ParsedMap } from '@/lib/map';
import { useReducedMotion } from '@/lib/hooks';
import { withAlpha } from '@/lib/format';
import { shift } from '@shared/procedural';
import { DomainGlyph } from '@/components/DomainIcon';

/**
 * Lettering on a painted map, not on the app's canvas: the picture is one fixed
 * illustration, so its labels keep their own dark ink and white halo in either
 * theme rather than following the palette off it.
 */
const MAP_INK = '#172433';
const MAP_HALO = '#ffffff';

/**
 * The painting's own sea, sampled from it.
 *
 * The screen behind the map is filled with this, so the ocean runs to the edges
 * of the window instead of stopping at the bitmap's corners — the map is the
 * surface of the page here, not a picture placed on it.
 */
export const MAP_SEA = '#62b9d1';

/**
 * The palette the map screen runs on while the sea is the page.
 *
 * The sea is one fixed colour in both themes, so everything standing on it has
 * to be too — near-white lettering over light blue is unreadable, and that is
 * exactly what the dark theme would put there. These override the theme's own
 * variables for the duration of that screen, so every button, heading and field
 * on it keeps working without any of them knowing about the map.
 */
export const MAP_SURFACE_VARS = {
  '--c-canvas': MAP_SEA,
  // Opaque, so a field or a button is a plate on the water rather than a
  // tinted pane of it — a translucent white over this blue is still blue.
  // Not pure white — a hair of the sea in it, so the controls read as part of
  // this screen instead of holes punched through it.
  '--c-surface': '#f4fbfd',
  '--c-surface-2': '#fbfeff',
  '--c-line': 'rgb(12 40 54 / 0.24)',
  // All three inks are darker than a theme would normally make them. Against a
  // mid-light ground the usual «faint» grey lands at about 2.4:1 — a legend
  // nobody can read is not a quiet legend, it is a missing one. These clear
  // 4.5:1, which costs some of the spread between the three levels and is the
  // right way round to spend it.
  '--c-ink': '#0c1e28',
  '--c-ink-dim': '#1a3540',
  '--c-ink-faint': '#26454f',
  '--c-accent': '#0b6a86',
  '--shadow-panel': '0 18px 44px rgb(8 42 58 / 0.22)',
  '--shadow-card': '0 6px 18px rgb(8 42 58 / 0.16)',
} as React.CSSProperties;

/**
 * The territory colour, pushed away from its neighbours.
 *
 * `domains.yaml` gives every field in a continent a variation on one continent
 * hue, which is right on a card and useless on a map: fifteen shades of the
 * same blue, laid over the same washed-out ground, are one blue. Saturating and
 * darkening the tint spreads them back apart without inventing a second palette
 * — the field keeps the colour it has everywhere else, just stated properly.
 */
const tintOf = (colour: string): string => shift(colour, 0, 0.3, -0.08);

type Props = {
  /** Domains matching the current search; empty means "no query typed". */
  matched: Set<string>;
  searchActive: boolean;
  /** Domains carrying materials from the active provider filter, or null. */
  allowed: Set<string> | null;
};

type Emphasis = 'full' | 'dim';

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

  /**
   * Where each continent's name goes: centred over the union of its
   * territories, clear of the northernmost coast.
   *
   * The three continents are the one thing on the map that no territory says
   * out loud — a reader can see that the land is in three pieces without being
   * told what the split is for.
   */
  const continents = useMemo(() => {
    const boxes = new Map<string, { x0: number; x1: number; y0: number }>();
    for (const shape of map?.shapes ?? []) {
      const box = boxes.get(shape.continent);
      boxes.set(shape.continent, {
        x0: Math.min(box?.x0 ?? Infinity, shape.x),
        x1: Math.max(box?.x1 ?? -Infinity, shape.x + shape.width),
        y0: Math.min(box?.y0 ?? Infinity, shape.y),
      });
    }
    return [...boxes].map(([id, box]) => ({
      id,
      cx: (box.x0 + box.x1) / 2,
      y: box.y0 - 22,
    }));
  }, [map]);

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

  /**
   * Dimming answers a filter, never a cursor.
   *
   * Hovering used to grey out every territory except the one under the pointer
   * and the ones it draws from — which made moving the mouse across the map
   * flash three quarters of it on and off, and told you about a dependency
   * graph nobody had asked to see. Pointing at something is not a question; it
   * gets a slightly stronger fill and a heavier border on that one territory,
   * and nothing else on the map moves.
   */
  const emphasisOf = (domainId: string): Emphasis => {
    if (allowed && !allowed.has(domainId)) return 'dim';
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
        <defs>
          <clipPath id="map-land">
            <path d={map.land} />
          </clipPath>
        </defs>

        {/* The map is a painting; the territories are borders drawn on top of
            it. Both live in the same viewBox, so they scale together and can
            never drift apart at some window size. No frame around it and
            nothing laid over it: the sea behind the page is the same colour as
            the sea in the picture, so there is no edge left to dress. */}
        <image
          href={mapImageUrl}
          x={0}
          y={0}
          width={map.width}
          height={map.height}
          preserveAspectRatio="none"
        />

        {continents.map((continent) => (
          <text
            key={continent.id}
            x={continent.cx}
            y={Math.max(continent.y, 26)}
            textAnchor="middle"
            fontSize={19}
            fontWeight={700}
            fill={MAP_INK}
            letterSpacing={2.6}
            opacity={0.72}
            style={{
              paintOrder: 'stroke',
              stroke: MAP_HALO,
              strokeWidth: 4,
              strokeLinejoin: 'round',
              strokeOpacity: 0.85,
              textTransform: 'uppercase',
              pointerEvents: 'none',
            }}
          >
            {t(`ui.continent.${continent.id}`)}
          </text>
        ))}

        <g>
          {ordered.map((shape) => {
            const domain = catalog.domainById.get(shape.domainId);
            if (!domain) return null;

            const emphasis = emphasisOf(domain.id);
            const isHovered = hovered === domain.id;

            return (
              <g
                key={shape.shapeId}
                className="map-territory"
                style={{
                  transition: reducedMotion ? 'none' : 'opacity 220ms ease-out',
                  cursor: 'pointer',
                }}
                onPointerEnter={() => setHovered(domain.id)}
                // Leaving a territory has to clear the highlight even when the
                // pointer is still inside the svg — the sea is part of the map,
                // and the dimming used to survive out there. Guarded against the
                // enter/leave pair firing out of order when moving straight from
                // one territory onto its neighbour.
                onPointerLeave={() =>
                  setHovered((current) => (current === domain.id ? null : current))
                }
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
                {/*
                 * Colour over a painting, not instead of it: the fill is
                 * translucent enough that the terrain underneath still reads,
                 * and the border is the same colour stated at full strength, so
                 * a territory is identifiable without pointing at it.
                 *
                 * One hairline, not a line with a pale one under it — the map
                 * is washed out enough that a single stroke holds, and doubled
                 * strokes turned every border into a two-colour ribbon thicker
                 * than the small territories it was drawn around.
                 *
                 * The territories no longer lift on hover: they used to be
                 * floating shapes with their own shadow, and scaling one now
                 * would slide its border off the coastline underneath it.
                 */}
                <path
                  id={shape.shapeId}
                  className="territory-edge"
                  d={shape.d}
                  // The clip goes on the border, not on the whole territory: a
                  // name that runs a little past its own coast is fine, a name
                  // sliced in half by the shoreline is not.
                  clipPath={map.land ? 'url(#map-land)' : undefined}
                  fill={withAlpha(tintOf(domain.color), isHovered ? 0.62 : 0.46)}
                  // White, and heavy enough to be a border rather than a seam.
                  // The territories are strongly coloured now, so a border in
                  // their own colour was a darker edge of the same field; white
                  // is the one line that separates any two of them.
                  stroke={isHovered ? '#ffffff' : 'rgb(255 255 255 / 0.85)'}
                  strokeWidth={isHovered ? 5 : 3}
                  strokeDasharray={domain.bridge ? '10 6' : undefined}
                  strokeLinejoin="round"
                  style={{
                    transition: reducedMotion
                      ? 'none'
                      : 'fill 220ms ease-out, stroke-width 220ms ease-out',
                  }}
                />
                {/* Ruled out by a filter or a search: the territory washes out
                    towards the colour of the sea around it rather than being
                    blacked out. On a pale map a dark veil is the loudest thing
                    on screen, which is the opposite of what dimming is for. */}
                {emphasis === 'dim' ? (
                  <path
                    d={shape.d}
                    clipPath={map.land ? 'url(#map-land)' : undefined}
                    fill={withAlpha(MAP_SEA, 0.62)}
                    stroke="none"
                    style={{ pointerEvents: 'none' }}
                  />
                ) : null}
                <Label
                  shape={shape}
                  domainId={domain.id}
                  title={t(`domain.${domain.id}.title`)}
                  counter={
                    domain.courseCount ? count(domain.courseCount, 'course') : t('ui.map.emptyDomain')
                  }
                  showCounter={isHovered}
                  faded={emphasis === 'dim'}
                />
              </g>
            );
          })}
        </g>
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
  faded,
}: {
  shape: { cx: number; cy: number; width: number; height: number };
  domainId: string;
  title: string;
  counter: string;
  showCounter: boolean;
  /** Ruled out by a filter or a search — the veil is over the land, not the name. */
  faded: boolean;
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

  // A halo, not an outline. `strokeLinejoin: round` is the whole trick: the
  // default miter join throws long spikes off every sharp corner of a glyph,
  // which is what made the old thick stroke look serrated. On painted ground
  // the halo has to be opaque — grass and rock show straight through a
  // translucent one and the name stops being readable at all.
  const halo = {
    paintOrder: 'stroke' as const,
    stroke: MAP_HALO,
    strokeWidth: 3.2,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
    strokeOpacity: 0.9,
  };

  return (
    <g className="pointer-events-none" textAnchor="middle" opacity={faded ? 0.65 : 1}>
      {/* The same halo the names get, and for the same reason: line art in one
          dark colour vanishes over a forest or a mountain range. Drawn as a
          thick pale pass with the ink laid over it. */}
      {showGlyph ? (
        <>
          <DomainGlyph
            domainId={domainId}
            x={shape.cx}
            y={blockTop + glyphSize / 2}
            size={glyphSize}
            colour={MAP_HALO}
            opacity={0.85}
            strokeWidth={5}
          />
          <DomainGlyph
            domainId={domainId}
            x={shape.cx}
            y={blockTop + glyphSize / 2}
            size={glyphSize}
            colour={MAP_INK}
            opacity={0.85}
            strokeWidth={2}
          />
        </>
      ) : null}
      <text x={shape.cx} y={titleY} fontSize={size} fontWeight={700} fill={MAP_INK} style={halo}>
        {title}
      </text>
      {showCounter ? (
        <text
          x={shape.cx}
          y={titleY + size + 3}
          fontSize={size * 0.75}
          fontWeight={600}
          fill={MAP_INK}
          style={halo}
        >
          {counter}
        </text>
      ) : null}
    </g>
  );
}
