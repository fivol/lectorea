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
const MAP_HALO_SEA = 'var(--map-halo-sea)';

/**
 * The sea, as a value the screen around the map can paint itself with — so the
 * ocean runs to the edges of the window instead of stopping at the drawing's
 * corners. The map is the surface of the page here, not a picture placed on it.
 */
export const MAP_SEA = 'var(--map-sea)';

/**
 * The two lines on the map, in map units.
 *
 * They are not the same line at different weights: a coast separates land from
 * water and a border separates two washes of one continent's own hue, so the
 * coast is drawn heavier and the border only has to be seen. Both used to be
 * thick white ribbons, which on an outline that scallops around every hex made
 * the continents read as a bag of marshmallows rather than as ground.
 */
const BORDER = 1.6;
const BORDER_HOVER = 2.8;
const COAST = 2.8;

/**
 * How far the water brightens as it shallows towards a shore, in map units.
 *
 * The landmasses are drawn a second time underneath themselves, blurred, in the
 * shallows colour; the opaque land then covers everything but the falloff, which
 * is left standing in the water all the way round. Blurred rather than a stack
 * of wide strokes — hard-edged strokes step, and three visible steps around a
 * continent look like a target, not like water.
 *
 * This is what holds the continents off the sea now. The map used to stand on a
 * hard copy of its own coast offset ten units down, and an offset shadow with no
 * blur reads as a sticker on a page — the one thing a map must never look like.
 */
const SHORE_BLUR = 9;

/**
 * The continent titles: the largest lettering on the map, and the one set
 * widest apart. The tracking is in map units per letter, because the placer has
 * to know how far the title actually runs to keep the fields' names out of it.
 */
const CONTINENT_SIZE = 19;
const CONTINENT_TRACKING = CONTINENT_SIZE * 0.24;
/**
 * Clear water around a continent's title that no other name may enter — wider
 * to the sides than above and below, because the damage is done along the line
 * the title is written on: a field's name that comes up beside it reads as the
 * next word of the title, while one that sits under it plainly does not.
 */
const CONTINENT_AIR = { x: CONTINENT_SIZE * 2, y: CONTINENT_SIZE * 0.5 };

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
          const width = textWidth(title, CONTINENT_SIZE, CONTINENT_TRACKING);
          return {
            id: mass.continent,
            cx: mass.x + mass.width / 2,
            y,
            // The band a territory's name may not be written into. A continent
            // is named once and read first; everything else gives way to it.
            //
            // With air around it, not just the letters: a field's name that
            // stops exactly where the title starts is not overlapping it, but
            // the reader still sees one run of words at two sizes.
            box: {
              x: mass.x + mass.width / 2 - width / 2 - CONTINENT_AIR.x,
              y: y - CONTINENT_SIZE - CONTINENT_AIR.y,
              w: width + CONTINENT_AIR.x * 2,
              h: CONTINENT_SIZE * 1.5 + CONTINENT_AIR.y * 2,
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
   * The lettering, with the territory under the pointer written last: its name
   * grows and gains a course count, and neither may end up under a neighbour's.
   */
  const labelled = map.shapes
    .flatMap((shape) => {
      const placement = placements.get(shape.domainId);
      return placement ? [{ shape, placement }] : [];
    })
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
        {/* The land itself, under everything: first the water brightening as it
            shallows towards every shore, then the pale ground the territories
            are washed over. Nothing here is a picture — the same paths the
            territories tile, so the coast and the borders can never drift apart
            at some window size. */}
        <defs>
          <filter id="map-shore" x="-6%" y="-6%" width="112%" height="112%">
            <feGaussianBlur stdDeviation={SHORE_BLUR} />
          </filter>
        </defs>
        <g filter="url(#map-shore)">
          {map.landmasses.map((mass, index) => (
            <path key={`shore-${index}`} d={mass.d} style={{ fill: 'var(--map-surf)' }} />
          ))}
        </g>
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
                  strokeWidth={isHovered ? BORDER_HOVER : BORDER}
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

        {/* The shoreline, over the territories that meet it: the coastal
            territories each draw their own border along it, and without this
            the edge of a continent would be told in the same weight as the line
            between two of its fields. */}
        {map.landmasses.map((mass, index) => (
          <path
            key={`coast-${index}`}
            d={mass.d}
            fill="none"
            strokeWidth={COAST}
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
          {/* The branch of knowledge a continent is, written over open water in
              the manner an atlas names an ocean: wide apart, unemphatic, and
              light enough that nothing on the ground has to fight it. Bold dark
              capitals here read as a heading pasted over the map. */}
          {continents.map((continent) => (
            <text
              key={continent.id}
              x={continent.cx}
              y={continent.y}
              textAnchor="middle"
              fontSize={CONTINENT_SIZE}
              fontWeight={600}
              letterSpacing={CONTINENT_TRACKING}
              opacity={0.55}
              style={{
                fill: MAP_INK,
                paintOrder: 'stroke',
                stroke: MAP_HALO_SEA,
                strokeWidth: CONTINENT_SIZE * 0.28,
                strokeLinejoin: 'round',
                strokeOpacity: 0.7,
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
                hovered={hovered === domain.id}
                faded={emphasisOf(domain.id) === 'dim'}
                onHover={(isHovered) =>
                  setHovered((current) =>
                    isHovered ? domain.id : current === domain.id ? null : current
                  )
                }
                onSelect={() => navigate(`/courses?domain=${encodeURIComponent(domain.id)}`)}
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

/**
 * How much air a name is given between its letters, as a share of its size.
 * Small lettering over a coloured field closes up and turns into a bar; a
 * little tracking is what keeps a five-letter name at 11 units a word.
 */
const TRACKING = 0.03;

/** Rough width of a bold line at a given size — no measuring in an SVG. */
const textWidth = (text: string, size: number, tracking = size * TRACKING): number =>
  text.length * (size * 0.62 + tracking);

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
 * `y` is the baseline of the first line and `lines` is empty when no name would
 * go anywhere — the icon is still drawn, and the name waits for the pointer.
 * `glyph` is the diameter of the icon at the territory's own label point, or
 * null where even that does not fit.
 */
type Placement = {
  lines: string[];
  size: number;
  x: number;
  y: number;
  glyph: number | null;
  /** Out at sea rather than on the territory — it answers the pointer itself. */
  outside: boolean;
  /** The rectangle the name occupies out at sea: its hit area. */
  box: Rect | null;
};

/** Below this an icon is a smudge rather than a picture of anything. */
const MIN_GLYPH = 18;

/**
 * The three sizes a territory's name is written at, and the room each one asks
 * for.
 *
 * Sizing every name off the ground under it gave thirty-eight fields thirty-
 * eight sizes, and a reader cannot see an order in that — only that the
 * lettering is uneven. Three steps say what the continuous scale meant to: this
 * is one of the large fields, this is one of the small ones.
 */
const NAME_STEPS: Array<{ room: number; size: number }> = [
  { room: 50, size: 16.5 },
  { room: 32, size: 13 },
  { room: 0, size: 11 },
];

const nameSize = (room: number): number =>
  NAME_STEPS.find((step) => room >= step.room)!.size;

/** Names put out to sea are all one size: they are not standing on anything. */
const SEA_LABEL_SIZE = 12;
/** Widest a sea label may be before it has to wrap, in map units. */
const SEA_LABEL_WIDTH = 150;
/** Clearance from the coast — far enough out to be past the shallows. */
const SEA_LABEL_GAP = SHORE_BLUR * 2.2;

const LINE_HEIGHT = 1.15;

/**
 * How much of the ground a name may run across before it is sent out to sea.
 * The rest is the margin that keeps the last letter off the border — and it is
 * measured against an estimate of the width, so it cannot be cut much finer.
 */
const NAME_FIT = 0.95;

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

    const size = nameSize(shape.room);
    const inside = fitLines(title, size, shape.span * NAME_FIT);

    if (inside) {
      const textHeight = inside.length * size * LINE_HEIGHT;
      const gap = size * 0.45;
      // The icon takes what the name leaves, down to a size below which it stops
      // being a picture of anything — a territory that cannot hold both at once
      // gets a smaller icon rather than none.
      const spare = shape.room * 2 - textHeight - gap - size * 0.4;
      const glyphSize = Math.min(glyphAlone, spare);
      const withGlyph = glyphSize >= MIN_GLYPH;
      const blockHeight = (withGlyph ? glyphSize + gap : 0) + textHeight;
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
          y: rect.y + (withGlyph ? glyphSize + gap : 0) + size * 0.78,
          glyph: withGlyph ? glyphSize : null,
          outside: false,
          box: null,
        });
        continue;
      }
    }

    // Too small to write on. The icon stays where it was — a territory with an
    // icon and no name still says what it is — and only the name goes looking
    // for water.
    const glyph = shape.room * 2 > glyphAlone + 4 ? glyphAlone : null;
    const iconOnly: Placement = {
      lines: [],
      size,
      x: shape.cx,
      y: shape.cy,
      glyph,
      outside: false,
      box: null,
    };

    const sea = fitLines(title, SEA_LABEL_SIZE, SEA_LABEL_WIDTH);
    if (!sea) {
      placements.set(shape.domainId, iconOnly);
      continue;
    }

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
    if (!spot) {
      placements.set(shape.domainId, iconOnly);
      continue;
    }

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
      box: spot,
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
  hovered,
  faded,
  onHover,
  onSelect,
}: {
  shape: MapShape;
  placement: Placement;
  domainId: string;
  title: string;
  counter: string;
  /** The territory under the pointer is this one. */
  hovered: boolean;
  /** Ruled out by a filter or a search — the veil is over the land, not the name. */
  faded: boolean;
  /** A name standing out at sea answers the pointer for its own territory. */
  onHover: (hovered: boolean) => void;
  onSelect: () => void;
}) {
  // A territory that found nowhere for its name says it on hover anyway, at its
  // own label point: nothing else is competing for that space at that moment,
  // and a name that overruns a border for as long as the pointer is on it is
  // worth more than no name at all.
  const named = placement.lines.length > 0;
  const lines = named ? placement.lines : (fitLines(title, SEA_LABEL_SIZE, shape.span * NAME_FIT) ?? [title]);
  const size = named ? placement.size : SEA_LABEL_SIZE;
  const nameY = named
    ? placement.y
    : shape.cy + (placement.glyph ? placement.glyph / 2 + size : size * 0.36);

  const lineHeight = size * LINE_HEIGHT;
  const lastLineY = nameY + (lines.length - 1) * lineHeight;
  const glyphY = glyphCentre(placement, shape);

  // A halo, not an outline. `strokeLinejoin: round` is the whole trick: the
  // default miter join throws long spikes off every sharp corner of a glyph,
  // which is what made the old thick stroke look serrated. The halo is nearly
  // opaque — over a coloured field a translucent one lets the ground through
  // and the name stops being readable at all.
  //
  // Its colour is the ground the name is written on, not one colour for the
  // whole map: a pale halo out at sea is a smear of fog around every offshore
  // name, and the ocean is the one place on the map where nothing else is
  // competing for the reader's eye.
  //
  // The weight scales with the lettering. A fixed one made the small names on
  // the slivers look outlined and the large ones look unprotected.
  const halo = {
    fill: MAP_INK,
    paintOrder: 'stroke' as const,
    stroke: placement.outside ? MAP_HALO_SEA : MAP_HALO,
    strokeWidth: size * (hovered ? 0.3 : 0.24),
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
    strokeOpacity: 0.92,
  };

  // Pointing at a territory has to be visible on its name too, or a name
  // standing off in the water belongs to whichever territory the reader
  // guesses. It grows a little about its own anchor — enough to read as picked
  // out, not enough to move it somewhere else.
  const lift = (x: number, y: number): string | undefined =>
    hovered ? `translate(${x} ${y}) scale(1.08) translate(${-x} ${-y})` : undefined;

  return (
    <g textAnchor="middle" opacity={faded ? 0.65 : 1}>
      {/* Which ground this name is for. Only while it is pointed at: a map with
          a leader off every offshore name is a map of leaders. */}
      {hovered && placement.box ? (
        <line
          x1={placement.x}
          // From the edge of the label that faces the territory, so the line
          // never crosses the words it is coming from.
          y1={
            shape.cy > placement.box.y + placement.box.h
              ? placement.box.y + placement.box.h
              : placement.box.y
          }
          x2={shape.cx}
          y2={shape.cy}
          style={{
            stroke: MAP_INK,
            strokeWidth: 1.4,
            strokeOpacity: 0.45,
            strokeLinecap: 'round',
          }}
        />
      ) : null}

      {/* The same halo the names get, and for the same reason: line art in one
          dark colour vanishes into a strongly coloured field. Drawn as a thick
          pale pass with the ink laid over it. */}
      {placement.glyph ? (
        <g transform={lift(shape.cx, glyphY)}>
          <DomainGlyph
            domainId={domainId}
            x={shape.cx}
            y={glyphY}
            size={placement.glyph}
            colour={MAP_HALO}
            opacity={0.85}
            strokeWidth={5}
          />
          <DomainGlyph
            domainId={domainId}
            x={shape.cx}
            y={glyphY}
            size={placement.glyph}
            colour={MAP_INK}
            opacity={hovered ? 1 : 0.85}
            strokeWidth={hovered ? 2.6 : 2}
          />
        </g>
      ) : null}

      {named || hovered ? (
        // A name in the water is the only lettering on the map with nothing
        // around it, which is enough to make it the loudest thing on screen.
        // Held back a little so the fields are read before the strays.
        <g transform={lift(placement.x, nameY)} opacity={placement.outside && !hovered ? 0.84 : 1}>
          {lines.map((line, index) => (
            <text
              key={line}
              x={placement.x}
              y={nameY + index * lineHeight}
              fontSize={size}
              // A name standing in the water is not the name of that water: it
              // is set lighter than the names written on their own ground, so
              // the eye reads the fields first and the strays after them.
              fontWeight={placement.outside ? 600 : 700}
              letterSpacing={size * TRACKING}
              style={halo}
            >
              {line}
            </text>
          ))}
          {hovered ? (
            <text
              x={placement.x}
              y={lastLineY + size * 0.92 + 3}
              fontSize={size * 0.72}
              fontWeight={500}
              letterSpacing={size * TRACKING}
              // How many courses is an answer to pointing at a field, not part
              // of its name — quieter than the name it hangs under.
              style={{ ...halo, fillOpacity: 0.68 }}
            >
              {counter}
            </text>
          ) : null}
        </g>
      ) : null}

      {/* A name out at sea is the only part of a territory that is nowhere near
          it, so it carries its own hit area — otherwise the reader points at the
          words and nothing lights up. Text is hit glyph by glyph, hence a plain
          rectangle over the whole label rather than the text itself. */}
      {placement.box ? (
        <rect
          x={placement.box.x}
          y={placement.box.y}
          width={placement.box.w}
          height={placement.box.h}
          fill="transparent"
          style={{ pointerEvents: 'all', cursor: 'pointer' }}
          onPointerEnter={() => onHover(true)}
          onPointerLeave={() => onHover(false)}
          onClick={onSelect}
        />
      ) : null}
    </g>
  );
}

/**
 * Where the icon sits: under a name written on the territory it belongs to, in
 * the middle of the territory when the name was sent out to sea.
 */
function glyphCentre(placement: Placement, shape: MapShape): number {
  if (placement.outside || !placement.glyph || !placement.lines.length) return shape.cy;
  const textHeight = placement.lines.length * placement.size * LINE_HEIGHT;
  const gap = placement.size * 0.45;
  return shape.cy - (placement.glyph + gap + textHeight) / 2 + placement.glyph / 2;
}
