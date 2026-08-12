import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useCatalog } from '@/lib/catalog';
import { loadMapSvg, type MapVariant } from '@/lib/data';
import { parseMapSvg, type MapShape, type ParsedMap } from '@/lib/map';
import { useReducedMotion } from '@/lib/hooks';
import { DomainGlyph } from '@/components/DomainIcon';
import { useResolvedTheme } from '@/store/profile';
import { Plate, PlateDivider, IconButton } from '@/components/ui';
import { SLAB } from '@shared/view';
import { hexPath } from '@shared/tiles';
import { groundOf, HEX_CLIP } from './ground';
import { useMapViewport, ZOOM_STEP, type MapPlan } from './viewport';

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
 * How thick the land is, in map units.
 *
 * Two thirds of a cell, and so about twice what the tile collection gives one
 * cell of ground. Deliberately: the collection draws a cell you are standing
 * next to, and this is a continent seen from across the room, where the true
 * edge of a single cell comes out at four units and reads as a slightly soft
 * coastline rather than as a coast with a side to it. The cliff is the one
 * thing on this map saying it is not a plan, so it is drawn loud enough to be
 * heard.
 *
 * `SLAB` is what it is measured against, so the two cannot drift into different
 * worlds — if the collection ever decides the ground is twice as deep as it
 * thought, the coast follows. The cell is the map's own, read back off its
 * outlines: the wide map and the tall one are drawn on different grids, and a
 * wall measured in one of them is the wrong wall on the other.
 */
const CELL_FALLBACK = 16;
const depthOf = (map: ParsedMap): number => SLAB * 2 * (map.grid?.r ?? CELL_FALLBACK);

/**
 * The cliff, drawn as a stack of copies of the coastline rather than as a
 * second outline offset down.
 *
 * A shape and one copy of it a wall's height lower do not add up to the shape
 * swept that far: everywhere the land is thinner north to south than the wall
 * is deep — a spit, a cape, the neck between two lobes — the two copies miss
 * each other and a hole opens in the middle of the cliff. Copies close enough
 * together that nothing on this map can fall between them are the cheapest
 * honest answer, and they are opaque, so the overlap is invisible.
 */
const CLIFF_STEPS = 12;
const cliffOf = (depth: number): number[] =>
  Array.from({ length: CLIFF_STEPS }, (_, index) => (depth * (CLIFF_STEPS - 1 - index)) / CLIFF_STEPS);

/**
 * How strongly the ground inside a territory is drawn, and how strongly the
 * water outside them all.
 *
 * Well under half. The relief is scenery: what a reader is here to find is a
 * field's name and its colour, and both are read *through* whatever is drawn on
 * the ground under them. At full strength a range under a name turns the name
 * into a word on a mountain — the halo saves the letters and the reading is
 * still slower. The sea is quieter still, because the names that stand in it
 * have nothing but their own halo behind them.
 *
 * Dimmed, a territory keeps a trace: the ground is the shape of the field, and
 * a field that empties itself reads as one that has lost its data rather than
 * as one that is out of the current answer.
 */
const GROUND_INK = 0.5;
const GROUND_DIM = 0.16;
const OCEAN_INK = 0.42;

/**
 * The continent titles: the largest lettering on the map, and the one set
 * widest apart. The tracking is a share of the size rather than a number of
 * units, because the placer has to know how far the title actually runs to keep
 * the fields' names out of it, and the size now moves.
 */
const CONTINENT_SIZE = 19;
const CONTINENT_TRACKING = 0.24;
/**
 * Clear water around a continent's title that no other name may enter — wider
 * to the sides than above and below, because the damage is done along the line
 * the title is written on: a field's name that comes up beside it reads as the
 * next word of the title, while one that sits under it plainly does not.
 */
const CONTINENT_AIR = { x: 2, y: 0.5 };

/**
 * How the lettering answers the magnification.
 *
 * Everything written on the map — the names, the counts, the icons, the halo
 * behind them — is sized in what the reader sees rather than in what the map
 * measures, and it takes only a share of the magnification: go four times in
 * and the ground is four times bigger while the names are not quite twice.
 *
 * Neither end of that is arbitrary. Lettering that grew with the ground would
 * make zooming useless — the same map at the same density, drawn larger, with
 * fewer fields on screen. Lettering that held perfectly still is the other
 * mistake, and the one this started as: standing over a continent that fills
 * the window and reading it through eight-pixel labels is a magnifying glass
 * pointed at everything except the words. A share of the growth gets both — the
 * names shrink against the ground, so a territory too small to be named at rest
 * names itself as the reader goes in, and they still come up large enough to be
 * read comfortably at the end of the journey.
 *
 * Measured from the resting size and not from 1, so that a map drawn small
 * because the display is large is still lettered for the size it was drawn at —
 * otherwise the names on a wall display would come out twice the weight of the
 * same names on a laptop.
 */
const LETTERING_GROWTH = 0.4;

/**
 * How often it answers: four steps per doubling of the magnification.
 *
 * Re-fitting on every frame would have names blinking in and out along the
 * whole travel of a pinch — a name that only just fits its territory sits on
 * the boundary and crosses it over and over. On steps the map re-letters itself
 * a handful of times across the range and holds still in between, and the price
 * is that inside one step the lettering drifts by a few percent of its size,
 * which nobody has ever seen.
 */
const LETTERING_STEPS = 4;

/** One unit of lettering, in map units, at a given magnification. */
const letteringScale = (zoom: number, rest: number): number => {
  const times = Math.max(zoom / rest, 1);
  const stepped = 2 ** (Math.round(Math.log2(times) * LETTERING_STEPS) / LETTERING_STEPS);
  return stepped ** (LETTERING_GROWTH - 1);
};

/**
 * The chrome the map is drawn under but not fitted under, in screen pixels.
 *
 * The drawing runs edge to edge — the sea has to carry on behind the header or
 * the header reads as a lid on it, and a map that slides under its own controls
 * when it is dragged is a map rather than a picture in a frame. What it is
 * *fitted* to is the part of the window a reader can actually see: the wordmark
 * and the search field along the top, the legend and the plate of controls
 * along the bottom.
 */
const CHROME: Record<MapVariant, { top: number; bottom: number }> = {
  wide: { top: 132, bottom: 48 },
  // A tall window carries more of it: the search sits closer to the top of a
  // narrow screen, and along the bottom there is the view switch under the
  // plate of map controls, with the contribute line under that again.
  portrait: { top: 124, bottom: 108 },
};

/**
 * How much air the land is given on each side when the window is fitted to it,
 * as a share of the land's own size.
 *
 * Not symmetric, and not for looks: a continent is named above its northern
 * coast and the islands too small to be written on put their names in the water
 * below, so the drawing overruns its own coastlines by more underneath than on
 * top and hardly at all to the sides.
 */
const CONTENT_AIR = { x: 0.03, top: 0.075, bottom: 0.08 };

/**
 * What the map asks the viewport for: the box it covers, the box it is worth
 * showing, and the chrome in between.
 *
 * The two boxes differ by a third of the drawing's width. `map.svg` is a
 * rectangle with the continents in the middle of it and open water all round,
 * and fitting the rectangle to the window is what left the land at two thirds
 * the size of the room it had. The water is scenery — it may run off the edges,
 * and on most windows it should.
 */
function planOf(map: ParsedMap, depth: number, variant: MapVariant): MapPlan {
  const land = map.landmasses;
  const x0 = Math.min(...land.map((mass) => mass.x));
  const y0 = Math.min(...land.map((mass) => mass.y));
  const x1 = Math.max(...land.map((mass) => mass.x + mass.width));
  // The cliffs hang below the southern coasts, and what a reader has to see
  // goes down with them.
  const y1 = Math.max(...land.map((mass) => mass.y + mass.height)) + depth;
  const air = { x: (x1 - x0) * CONTENT_AIR.x, top: (y1 - y0) * CONTENT_AIR.top, bottom: (y1 - y0) * CONTENT_AIR.bottom };
  return {
    extent: { width: map.width, height: map.height + depth },
    content: {
      x: x0 - air.x,
      y: y0 - air.top,
      w: x1 - x0 + air.x * 2,
      h: y1 - y0 + air.top + air.bottom,
    },
    inset: CHROME[variant],
  };
}

/**
 * The rectangle the shallows are worked out in: what the reader can see, and a
 * blur's worth of margin so the falloff finishes rather than stopping square.
 *
 * Rounded outwards onto a coarse grid, so that dragging the map redefines the
 * region a few times rather than sixty times a second — a filter whose region
 * changes is a filter that has to be rasterised again.
 */
const SHORE_GRID = 64;

function shoreRegion(
  window: { x: number; y: number; w: number; h: number } | null,
  extent: { width: number; height: number }
): { x: number; y: number; width: number; height: number } {
  const seen = window ?? { x: 0, y: 0, w: extent.width, h: extent.height };
  const margin = SHORE_BLUR * 4;
  const x = Math.floor((seen.x - margin) / SHORE_GRID) * SHORE_GRID;
  const y = Math.floor((seen.y - margin) / SHORE_GRID) * SHORE_GRID;
  const right = Math.ceil((seen.x + seen.w + margin) / SHORE_GRID) * SHORE_GRID;
  const bottom = Math.ceil((seen.y + seen.h + margin) / SHORE_GRID) * SHORE_GRID;
  return { x, y, width: right - x, height: bottom - y };
}

type Props = {
  /** Domains matching the current search; empty means "no query typed". */
  matched: Set<string>;
  searchActive: boolean;
  /** Domains carrying materials from the active provider filter, or null. */
  allowed: Set<string> | null;
  /**
   * Which drawing of the world to open. The screen decides — it is a question
   * about the shape of the window, and the screen is what the window is.
   */
  variant: MapVariant;
};

type Emphasis = 'full' | 'dim';

/**
 * The first screen is a shop window, so animation is allowed here in a way it
 * is not in the graph — but it still yields to `prefers-reduced-motion`, which
 * leaves colour changes and drops the movement.
 */
export default function MapView({ matched, searchActive, allowed, variant }: Props) {
  const catalog = useCatalog();
  const navigate = useNavigate();
  const { t, count } = useT();
  const reducedMotion = useReducedMotion();
  const scheme = useResolvedTheme();

  const [map, setMap] = useState<ParsedMap | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);

  /**
   * What the reader has done to the drawing: how far in, and where.
   *
   * Null until the file has loaded, which is also what tells the viewport the
   * svg now exists to listen on.
   */
  /** How deep the cliffs are on the file that actually loaded. */
  const depth = map ? depthOf(map) : 0;
  const plan = useMemo(
    () => (map ? planOf(map, depth, variant) : null),
    [map, depth, variant]
  );
  const viewport = useMapViewport(plan);

  /** One unit of lettering, in map units, at the magnification now showing. */
  const scale = letteringScale(viewport.zoom, viewport.rest);

  /**
   * Entering a field — and a press that moved the map is not a press on
   * whatever it started over.
   *
   * Held still between renders because the whole drawing hangs off it: a fresh
   * function every render would rebuild the map on every frame of a pinch,
   * which is the one thing the drawing's own memo exists to prevent.
   */
  const moved = viewport.moved;
  const open = useCallback(
    (domainId: string): void => {
      if (moved()) return;
      navigate(`/courses?domain=${encodeURIComponent(domainId)}`);
    },
    [moved, navigate]
  );

  useEffect(() => {
    let cancelled = false;
    loadMapSvg(variant)
      .then((text) => {
        if (!cancelled) setMap(parseMapSvg(text));
      })
      .catch(() => setMap(null));
    return () => {
      cancelled = true;
    };
  }, [variant]);

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
          const size = CONTINENT_SIZE * scale;
          const tracking = size * CONTINENT_TRACKING;
          const y = Math.max(mass.y - 20, size + 8);
          const width = textWidth(title, size, tracking);
          const air = { x: size * CONTINENT_AIR.x, y: size * CONTINENT_AIR.y };
          return {
            id: mass.continent,
            cx: mass.x + mass.width / 2,
            y,
            size,
            tracking,
            // The band a territory's name may not be written into. A continent
            // is named once and read first; everything else gives way to it.
            //
            // With air around it, not just the letters: a field's name that
            // stops exactly where the title starts is not overlapping it, but
            // the reader still sees one run of words at two sizes.
            box: {
              x: mass.x + mass.width / 2 - width / 2 - air.x,
              y: y - size - air.y,
              w: width + air.x * 2,
              h: size * 1.5 + air.y * 2,
            },
          };
        }),
    [map, t, scale]
  );

  /**
   * What each field is made of — mountains, forest, sand — and what the water
   * between them does. A pass over the whole map, so it is done once and never
   * again: nothing about it answers a pointer or a filter.
   *
   * The theme is in it because the sea has a colour and that colour follows the
   * light and the dark; the land does not, and is redrawn identically.
   */
  const ground = useMemo(
    () => (map ? groundOf(map, scheme) : { fields: [], ocean: '' }),
    [map, scheme]
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
            // The cliffs hang below the southern coasts, and the water a name
            // may stand in goes down with them.
            { width: map.width, height: map.height + depth },
            continents.map((continent) => continent.box),
            scale,
            depth
          )
        : new Map<string, Placement>(),
    [map, t, continents, scale, depth]
  );

  /**
   * The drawing itself, built once and held.
   *
   * Nothing in here answers the viewport: where the map has been moved to and
   * how far in are one transform on the group around it, and a frame of a
   * pinch changes that attribute and nothing else. Without this the whole
   * map — every hex of relief, every cliff, every name — was reconsidered
   * sixty times a second while the reader zoomed, which is what made the
   * gesture stutter under its own weight.
   *
   * What it does answer is on the list below: the pointer, the filters, the
   * language, the theme, and the size the lettering is currently written at.
   */
  const drawing = useMemo(() => {
    if (!map) return null;

    /**
     * Dimming answers a filter, never a cursor.
     *
     * Hovering used to grey out every territory except the one under the
     * pointer and the ones it draws from — which made moving the mouse across
     * the map flash three quarters of it on and off, and told you about a
     * dependency graph nobody had asked to see. Pointing at something is not a
     * question; it gets a slightly stronger fill and a heavier border on that
     * one territory, and nothing else on the map moves.
     */
    const emphasisOf = (domainId: string): Emphasis => {
      if (allowed && !allowed.has(domainId)) return 'dim';
      // Zero results must not black out the whole map — the "nothing found"
      // line says it instead.
      if (searchActive && matched.size) return matched.has(domainId) ? 'full' : 'dim';
      return 'full';
    };

    /**
     * The lettering, with the territory under the pointer written last: its
     * name grows and gains a course count, and neither may end up under a
     * neighbour's.
     */
    const labelled = map.shapes
      .flatMap((shape) => {
        const placement = placements.get(shape.domainId);
        return placement ? [{ shape, placement }] : [];
      })
      .sort(
        (a, b) => Number(a.shape.domainId === hovered) - Number(b.shape.domainId === hovered)
      );

    /**
     * SVG has no z-index — paint order is document order, so a territory drawn
     * earlier sits under its neighbours. The one under the pointer is moved to
     * the end, or the heavier border it takes is painted over from both sides
     * by whatever is drawn after it and the highlight shows on one edge only.
     */
    const ordered = hovered
      ? [
          ...map.shapes.filter((shape) => shape.domainId !== hovered),
          ...map.shapes.filter((shape) => shape.domainId === hovered),
        ]
      : map.shapes;

    return (
      <>
          {/*
            The sea itself, in the collection's own pieces: shoals and reefs and
            rocks where the bottom comes up near a coast, swell and the odd
            current out in the open.

            Drawn past the edges of the map on every side. The drawing is fitted
            into the window, so on most windows there is viewport left over above
            and below it — and an svg clips to its viewport rather than to its
            viewBox, so the water carries on out into the bands instead of
            stopping at a rectangle nobody drew.

            At the foot of the cliffs, like the shallows below: the surface of the
            sea is where the land stands *in* it, not where the ground on top of
            the land is.
          */}
          <g
            className="pointer-events-none"
            aria-hidden="true"
            opacity={OCEAN_INK}
            transform={`translate(0 ${depth})`}
            dangerouslySetInnerHTML={{ __html: ground.ocean }}
          />

          {/* The water brightening as it shallows towards every shore, all of it
              in one pass and under all of the land. It belongs to the surface of
              the sea, which is at the foot of the cliffs rather than at the top
              of them — hence the drop. */}
          <g filter="url(#map-shore)" transform={`translate(0 ${depth})`}>
            {map.landmasses.map((mass, index) => (
              <path key={`shore-${index}`} d={mass.d} style={{ fill: 'var(--map-surf)' }} />
            ))}
          </g>

          {/* Every landmass as the slab it is: the cliff, and the ground on top
              of it. Neither is a picture — both are the same coastline path the
              territories tile, so the wall and the borders can never drift apart
              at some window size.

              North to south, because a wall hangs southward across whatever is
              behind it: an island lying just off a coast has to be painted after
              the coast whose cliff comes down towards it. */}
          {[...map.landmasses]
            .sort((a, b) => a.y - b.y)
            .map((mass, index) => (
              <g key={`mass-${index}`}>
                <path
                  d={mass.d}
                  transform={`translate(0 ${depth})`}
                  style={{ fill: 'var(--map-cliff-foot)' }}
                />
                {cliffOf(depth).map((drop) => (
                  <path
                    key={drop}
                    d={mass.d}
                    transform={`translate(0 ${drop})`}
                    style={{ fill: 'var(--map-cliff)' }}
                  />
                ))}
                <path d={mass.d} style={{ fill: 'var(--map-land)' }} />
              </g>
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
                  style={{ transition: reducedMotion ? 'none' : 'opacity 220ms ease-out' }}
                  onPointerEnter={() => setHovered(domain.id)}
                  // Leaving a territory has to clear the highlight even when the
                  // pointer is still inside the svg — the sea is part of the map,
                  // and the dimming used to survive out there. Guarded against the
                  // enter/leave pair firing out of order when moving straight from
                  // one territory onto its neighbour.
                  onPointerLeave={() =>
                    setHovered((current) => (current === domain.id ? null : current))
                  }
                  onClick={() => open(domain.id)}
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
            What the fields are made of, on the map's own hexes: ranges, forest,
            plateau, sand. Over the shoreline rather than under it, because a
            mountain standing on the northernmost cell of a coast hides the water
            beyond it — the shore there is the far edge, not the near one.

            Light and shade only, never a fill: the colour under a piece of relief
            is the territory's, and on this map that colour is the data.
          */}
          <g className="pointer-events-none" aria-hidden="true">
            {ground.fields.map((patch) => (
              <g
                key={patch.domainId}
                opacity={emphasisOf(patch.domainId) === 'dim' ? GROUND_DIM : GROUND_INK}
                style={{ transition: reducedMotion ? 'none' : 'opacity 220ms ease-out' }}
                dangerouslySetInnerHTML={{ __html: patch.markup }}
              />
            ))}
          </g>

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
                fontSize={continent.size}
                fontWeight={600}
                letterSpacing={continent.tracking}
                opacity={0.55}
                style={{
                  fill: MAP_INK,
                  paintOrder: 'stroke',
                  stroke: MAP_HALO_SEA,
                  strokeWidth: continent.size * HALO,
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
                  scale={scale}
                  hovered={hovered === domain.id}
                  faded={emphasisOf(domain.id) === 'dim'}
                  onHover={(isHovered) =>
                    setHovered((current) =>
                      isHovered ? domain.id : current === domain.id ? null : current
                    )
                  }
                  onSelect={() => open(domain.id)}
                />
              );
            })}
          </g>
      </>
    );
  }, [
    map,
    ground,
    placements,
    continents,
    scale,
    hovered,
    allowed,
    matched,
    searchActive,
    catalog,
    t,
    count,
    open,
    navigate,
    reducedMotion,
  ]);

  if (!map) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-ink-faint">
        {t('ui.common.loading')}
      </div>
    );
  }

  const shore = shoreRegion(viewport.window, { width: map.width, height: map.height + depth });

  return (
    <div className="relative h-full w-full">
      <svg
        ref={viewport.ref}
        // Room under the map for the cliffs to hang in. The ground itself ends
        // at `map.height`; the land stands on top of the water rather than in
        // the middle of it, so the whole slab is below that line.
        viewBox={`0 0 ${map.width} ${map.height + depth}`}
        // `touch-none` hands the browser's own pan and pinch over to this
        // component: without it a finger on the map scrolls the page, and two
        // fingers zoom the document rather than the drawing.
        className={`map-enter h-full w-full touch-none select-none
                    ${viewport.panning ? 'map-grabbing' : ''}`}
        style={{ cursor: viewport.panning ? 'grabbing' : 'grab' }}
        role="group"
        aria-label={t('ui.a11y.mapRegion')}
        onPointerLeave={() => setHovered(null)}
        {...viewport.handlers}
      >
        <defs>
          {/*
            Room for the blur to finish in, given in map units rather than as a
            share of what is being filtered.

            A share cannot serve both: a continent is a thousand units across
            and a few percent of it is plenty of margin, while an island is
            forty across and the same few percent cut the shallows off square a
            third of the way out — which is exactly what it looked like. Stated
            once in absolute terms, the region covers the whole sea and every
            shore in it fades out properly.

            No larger than what the reader can see, though. A filter region is
            rasterised at the resolution it is displayed at, so a region the
            size of the whole map is a surface sixty-four times its own area
            once the reader is eight deep — for shallows that are almost all off
            screen. Shore that cannot be seen does not have to be worked out.
          */}
          <filter id="map-shore" filterUnits="userSpaceOnUse" {...shore}>
            <feGaussianBlur stdDeviation={SHORE_BLUR} />
          </filter>

          {/* The cell a flat tile is cut to. Written in the collection's unit
              hex rather than in map units: the clip is resolved inside the
              placement's own transform, where one radius is one cell. */}
          <clipPath id={HEX_CLIP}>
            <path d={hexPath(1.001)} />
          </clipPath>
        </defs>

        {/*
          The whole drawing under one transform: where the reader has moved the
          map to, and how far in. One group rather than a viewBox that moves,
          because the viewBox is also what the browser fits to the element — and
          the viewport needs that fitting to stay put underneath it to have
          anything to measure a gesture against.

          One attribute, and nothing inside it, is what a frame of a pinch
          changes: the drawing is built once and held (see `drawing` below), so
          moving the map is a matrix on seven thousand nodes rather than seven
          thousand nodes reconsidered.
        */}
        <g transform={viewport.transform}>{drawing}</g>
      </svg>

      {/* Kept clear of the plate in the other corner, which on a narrow window
          is the only thing between the legend and a sentence written over a row
          of buttons.

          Gone entirely on a phone. Wrapped onto four lines it is a paragraph
          lying across the bottom of the drawing, and what it says — that a
          field's area is its course count — the map goes on saying by itself. */}
      <p className="pointer-events-none absolute bottom-3 left-4 hidden max-w-[calc(100%-11rem)] text-xs text-ink-faint sm:block">
        {t('ui.map.legend')}
      </p>

      {/*
        The same three controls every map has ever had, for the readers whose
        pointer has no second gesture in it — a mouse, or a finger that would
        rather press something than pinch. Everything they do, a trackpad
        already does; they are here so that nothing is only reachable by knowing
        a gesture.

        Lifted a row on a phone, where the corner below belongs to the view
        switch: the switch is what a thumb reaches for, so it gets the bottom of
        the screen and the map's own controls stand above it.
      */}
      <Plate row className="absolute bottom-[4.25rem] right-4 sm:bottom-3">
        <IconButton
          icon="minus"
          label={t('ui.map.zoomOut')}
          disabled={viewport.fitted}
          className="disabled:pointer-events-none disabled:opacity-35"
          onClick={() => viewport.zoomBy(1 / ZOOM_STEP)}
        />
        <IconButton
          icon="plus"
          label={t('ui.map.zoomIn')}
          disabled={viewport.deepest}
          className="disabled:pointer-events-none disabled:opacity-35"
          onClick={() => viewport.zoomBy(ZOOM_STEP)}
        />
        <PlateDivider />
        <IconButton
          icon="fit"
          label={t('ui.map.fit')}
          disabled={viewport.fitted}
          className="disabled:pointer-events-none disabled:opacity-35"
          onClick={viewport.reset}
        />
      </Plate>
    </div>
  );
}

/**
 * How much air a name is given between its letters, as a share of its size.
 * Small lettering over a coloured field closes up and turns into a bar; a
 * little tracking is what keeps a five-letter name at 11 units a word.
 */
const TRACKING = 0.03;

/**
 * The halo behind a name, as a share of its size — and only half of that shows,
 * since a stroke straddles the outline it is drawn on.
 *
 * It is there to lift the letters off a coloured field, not to draw around
 * them. Past about a fifth of the size the pale ring stops being a background
 * and becomes the shape the eye follows, and the map turns into a scattering of
 * white blobs with words somewhere inside.
 */
const HALO = 0.15;
const HALO_HOVER = 0.18;

/** The course count, against the size of the name it hangs under. */
const COUNTER = 0.72;

/** How much wider than its ink an icon's halo pass runs, per unit of icon. */
const GLYPH_HALO = 0.05;

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
/** Widest a sea label may be before it has to wrap, in lettering units. */
const SEA_LABEL_WIDTH = 150;
/**
 * Clearance from the coast — far enough out to be past the shallows.
 *
 * In map units, and one of the few numbers here that is: the shallows are a
 * feature of the water rather than something written on it, so they grow with
 * the coast when the reader goes in, and a name standing clear of them has to
 * grow with them.
 */
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
  reserved: Rect[],
  /**
   * One unit of lettering in map units. Below 1 the reader has gone in, the
   * names have shrunk against the ground, and this whole pass runs again to
   * find out what will fit now that they have — which is where the map's extra
   * names come from.
   */
  scale: number,
  /** How far the cliffs hang below the coasts — the water starts under them. */
  depth: number
): Map<string, Placement> {
  const placements = new Map<string, Placement>();
  // The land is an obstacle for a name that has been pushed off its territory:
  // out at sea is the only place such a name is not on top of something. Its
  // cliff counts as land — the wall under a southern coast is the one part of a
  // territory that stands in the water, and a name written across it is written
  // on rock.
  const land: Rect[] = shapes.map((shape) => ({
    x: shape.x,
    y: shape.y,
    w: shape.width,
    h: shape.height + depth,
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
    // The floor and the ceiling are what the reader sees, though: an icon on a
    // small island that is a smudge at rest becomes a proper picture once the
    // reader goes in, and one already at its full size just stays there.
    const glyphAlone = Math.max(24, Math.min(76, (shape.room * 0.9) / scale)) * scale;

    const size = nameSize(shape.room) * scale;
    const inside = fitLines(title, size, shape.span * NAME_FIT);

    if (inside) {
      const textHeight = inside.length * size * LINE_HEIGHT;
      const gap = size * 0.45;
      // The icon takes what the name leaves, down to a size below which it stops
      // being a picture of anything — a territory that cannot hold both at once
      // gets a smaller icon rather than none.
      //
      // Against the headroom, not the field's size: the ground is laid back, so
      // a territory that is round on the plan is an oval on screen and only the
      // short way across it says what will actually fit.
      const spare = shape.headroom * 2 - textHeight - gap - size * 0.4;
      const glyphSize = Math.min(glyphAlone, spare);
      const withGlyph = glyphSize >= MIN_GLYPH * scale;
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
    const glyph = shape.headroom * 2 > glyphAlone + 4 * scale ? glyphAlone : null;
    const iconOnly: Placement = {
      lines: [],
      size,
      x: shape.cx,
      y: shape.cy,
      glyph,
      outside: false,
      box: null,
    };

    const seaSize = SEA_LABEL_SIZE * scale;
    const sea = fitLines(title, seaSize, SEA_LABEL_WIDTH * scale);
    if (!sea) {
      placements.set(shape.domainId, iconOnly);
      continue;
    }

    const w = lineWidth(sea, seaSize) + 8 * scale;
    const h = sea.length * seaSize * LINE_HEIGHT + 4 * scale;

    // Below first, then above, and each of those centred before it is allowed to
    // slide along the coast or stand further off it. The order is the order of
    // preference: the closer and the more centred, the more obviously the name
    // belongs to the ground it is pointing at.
    const candidates: Rect[] = [];
    for (const reach of [1, 2.2]) {
      for (const dx of [0, -w * 0.45, w * 0.45]) {
        const gap = SEA_LABEL_GAP * reach;
        // Below the territory is below its cliff: the water on that side starts
        // a wall's height further down than the ground does.
        candidates.push({
          x: shape.cx - w / 2 + dx,
          y: shape.y + shape.height + depth + gap,
          w,
          h,
        });
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
      size: seaSize,
      // The centre of the spot that was actually free, not of the territory —
      // a candidate that slid along the coast to find room has to be written
      // where it found it.
      x: spot.x + spot.w / 2,
      y: spot.y + seaSize * 0.9,
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
  scale,
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
  /** One unit of lettering in map units — see `letteringScale`. */
  scale: number;
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
  const size = named ? placement.size : SEA_LABEL_SIZE * scale;
  const lines = named ? placement.lines : (fitLines(title, size, shape.span * NAME_FIT) ?? [title]);
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
  // The weight scales with the lettering it protects, which is why this takes a
  // size rather than closing over the name's: the course count under a name is
  // set smaller and has to be haloed smaller, or it wears the name's collar.
  const halo = (textSize: number) => ({
    fill: MAP_INK,
    paintOrder: 'stroke' as const,
    stroke: placement.outside ? MAP_HALO_SEA : MAP_HALO,
    strokeWidth: textSize * (hovered ? HALO_HOVER : HALO),
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
    strokeOpacity: 0.92,
  });

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
            strokeWidth: 1.4 * scale,
            strokeOpacity: 0.45,
            strokeLinecap: 'round',
          }}
        />
      ) : null}

      {/* The same halo the names get, and for the same reason: line art in one
          dark colour vanishes into a strongly coloured field. Drawn as a thick
          pale pass with the ink laid over it — and only the difference between
          the two passes shows, so the pale one is measured against the icon it
          is standing behind. A fixed weight put the same ring around a 24-unit
          glyph and a 76-unit one, and on the small ones the ring was the icon. */}
      {placement.glyph ? (
        <g transform={lift(shape.cx, glyphY)}>
          <DomainGlyph
            domainId={domainId}
            x={shape.cx}
            y={glyphY}
            size={placement.glyph}
            colour={MAP_HALO}
            opacity={0.85}
            strokeWidth={2 * scale + placement.glyph * GLYPH_HALO}
          />
          <DomainGlyph
            domainId={domainId}
            x={shape.cx}
            y={glyphY}
            size={placement.glyph}
            colour={MAP_INK}
            opacity={hovered ? 1 : 0.85}
            strokeWidth={(hovered ? 2.6 : 2) * scale}
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
              style={halo(size)}
            >
              {line}
            </text>
          ))}
          {hovered ? (
            <text
              x={placement.x}
              y={lastLineY + size * 0.92 + 3 * scale}
              fontSize={size * COUNTER}
              fontWeight={500}
              letterSpacing={size * COUNTER * TRACKING}
              // How many courses is an answer to pointing at a field, not part
              // of its name — quieter than the name it hangs under.
              style={{ ...halo(size * COUNTER), fillOpacity: 0.68 }}
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
          className="map-label-hit"
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
