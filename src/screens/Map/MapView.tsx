import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { loadMapSvg } from '@/lib/data';
import { parseMapSvg, type MapShape, type ParsedMap } from '@/lib/map';
import { useReducedMotion } from '@/lib/hooks';
import { DomainGlyph } from '@/components/DomainIcon';

/**
 * The map's own colours live in `index.css` next to every other theme colour —
 * `--map-sea`, `--map-land`, the wash over it, the borders, the lettering.
 * Naming them there rather than here is what makes the map follow the light and
 * dark themes without this file knowing which one is on.
 */
const MAP_INK = 'var(--map-ink)';
const MAP_HALO = 'var(--map-halo)';

/**
 * The sea, as a value the screen around the map can paint itself with — so the
 * ocean runs to the edges of the window instead of stopping at the drawing's
 * corners. The map is the surface of the page here, not a picture placed on it.
 */
export const MAP_SEA = 'var(--map-sea)';

/** How far the land is lifted off the water, in map units. */
const LAND_SHADOW = 10;

/**
 * The continent titles: the largest lettering on the map, and the only one that
 * is tracked out. `TRACKING` is what the letter-spacing costs in width, which
 * the label placer needs in order to keep the fields' names out of that band.
 */
const CONTINENT_SIZE = 19;
const CONTINENT_TRACKING = 1.4;

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
   * Where each continent's name goes: centred over its mainland, just off the
   * northern coast.
   *
   * The mainland, not everything the continent owns — a continent with two
   * islands off it would otherwise be named over the water between them, which
   * reads as a label for the sea.
   *
   * The three continents are the one thing on the map that no territory says
   * out loud — a reader can see that the land is in pieces without being told
   * what the split is for.
   */
  const continents = useMemo(
    () =>
      (map?.landmasses ?? [])
        .filter((mass) => mass.kind === 'continent')
        .map((mass) => {
          const title = t(`ui.continent.${mass.continent}`);
          const y = Math.max(mass.y - 20, CONTINENT_SIZE + 8);
          const width = textWidth(title, CONTINENT_SIZE * CONTINENT_TRACKING);
          return {
            id: mass.continent,
            cx: mass.x + mass.width / 2,
            y,
            // The band a territory's name may not be written into. A continent
            // is named once and read first; everything else gives way to it.
            box: {
              x: mass.x + mass.width / 2 - width / 2,
              y: y - CONTINENT_SIZE,
              w: width,
              h: CONTINENT_SIZE * 1.5,
            },
          };
        }),
    [map, t]
  );

  /**
   * The whole lettering layout, recomputed only when the map or the language
   * changes — it is a fitting pass over every territory, not something to redo
   * on each hover.
   */
  const placements = useMemo(
    () =>
      map
        ? placeLabels(
            map.shapes,
            (domainId) => t(`domain.${domainId}.title`),
            map,
            continents.map((continent) => continent.box)
          )
        : new Map<string, Placement>(),
    [map, t, continents]
  );

  if (!map) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-faint">
        {t('ui.common.loading')}
      </div>
    );
  }

  /**
   * Named territories, with the one under the pointer written last so its
   * course count is never covered by a neighbour's name.
   */
  const labelled = map.shapes
    .filter((shape) => placements.has(shape.domainId) || shape.domainId === hovered)
    .map((shape) => ({ shape, placement: placements.get(shape.domainId) ?? null }))
    .sort((a, b) => Number(a.shape.domainId === hovered) - Number(b.shape.domainId === hovered));

  /**
   * SVG has no z-index — paint order is document order, so a territory drawn
   * earlier sits under its neighbours. The one under the pointer is moved to
   * the end, or the heavier border it takes is painted over from both sides by
   * whatever is drawn after it and the highlight shows on one edge only.
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
        {/* The land itself, under everything: first its shadow on the water,
            then the pale ground the territories are washed over. Nothing here
            is a picture — the same paths the territories tile, so the coast and
            the borders can never drift apart at some window size. */}
        {map.landmasses.map((mass, index) => (
          <path
            key={`shadow-${index}`}
            d={mass.d}
            style={{ fill: 'var(--map-shadow)' }}
            transform={`translate(0 ${LAND_SHADOW})`}
          />
        ))}
        {map.landmasses.map((mass, index) => (
          <path key={`land-${index}`} d={mass.d} style={{ fill: 'var(--map-land)' }} />
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
                 * A wash of the field's own colour over the pale ground, and a
                 * white border around it. The two neighbours of any border draw
                 * it from their own side, vertex for vertex, so the line reads
                 * as one line and no gap can open between two territories.
                 *
                 * One hairline, not a line with a pale one under it — doubled
                 * strokes turned every border into a two-colour ribbon thicker
                 * than the small territories it was drawn around.
                 *
                 * The territories do not lift on hover: they are pieces of a
                 * continent, and lifting one slides its borders off the ones
                 * still holding still around it.
                 */}
                <path
                  id={shape.shapeId}
                  className="territory-edge"
                  d={shape.d}
                  strokeWidth={isHovered ? 5 : 3}
                  strokeLinejoin="round"
                  style={{
                    // The colour is the field's own; how much of it goes down is
                    // the theme's, which is the whole reason the two are set
                    // separately here instead of as one rgba.
                    fill: domain.color,
                    fillOpacity: isHovered ? 'var(--map-wash-hover)' : 'var(--map-wash)',
                    // Heavy enough to be a border rather than a seam. It is the
                    // one line that separates any two neighbours: they are shades
                    // of one continent hue, so a border in a territory's own
                    // colour is just a darker edge of the same field.
                    stroke: isHovered ? 'var(--map-border-strong)' : 'var(--map-border)',
                    transition: reducedMotion
                      ? 'none'
                      : 'fill-opacity 220ms ease-out, stroke-width 220ms ease-out',
                  }}
                />
                {/* Ruled out by a filter or a search: the territory washes back
                    towards the bare ground it was painted on rather than being
                    blacked out. On a pale map a dark veil is the loudest thing
                    on screen, which is the opposite of what dimming is for. */}
                {emphasis === 'dim' ? (
                  <path
                    d={shape.d}
                    stroke="none"
                    style={{
                      fill: 'var(--map-land)',
                      fillOpacity: 0.76,
                      pointerEvents: 'none',
                    }}
                  />
                ) : null}
              </g>
            );
          })}
        </g>

        {/* The shoreline, over the territories that meet it: a border between
            two fields is one white line, and the edge of the land should not be
            the only one drawn at half that weight. */}
        {map.landmasses.map((mass, index) => (
          <path
            key={`coast-${index}`}
            d={mass.d}
            fill="none"
            strokeWidth={4.5}
            strokeLinejoin="round"
            style={{ stroke: 'var(--map-coast)', pointerEvents: 'none' }}
          />
        ))}

        {/*
          Every name on the map, in one layer over the whole drawing.
          Lettering used to live inside the territory it belonged to, which put
          the next territory's border — and the shoreline — straight over the
          names near an edge. There is no z-index in SVG: being last is the only
          way to be on top.
        */}
        <g className="pointer-events-none">
          {continents.map((continent) => (
            <text
              key={continent.id}
              x={continent.cx}
              y={continent.y}
              textAnchor="middle"
              fontSize={CONTINENT_SIZE}
              fontWeight={700}
              letterSpacing={2.6}
              opacity={0.72}
              style={{
                fill: MAP_INK,
                paintOrder: 'stroke',
                stroke: MAP_HALO,
                strokeWidth: 4,
                strokeLinejoin: 'round',
                strokeOpacity: 0.85,
                textTransform: 'uppercase',
              }}
            >
              {t(`ui.continent.${continent.id}`)}
            </text>
          ))}

          {labelled.map(({ shape, placement }) => {
            const domain = catalog.domainById.get(shape.domainId);
            if (!domain) return null;
            return (
              <Label
                key={shape.shapeId}
                shape={shape}
                placement={placement}
                domainId={domain.id}
                title={t(`domain.${domain.id}.title`)}
                counter={
                  domain.courseCount ? count(domain.courseCount, 'course') : t('ui.map.emptyDomain')
                }
                showCounter={hovered === domain.id}
                faded={emphasisOf(domain.id) === 'dim'}
              />
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

/** Rough width of a bold line at a given size — no measuring in an SVG. */
const textWidth = (text: string, size: number): number => text.length * size * 0.62;

const lineWidth = (lines: string[], size: number): number =>
  Math.max(...lines.map((line) => textWidth(line, size)));

/**
 * The name, on one line or two, or nothing at all if it will not go into the
 * width given. Two lines at most: a third turns a label into a paragraph.
 */
function fitLines(title: string, size: number, width: number): string[] | null {
  if (textWidth(title, size) <= width) return [title];

  const words = title.split(' ');
  let best: string[] | null = null;
  let bestWidth = Infinity;
  for (let split = 1; split < words.length; split++) {
    const lines = [words.slice(0, split).join(' '), words.slice(split).join(' ')];
    const widest = lineWidth(lines, size);
    if (widest <= width && widest < bestWidth) {
      best = lines;
      bestWidth = widest;
    }
  }
  return best;
}

/* ───────────────────────────  Placing the names  ────────────────────────── */

type Rect = { x: number; y: number; w: number; h: number };

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Where one territory's name goes, and how big.
 *
 * `y` is the baseline of the first line; `glyph` is the diameter of the icon
 * drawn at the territory's own label point, or null where there is no room for
 * one.
 */
type Placement = {
  lines: string[];
  size: number;
  x: number;
  y: number;
  glyph: number | null;
  /** Out at sea rather than on the territory — the counter goes below it. */
  outside: boolean;
};

/** Names put out to sea are all one size: they are not standing on anything. */
const SEA_LABEL_SIZE = 12;
/** Widest a sea label may be before it has to wrap, in map units. */
const SEA_LABEL_WIDTH = 150;
/** Clearance from the coast — enough to miss the shadow the land casts. */
const SEA_LABEL_GAP = 16;

const LINE_HEIGHT = 1.15;

/**
 * Lays out every name on the map at once.
 *
 * Each territory would rather carry its own name: that is what a label on a map
 * means. Where the ground is too small for the name — the islands, the slivers
 * between two large fields — the name is put in the open water directly above
 * or below instead, whichever side is empty, which is how an atlas labels an
 * island too small to write on.
 *
 * Space is claimed, not shared. Territories are laid out largest first, each
 * reserving the rectangle its name occupies, so a small field can never write
 * over a name that was already there. What finds nowhere to go is left unnamed
 * and says its name on hover — a map with every name on it and half of them
 * unreadable is worth less than a map with fewer.
 */
function placeLabels(
  shapes: MapShape[],
  titleOf: (domainId: string) => string,
  bounds: { width: number; height: number },
  /** Space already spoken for — the continents' own names, written first. */
  reserved: Rect[]
): Map<string, Placement> {
  const placements = new Map<string, Placement>();
  // The land is an obstacle for a name that has been pushed off its territory:
  // out at sea is the only place such a name is not on top of something.
  const land: Rect[] = shapes.map((shape) => ({
    x: shape.x,
    y: shape.y,
    w: shape.width,
    h: shape.height,
  }));
  const taken: Rect[] = [...reserved];

  const free = (rect: Rect, against: Rect[]): boolean =>
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.x + rect.w <= bounds.width &&
    rect.y + rect.h <= bounds.height &&
    !against.some((other) => overlaps(rect, other));

  for (const shape of [...shapes].sort((a, b) => b.room - a.room)) {
    const title = titleOf(shape.domainId);

    // The icon is sized against the territory rather than against the text —
    // big enough to be read as the thing the area *is*, from across the map.
    const glyphAlone = Math.max(24, Math.min(76, shape.room * 0.9));

    const size = Math.max(11, Math.min(18, shape.room * 0.3));
    const inside = fitLines(title, size, shape.span * 0.92);

    if (inside) {
      const textHeight = inside.length * size * LINE_HEIGHT;
      const gap = size * 0.45;
      const withGlyph = shape.room * 2 > glyphAlone + gap + textHeight + size * 0.8;
      const blockHeight = (withGlyph ? glyphAlone + gap : 0) + textHeight;
      const rect: Rect = {
        x: shape.cx - lineWidth(inside, size) / 2,
        y: shape.cy - blockHeight / 2,
        w: lineWidth(inside, size),
        h: blockHeight,
      };
      if (free(rect, taken)) {
        taken.push(rect);
        placements.set(shape.domainId, {
          lines: inside,
          size,
          x: shape.cx,
          y: rect.y + (withGlyph ? glyphAlone + gap : 0) + size * 0.78,
          glyph: withGlyph ? glyphAlone : null,
          outside: false,
        });
        continue;
      }
    }

    // Too small to write on. The icon still fits more often than the name does,
    // so it stays where it was and only the name goes looking for water.
    const glyph = shape.room * 2 > glyphAlone + 4 ? glyphAlone : null;
    const sea = fitLines(title, SEA_LABEL_SIZE, SEA_LABEL_WIDTH);
    if (!sea) continue;

    const w = lineWidth(sea, SEA_LABEL_SIZE) + 8;
    const h = sea.length * SEA_LABEL_SIZE * LINE_HEIGHT + 4;

    // Below first, then above, and each of those centred before it is allowed to
    // slide along the coast or stand further off it. The order is the order of
    // preference: the closer and the more centred, the more obviously the name
    // belongs to the ground it is pointing at.
    const candidates: Rect[] = [];
    for (const reach of [1, 2.2]) {
      for (const dx of [0, -w * 0.45, w * 0.45]) {
        const gap = SEA_LABEL_GAP * reach;
        candidates.push({ x: shape.cx - w / 2 + dx, y: shape.y + shape.height + gap, w, h });
        candidates.push({ x: shape.cx - w / 2 + dx, y: shape.y - gap - h, w, h });
      }
    }

    const spot = candidates.find((rect) => free(rect, [...land, ...taken]));
    if (!spot) continue;

    taken.push(spot);
    placements.set(shape.domainId, {
      lines: sea,
      size: SEA_LABEL_SIZE,
      // The centre of the spot that was actually free, not of the territory —
      // a candidate that slid along the coast to find room has to be written
      // where it found it.
      x: spot.x + spot.w / 2,
      y: spot.y + SEA_LABEL_SIZE * 0.9,
      glyph,
      outside: true,
    });
  }

  return placements;
}

function Label({
  shape,
  placement,
  domainId,
  title,
  counter,
  showCounter,
  faded,
}: {
  shape: MapShape;
  /** Where the fitting pass put this name, or null if it found nowhere. */
  placement: Placement | null;
  domainId: string;
  title: string;
  counter: string;
  showCounter: boolean;
  /** Ruled out by a filter or a search — the veil is over the land, not the name. */
  faded: boolean;
}) {
  // A territory that found nowhere for its name says it on hover anyway, at its
  // own label point: nothing else is competing for that space at that moment,
  // and a name that overruns a border for as long as the pointer is on it is
  // worth more than no name at all.
  const shown: Placement =
    placement ??
    {
      lines: fitLines(title, SEA_LABEL_SIZE, shape.span * 0.92) ?? [title],
      size: SEA_LABEL_SIZE,
      x: shape.cx,
      y: shape.cy + SEA_LABEL_SIZE * 0.36,
      glyph: null,
      outside: false,
    };
  if (!placement && !showCounter) return null;

  const lineHeight = shown.size * LINE_HEIGHT;
  const lastLineY = shown.y + (shown.lines.length - 1) * lineHeight;

  // A halo, not an outline. `strokeLinejoin: round` is the whole trick: the
  // default miter join throws long spikes off every sharp corner of a glyph,
  // which is what made the old thick stroke look serrated. The halo is nearly
  // opaque — over a coloured field a translucent one lets the ground through
  // and the name stops being readable at all.
  const halo = {
    fill: MAP_INK,
    paintOrder: 'stroke' as const,
    stroke: MAP_HALO,
    strokeWidth: 3.2,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
    strokeOpacity: 0.9,
  };

  return (
    <g textAnchor="middle" opacity={faded ? 0.65 : 1}>
      {/* The same halo the names get, and for the same reason: line art in one
          dark colour vanishes into a strongly coloured field. Drawn as a thick
          pale pass with the ink laid over it. */}
      {shown.glyph ? (
        <>
          <DomainGlyph
            domainId={domainId}
            x={shape.cx}
            y={glyphCentre(shown, shape)}
            size={shown.glyph}
            colour={MAP_HALO}
            opacity={0.85}
            strokeWidth={5}
          />
          <DomainGlyph
            domainId={domainId}
            x={shape.cx}
            y={glyphCentre(shown, shape)}
            size={shown.glyph}
            colour={MAP_INK}
            opacity={0.85}
            strokeWidth={2}
          />
        </>
      ) : null}
      {shown.lines.map((line, index) => (
        <text
          key={line}
          x={shown.x}
          y={shown.y + index * lineHeight}
          fontSize={shown.size}
          fontWeight={700}
          style={halo}
        >
          {line}
        </text>
      ))}
      {showCounter ? (
        <text
          x={shown.x}
          y={lastLineY + shown.size + 3}
          fontSize={shown.size * 0.75}
          fontWeight={600}
          style={halo}
        >
          {counter}
        </text>
      ) : null}
    </g>
  );
}

/**
 * Where the icon sits: under a name written on the territory it belongs to, in
 * the middle of the territory when the name was sent out to sea.
 */
function glyphCentre(placement: Placement, shape: MapShape): number {
  if (placement.outside || !placement.glyph) return shape.cy;
  const textHeight = placement.lines.length * placement.size * LINE_HEIGHT;
  const gap = placement.size * 0.45;
  return shape.cy - (placement.glyph + gap + textHeight) / 2 + placement.glyph / 2;
}
